// packages/@monomind/cli/src/orgrt/grok-runner.ts
/**
 * GrokAgentRunner — AgentRunner impl backed by the Grok Build CLI (`grok`,
 * xAI's agentic coding CLI: https://docs.x.ai/build/cli).
 *
 * Architectural pattern: SAME as CodexAgentRunner/KimiCodeAgentRunner — spawn
 * the vendor's CLI binary, parse its NDJSON stream, normalize to
 * AgentMessage. No SDK dependency.
 *
 * Auth: inherited from the CLI's own login flow (subscription/API key
 * managed by `grok` itself). No env vars set by this runner.
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Same approach as codex/kimi/opencode. Tools are rendered INTO the first
 *   prompt; the model emits ```tool_call fences; this runner parses them out
 *   of the assistant text, executes the real OrgToolDef handlers in-process
 *   (gated through canUseTool), and feeds results back as the next prompt.
 *
 * Subprocess protocol — per public docs (docs.x.ai/build/cli/reference), NOT
 * byte-verified against a running binary (unlike the codex/kimi runners,
 * which were checked against an installed CLI). The exact NDJSON event field
 * names for `--format json` were not available at implementation time, so
 * parseGrokEvents() tolerates several plausible shapes (codex-style
 * `item.type === 'agent_message'`, a flat `role: 'assistant'` shape, and a
 * flat `type: 'assistant'`/`'message'` shape) rather than committing to one.
 * Verify against your installed `grok` version and tighten this parser if
 * the real shape differs — a wrong guess here fails closed (no text
 * extracted, not a crash), which is what the "no known shape matched" path
 * is for.
 *   - Invocation: `grok -p "<prompt>" --format json [--model X] [--cwd Y]
 *                 [--always-approve] [-r <sessionId> | -c]`
 *   - Session continuity: `-r/--resume [<id>]` resumes a specific session,
 *     `-c/--continue` resumes the most recent one. Session id is captured
 *     from any event carrying `session_id` / `sessionId` / `thread_id`.
 *   - stderr is human diagnostics; buffered and surfaced on non-zero exit.
 */
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching the other subprocess runners
/** Distinct from TURN_TIMEOUT_MS: catches a hung first-run interactive prompt
 *  (trust/telemetry gate) fast instead of waiting out the full turn timeout.
 *  Fires only if the process has produced ZERO stdout by this point — any
 *  output at all disarms it, since a slow model response is not a hang. */
const STARTUP_GRACE_MS = 45_000;

interface TurnOutcome {
  texts: string[];
  rawTexts: string[];
  sessionId?: string;
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  /** True when the process was killed by STARTUP_GRACE_MS with no output —
   *  likely stuck on a first-run interactive prompt headless mode can't answer. */
  hangSuspected: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

/** Pull a session/thread id out of a parsed event, tolerating the field-name
 *  variants different CLI versions/backends tend to use. */
function extractSessionId(ev: Record<string, unknown>): string | undefined {
  for (const key of ['session_id', 'sessionId', 'thread_id', 'threadId']) {
    const v = ev[key];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** Pull assistant-visible text out of a parsed event, tolerating the shape
 *  variants documented (or plausible) for `grok --format json`:
 *    - codex-style: { type: 'item.completed', item: { type: 'agent_message', text } }
 *    - flat role shape: { role: 'assistant', content: '...' | [{type:'text',text}] }
 *    - flat type shape: { type: 'assistant' | 'message', text: '...' } */
function extractText(ev: Record<string, unknown>): string | undefined {
  const item = ev.item as Record<string, unknown> | undefined;
  if (item && (item.type === 'agent_message' || item.type === 'message') && typeof item.text === 'string') {
    return item.text;
  }
  if (ev.role === 'assistant') {
    const content = ev.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text')
        .map((b) => b.text)
        .join('\n');
    }
  }
  if ((ev.type === 'assistant' || ev.type === 'message') && typeof ev.text === 'string') {
    return ev.text;
  }
  return undefined;
}

/** Pull usage totals out of a parsed event, tolerating openai-ish
 *  (prompt_tokens/completion_tokens) and codex-ish (input_tokens/output_tokens)
 *  field names. */
function extractUsage(ev: Record<string, unknown>): { input: number; output: number } | undefined {
  const usage = ev.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  if (typeof input === 'number' || typeof output === 'number') {
    return { input: typeof input === 'number' ? input : 0, output: typeof output === 'number' ? output : 0 };
  }
  return undefined;
}

/** Pure NDJSON parser — exported so it can be unit tested against fixture
 *  lines without spawning the real CLI (see grok-runner.test.ts). */
export function parseGrokEvents(lines: string[]): {
  texts: string[]; rawTexts: string[]; sessionId?: string; inputTokens: number; outputTokens: number; error?: string;
} {
  const rawTexts: string[] = [];
  let sessionId: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(trimmed); } catch { continue; }

    const sid = extractSessionId(ev);
    if (sid) sessionId = sid;

    const text = extractText(ev);
    if (text) rawTexts.push(text);

    const usage = extractUsage(ev);
    if (usage) { inputTokens = usage.input; outputTokens = usage.output; }

    if (ev.type === 'error' || ev.type === 'turn.failed') {
      const errMsg = (ev.error as Record<string, unknown> | undefined)?.message ?? ev.message;
      if (typeof errMsg === 'string') error = errMsg;
    }
  }

  const texts = rawTexts.map((t) => t.replace(TOOL_CALL_RE, '').trim());
  return { texts, rawTexts, sessionId, inputTokens, outputTokens, error };
}

export class GrokAgentRunner implements AgentRunner {
  constructor(private grokBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.grokBin || process.env.GROK_CLI_BIN || 'grok';
    let sessionId: string | undefined = args.resume;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const promptWithSystem = (round === 0 && !sessionId)
            ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
            : nextPrompt;

          const outcome = await this.runTurn(bin, promptWithSystem, sessionId, args);
          if (outcome.sessionId) sessionId = outcome.sessionId;

          if (outcome.hangSuspected) {
            throw new Error(
              `GrokAgentRunner: grok produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
              'This usually means it is stuck on a first-run interactive prompt (trust/telemetry gate) ' +
              'that headless mode has no way to answer. Run `grok` once manually in a real terminal in ' +
              `this project to accept any prompts, then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          if (outcome.exitCode !== 0 || outcome.error) {
            throw new Error(
              `GrokAgentRunner: grok failed (exit ${outcome.exitCode})` +
              (outcome.timedOut ? ` — killed after exceeding the ${TURN_TIMEOUT_MS / 3_600_000}h turn timeout` : '') +
              (outcome.error ? `: ${outcome.error}` : '') +
              (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
            );
          }

          for (const t of outcome.texts) {
            if (t.trim()) yield { type: 'assistant', session_id: sessionId, text: t };
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;

          const malformed: string[] = [];
          const calls = parseToolCalls(outcome.rawTexts, (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
          for (const note of malformed) yield { type: 'assistant', session_id: sessionId, text: note };
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant', session_id: sessionId,
              text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)`,
            };
            break;
          }

          const results: string[] = [];
          for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
          nextPrompt = formatToolResults(calls, results);
        }

        yield {
          type: 'result',
          session_id: sessionId,
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'GrokAgentRunner requires the Grok Build CLI (grok) on PATH. ' +
          'Install it per https://docs.x.ai/build/cli, then log in. ' +
          'Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }

  private runTurn(
    bin: string,
    prompt: string,
    sessionId: string | undefined,
    args: AgentRunArgs,
  ): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve, reject) => {
      const cliArgs: string[] = ['-p', prompt, '--format', 'json', '--always-approve'];
      if (args.model) cliArgs.push('--model', args.model);
      cliArgs.push('--cwd', args.cwd);
      if (sessionId) cliArgs.push('--resume', sessionId);

      const child = spawn(bin, cliArgs, {
        cwd: args.cwd,
        env: { ...process.env, ...args.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrTail = '';
      child.stderr?.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-4000); });

      let sawOutput = false;
      let timedOut = false;
      let hangSuspected = false;
      const KILL_GRACE_MS = 5000;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
        killTimer.unref?.();
      }, TURN_TIMEOUT_MS);

      // See STARTUP_GRACE_MS — disarmed by the first stdout chunk below.
      let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        hangSuspected = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
        killTimer.unref?.();
      }, STARTUP_GRACE_MS);

      const exitPromise = new Promise<number>((res, rej) => {
        child.on('error', rej);
        child.on('close', (code) => res(code ?? 1));
      });
      exitPromise.catch(() => {});

      const readLines = (async () => {
        const lines: string[] = [];
        let buf = '';
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          if (!sawOutput) { sawOutput = true; if (hangTimer) { clearTimeout(hangTimer); hangTimer = undefined; } }
          buf += chunk.toString();
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          lines.push(...parts);
        }
        if (buf.trim()) lines.push(buf);
        return lines;
      })();

      // Timer cleanup lives in a top-level .finally() (not nested inside a
      // success-path .then()) so it runs on EITHER path — a stdout stream
      // error would otherwise skip straight to reject() and leave the
      // TURN_TIMEOUT_MS/hangTimer/killTimer timers running past the
      // process's actual lifetime.
      Promise.all([readLines, exitPromise])
        .then(([lines, exitCode]) => {
          const parsed = parseGrokEvents(lines);
          resolve({
            texts: parsed.texts,
            rawTexts: parsed.rawTexts,
            sessionId: parsed.sessionId ?? sessionId,
            exitCode,
            stderrTail,
            timedOut,
            hangSuspected,
            inputTokens: parsed.inputTokens,
            outputTokens: parsed.outputTokens,
            error: parsed.error,
          });
        }, reject)
        .finally(() => {
          clearTimeout(timer);
          if (hangTimer) clearTimeout(hangTimer);
          if (killTimer) clearTimeout(killTimer);
        });
    });
  }
}
