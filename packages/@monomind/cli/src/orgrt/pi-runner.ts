// packages/@monomind/cli/src/orgrt/pi-runner.ts
/**
 * PiAgentRunner — AgentRunner impl backed by the Pi coding agent CLI
 * (`pi`, https://github.com/badlogic/pi-mono, package @mariozechner/pi-coding-agent).
 *
 * Architectural pattern: SAME as the other subprocess runners — spawn the
 * CLI, parse its output, normalize to AgentMessage.
 *
 * Auth: pi's own provider login (per-provider API key or subscription,
 * configured via `pi` itself). No env vars set here.
 *
 * Subprocess protocol — per public docs (pi-mono's rpc.md + README), NOT
 * byte-verified against a running binary. `pi --mode json` shares its event
 * vocabulary with pi's RPC mode:
 *   - Invocation: `pi --mode json --approve --session-dir <dir> "<prompt>"`.
 *     The prompt is POSITIONAL (matching pi's own interactive-mode CLI shape
 *     and the same convention codex uses) — an earlier revision of this
 *     runner passed it via a `-p` flag, which a second-source cross-check
 *     against another public agentic-CLI wrapper's tool table indicated was
 *     wrong; corrected here. `--approve` accepts the cwd as a trusted
 *     project so pi doesn't stop to ask (pi has no single "yolo" flag; tool
 *     auto-approval for individual actions is a separate, not-yet-wired
 *     concern for this runner — org tool calls go through canUseTool
 *     regardless, since they use the tool-fence protocol, not pi's native
 *     tool surface).
 *     (`--session-dir` also gives turn-to-turn continuity: pi persists
 *     sessions in that directory and resumes the latest one by default —
 *     there is no confirmed explicit `--resume <id>` flag for headless use,
 *     so this runner points every turn at the SAME per-run session dir
 *     rather than tracking a session id, and disclaims true cross-process
 *     resume as best-effort).
 *   - Event types seen: `agent_start` (ignored), `message_update` (partial;
 *     carries a cumulative `usage` object — kept as running totals but
 *     superseded by `message_end`), `message_end` (final `content` array
 *     with `{type:'text', text}` / `{type:'toolCall', ...}` items — only
 *     `text` items are surfaced to the bus), `tool_execution_*` (ignored;
 *     org tool calls use the shared tool-fence protocol, not pi's native
 *     tool-call surface).
 *   - Usage field names differ from the other CLIs: `usage.input` /
 *     `usage.output` (not `input_tokens`/`output_tokens`).
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

interface PiContentBlock { type?: string; text?: string; }
interface PiUsage { input?: number; output?: number; }
interface PiEvent {
  type?: string;
  message?: { content?: PiContentBlock[]; usage?: PiUsage };
  usage?: PiUsage;
}

/** Pure JSON-event parser — exported for unit testing against fixture lines
 *  (pi-runner.test.ts). */
export function parsePiEvents(lines: string[]): {
  texts: string[]; rawTexts: string[]; inputTokens: number; outputTokens: number;
} {
  const rawTexts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let ev: PiEvent;
    try { ev = JSON.parse(trimmed); } catch { continue; }

    if (ev.type === 'message_end' && ev.message?.content) {
      const text = ev.message.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n');
      if (text) rawTexts.push(text);
    }

    const usage = ev.message?.usage ?? ev.usage;
    if (usage && (typeof usage.input === 'number' || typeof usage.output === 'number')) {
      inputTokens = usage.input ?? inputTokens;
      outputTokens = usage.output ?? outputTokens;
    }
  }

  const texts = rawTexts.map((t) => t.replace(TOOL_CALL_RE, '').trim());
  return { texts, rawTexts, inputTokens, outputTokens };
}

interface TurnOutcome {
  texts: string[];
  rawTexts: string[];
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  inputTokens: number;
  outputTokens: number;
}

export class PiAgentRunner implements AgentRunner {
  constructor(private piBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.piBin || process.env.PI_CLI_BIN || 'pi';
    // Stable per-run session directory — see file header on why this
    // substitutes for an explicit resume-by-id flag.
    const sessionDir = join(args.cwd, '.monomind-pi-session');

    try {
      let first = true;
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = first ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}` : text;
        first = false;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const outcome = await this.runTurn(bin, nextPrompt, sessionDir, args);

          if (outcome.exitCode !== 0) {
            throw new Error(
              `PiAgentRunner: pi failed (exit ${outcome.exitCode})` +
              (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
            );
          }

          for (const t of outcome.texts) {
            if (t.trim()) yield { type: 'assistant', text: t };
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;

          const malformed: string[] = [];
          const calls = parseToolCalls(outcome.rawTexts, (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield { type: 'assistant', text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)` };
            break;
          }

          const results: string[] = [];
          for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
          nextPrompt = formatToolResults(calls, results);
        }

        yield {
          type: 'result',
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'PiAgentRunner requires the Pi coding agent CLI (pi) on PATH. ' +
          'Install it: npm install -g @mariozechner/pi-coding-agent, then configure a ' +
          'provider. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }

  private runTurn(bin: string, prompt: string, sessionDir: string, args: AgentRunArgs): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve, reject) => {
      // Prompt is positional (see file header) — always LAST so no later flag
      // is mistaken for part of it.
      const cliArgs: string[] = ['--mode', 'json', '--approve', '--session-dir', sessionDir];
      if (args.model) cliArgs.push('--model', args.model);
      cliArgs.push(prompt);

      const child = spawn(bin, cliArgs, {
        cwd: args.cwd,
        env: { ...process.env, ...args.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

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
          const parsed = parsePiEvents(lines);
          resolve({
            texts: parsed.texts,
            rawTexts: parsed.rawTexts,
            exitCode,
            stderrTail,
            timedOut,
            inputTokens: parsed.inputTokens,
            outputTokens: parsed.outputTokens,
          });
        }, reject);
    });
  }
}
