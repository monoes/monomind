// packages/@monomind/cli/src/orgrt/copilot-runner.ts
/**
 * CopilotAgentRunner — AgentRunner impl backed by the GitHub Copilot CLI
 * (`copilot`, https://docs.github.com/en/copilot/reference/copilot-cli-reference).
 *
 * Architectural pattern: SAME as the other subprocess runners — spawn the
 * CLI, parse its output, normalize to AgentMessage.
 *
 * Auth: GitHub's own device/browser login flow (`copilot` handles this
 * itself on first run). No env vars set here.
 *
 * Subprocess protocol — per public docs, NOT byte-verified against a running
 * binary:
 *   - Invocation: `copilot -p "<prompt>" --output-format json -s
 *                 --allow-all-tools --no-ask-user [--model=<model>]`. `-s`
 *     (silent) suppresses the stats/decoration footer that otherwise mixes
 *     into stdout (documented GitHub issue: without `-s`, response text can
 *     be absent from plain stdout entirely — `--output-format json` + `-s`
 *     is the documented workaround). `--no-ask-user` disables the CLI's
 *     ask_user tool so a headless run can never block waiting on a question
 *     with no human to answer it — confirmed by cross-checking a second,
 *     independent public agentic-CLI wrapper's provider table, which lists
 *     the identical `-s --allow-all-tools --no-ask-user` combination for
 *     Copilot's non-interactive mode; this runner was missing `--no-ask-user`
 *     until that cross-check.
 *   - Output: NDJSON; assistant text arrives on `assistant.message`-shaped
 *     events. The exact full field list isn't published, so parseCopilotEvents
 *     tolerates a couple of plausible shapes (an explicit `type`/`kind` of
 *     'assistant.message' or 'assistant' carrying `content`/`text`) and
 *     fails closed (no text extracted) on anything else, rather than
 *     guessing wrong and emitting garbage.
 *   - Session/resume: Copilot documents a `--resume=<id>` flag, but nothing
 *     in this runner's output parsing surfaces a session id to pass back in
 *     (the same gap the cross-check source above notes about its own
 *     integration), so resume can't be wired up yet — every mailbox prompt
 *     is a fresh `copilot -p` invocation, same disclosed limitation as
 *     CrushAgentRunner. Revisit if a session-id-bearing event/field is found.
 *   - Token usage: NOT documented for `--output-format json`, and Copilot
 *     CLI has no documented custom-base-URL override (it talks to GitHub's
 *     own Copilot backend, not a passthrough-able OpenAI/Anthropic
 *     endpoint), so this runner does not attempt usage-proxy accounting —
 *     it always reports 0 tokens. Revisit if GitHub documents a usage field
 *     or a proxyable endpoint later.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Distinct from TURN_TIMEOUT_MS: catches a hung first-run interactive prompt
 *  fast instead of waiting out the full turn timeout. Any output at all
 *  disarms it. Copilot CLI has a DOCUMENTED bug where its directory-trust
 *  and path-access prompts can hang indefinitely in CI/headless invocations
 *  with no way to answer them — this is the primary mitigation for copilot
 *  specifically, not just a defensive backstop. */
const STARTUP_GRACE_MS = 45_000;

interface CopilotEvent {
  type?: string;
  kind?: string;
  role?: string;
  content?: unknown;
  text?: string;
  message?: { content?: unknown; text?: string };
}

function coerceText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return undefined;
}

/** Pure NDJSON parser — exported for unit testing against fixture lines
 *  (copilot-runner.test.ts). */
export function parseCopilotEvents(lines: string[]): { texts: string[]; rawTexts: string[] } {
  const rawTexts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let ev: CopilotEvent;
    try { ev = JSON.parse(trimmed); } catch { continue; }

    const kind = ev.type ?? ev.kind;
    if (kind === 'assistant.message' || kind === 'assistant') {
      const text = coerceText(ev.content) ?? ev.text ?? coerceText(ev.message?.content) ?? ev.message?.text;
      if (text) rawTexts.push(text);
      continue;
    }
    if (ev.role === 'assistant') {
      const text = coerceText(ev.content) ?? ev.text;
      if (text) rawTexts.push(text);
    }
  }
  const texts = rawTexts.map((t) => t.replace(TOOL_CALL_RE, '').trim());
  return { texts, rawTexts };
}

interface TurnOutcome {
  texts: string[];
  rawTexts: string[];
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  /** True when the process was killed by STARTUP_GRACE_MS with no output —
   *  likely stuck on copilot's documented directory-trust/path-access hang. */
  hangSuspected: boolean;
}

export class CopilotAgentRunner implements AgentRunner {
  constructor(private copilotBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.copilotBin || process.env.COPILOT_CLI_BIN || 'copilot';

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const outcome = await this.runTurn(bin, nextPrompt, args);

          if (outcome.hangSuspected) {
            throw new Error(
              `CopilotAgentRunner: copilot produced no output within ${STARTUP_GRACE_MS / 1000}s and was ` +
              'killed. This is a documented copilot CLI issue: its directory-trust/path-access prompts can ' +
              'hang indefinitely in headless invocations with no way to answer them. Run `copilot` once ' +
              'manually in a real terminal in this project to accept any prompts (and confirm --add-dir ' +
              `covers every path it needs), then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          if (outcome.exitCode !== 0) {
            throw new Error(
              `CopilotAgentRunner: copilot failed (exit ${outcome.exitCode})` +
              (outcome.timedOut ? ` — killed after exceeding the ${TURN_TIMEOUT_MS / 3_600_000}h turn timeout` : '') +
              (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
            );
          }

          for (const t of outcome.texts) {
            if (t.trim()) yield { type: 'assistant', text: t };
          }

          const malformed: string[] = [];
          const calls = parseToolCalls(outcome.rawTexts, (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) {
            yield { type: 'result', subtype: 'success', input_tokens: 0, output_tokens: 0 };
            break;
          }

          if (round === MAX_TOOL_ROUNDS) {
            yield { type: 'assistant', text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)` };
            yield { type: 'result', subtype: 'success', input_tokens: 0, output_tokens: 0 };
            break;
          }

          const results: string[] = [];
          for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
          nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${formatToolResults(calls, results)}`;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'CopilotAgentRunner requires the GitHub Copilot CLI (copilot) on PATH. ' +
          'Install it: npm install -g @github/copilot, then run `copilot` once to ' +
          'authenticate. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }

  private runTurn(bin: string, prompt: string, args: AgentRunArgs): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve, reject) => {
      const cliArgs: string[] = ['-p', prompt, '--output-format', 'json', '-s', '--allow-all-tools', '--no-ask-user'];
      if (args.model) cliArgs.push(`--model=${args.model}`);
      cliArgs.push('--add-dir', args.cwd);

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
          const parsed = parseCopilotEvents(lines);
          resolve({ texts: parsed.texts, rawTexts: parsed.rawTexts, exitCode, stderrTail, timedOut, hangSuspected });
        }, (err) => {
          // A stdout stream error (the reject path) means the process is
          // still ALIVE and unmanaged — none of the timeout/hang timers
          // would have fired to kill it. Without this, that error would
          // orphan the child. child.kill() on an already-dead process is a
          // documented no-op, so this is safe on every path.
          try { child.kill('SIGTERM'); } catch { /* already gone */ }
          reject(err);
        })
        .finally(() => {
          clearTimeout(timer);
          if (hangTimer) clearTimeout(hangTimer);
          if (killTimer) clearTimeout(killTimer);
        });
    });
  }
}
