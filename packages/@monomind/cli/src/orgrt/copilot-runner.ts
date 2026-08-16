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
 *                 --allow-all-tools [--model=<model>]`. `-s` (silent)
 *     suppresses the stats/decoration footer that otherwise mixes into
 *     stdout (documented GitHub issue: without `-s`, response text can be
 *     absent from plain stdout entirely — `--output-format json` + `-s` is
 *     the documented workaround).
 *   - Output: NDJSON; assistant text arrives on `assistant.message`-shaped
 *     events. The exact full field list isn't published, so parseCopilotEvents
 *     tolerates a couple of plausible shapes (an explicit `type`/`kind` of
 *     'assistant.message' or 'assistant' carrying `content`/`text`) and
 *     fails closed (no text extracted) on anything else, rather than
 *     guessing wrong and emitting garbage.
 *   - Session/resume: NOT documented for headless use. Every mailbox prompt
 *     is a fresh `copilot -p` invocation, same disclosed limitation as
 *     CrushAgentRunner — no continuity between turns.
 *   - Token usage: NOT documented for `--output-format json`, and Copilot
 *     CLI has no documented custom-base-URL override (it talks to GitHub's
 *     own Copilot backend, not a passthrough-able OpenAI/Anthropic
 *     endpoint), so this runner does not attempt usage-proxy accounting —
 *     it always reports 0 tokens. Revisit if GitHub documents a usage field
 *     or a proxyable endpoint later.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
import type { SpawnProcess, SpawnedProcess } from './grok-runner.js';

export type { SpawnProcess } from './grok-runner.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const defaultSpawnProcess: SpawnProcess = (bin, args, opts): SpawnedProcess =>
  nodeSpawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });

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
}

export class CopilotAgentRunner implements AgentRunner {
  constructor(private copilotBin?: string, private spawnProcess: SpawnProcess = defaultSpawnProcess) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.copilotBin || process.env.COPILOT_CLI_BIN || 'copilot';

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const outcome = await this.runTurn(bin, nextPrompt, args);

          if (outcome.exitCode !== 0) {
            throw new Error(
              `CopilotAgentRunner: copilot failed (exit ${outcome.exitCode})` +
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
      const cliArgs: string[] = ['-p', prompt, '--output-format', 'json', '-s', '--allow-all-tools'];
      if (args.model) cliArgs.push(`--model=${args.model}`);
      cliArgs.push('--add-dir', args.cwd);

      const child = this.spawnProcess(bin, cliArgs, { cwd: args.cwd, env: { ...process.env, ...args.env } });

      let stderrTail = '';
      child.stderr?.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-4000); });

      let timedOut = false;
      const KILL_GRACE_MS = 5000;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
        killTimer.unref?.();
      }, TURN_TIMEOUT_MS);

      const exitPromise = new Promise<number>((res, rej) => {
        child.on('error', rej);
        child.on('close', (code) => res(code ?? 1));
      });
      exitPromise.catch(() => {});

      (async () => {
        const lines: string[] = [];
        let buf = '';
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          buf += chunk.toString();
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          lines.push(...parts);
        }
        if (buf.trim()) lines.push(buf);
        return lines;
      })()
        .then((lines) => exitPromise.finally(() => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); }).then((exitCode) => ({ lines, exitCode })))
        .then(({ lines, exitCode }) => {
          const parsed = parseCopilotEvents(lines);
          resolve({ texts: parsed.texts, rawTexts: parsed.rawTexts, exitCode, stderrTail, timedOut });
        }, reject);
    });
  }
}
