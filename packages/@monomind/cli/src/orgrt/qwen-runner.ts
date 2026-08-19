// packages/@monomind/cli/src/orgrt/qwen-runner.ts
/**
 * QwenAgentRunner — AgentRunner impl backed by the Qwen Code CLI (`qwen`,
 * https://qwenlm.github.io/qwen-code-docs/).
 *
 * Architectural pattern: SAME as CodexAgentRunner/GrokAgentRunner — spawn the
 * vendor's CLI binary, parse its stream-json output, normalize to
 * AgentMessage. No SDK dependency.
 *
 * Auth: inherited from the CLI's own login flow. No env vars set here.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners
 * (see tool-fence.ts).
 *
 * Subprocess protocol — LIVE-VERIFIED against qwen-code v0.21.13 (issue
 * #182 investigation; z.ai/GLM-5.3 as the OpenAI-compatible backend, `qwen
 * --auth-type openai` + `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`):
 *   - Invocation: `qwen -p "<prompt>" --output-format stream-json --yolo
 *                 [-m <model>] [--resume <sessionId> | --continue]`
 *   - stream-json emits one JSON object per line; CONFIRMED shape (the
 *     public docs' `usage.tokens.{input,output}` nesting does NOT match
 *     live output — real usage fields are flat):
 *       { type: 'system'|'assistant'|'result', subtype, uuid, session_id,
 *         role: 'assistant',
 *         message: { content: [{type:'text', text}],
 *                     usage: { input_tokens, output_tokens, cache_read_input_tokens, total_tokens } } }
 *   - Session continuity: `--resume [sessionId]` resumes a specific session,
 *     `--continue` resumes the most recent one; `session_id` is carried on
 *     every event.
 *   - `--yolo` auto-approves tool actions (org roles gate tool execution
 *     themselves via canUseTool/tool-fence, so CLI-level approval prompts
 *     would otherwise hang a non-interactive run).
 */
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Distinct from TURN_TIMEOUT_MS: catches a hung first-run interactive prompt
 *  (trust/telemetry gate) fast instead of waiting out the full turn timeout.
 *  Fires only if the process has produced ZERO stdout by this point — any
 *  output at all disarms it, since a slow model response is not a hang. */
const STARTUP_GRACE_MS = 45_000;

interface QwenMessage {
  content?: Array<{ type: string; text?: string }>;
}

interface QwenEvent {
  type?: 'system' | 'assistant' | 'result';
  subtype?: string;
  session_id?: string;
  message?: QwenMessage;
  /** Confirmed live (issue #182): on `result` events, usage is TOP-LEVEL
   *  and flat, NOT nested under `message.usage.tokens` as the public docs
   *  suggest. `assistant` events don't carry a top-level `usage` at all in
   *  observed output. */
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string } | string;
}

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

/** Pure stream-json parser — exported for unit testing against fixture lines
 *  built from Qwen Code's documented event schema (qwen-runner.test.ts). */
export function parseQwenEvents(lines: string[]): {
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
    let ev: QwenEvent;
    try { ev = JSON.parse(trimmed); } catch { continue; }

    if (ev.session_id) sessionId = ev.session_id;

    if (ev.type === 'assistant' && ev.message?.content) {
      const text = ev.message.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n');
      if (text) rawTexts.push(text);
    }

    if (ev.type === 'result') {
      if (ev.usage) {
        inputTokens = ev.usage.input_tokens ?? 0;
        outputTokens = ev.usage.output_tokens ?? 0;
      }
      if (ev.subtype === 'error') {
        error = typeof ev.error === 'string' ? ev.error : ev.error?.message ?? 'qwen result: error';
      }
    }
  }

  const texts = rawTexts.map((t) => t.replace(TOOL_CALL_RE, '').trim());
  return { texts, rawTexts, sessionId, inputTokens, outputTokens, error };
}

export class QwenAgentRunner implements AgentRunner {
  constructor(private qwenBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.qwenBin || process.env.QWEN_CLI_BIN || 'qwen';
    let sessionId: string | undefined = args.resume;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          // Gated on !sessionId alone, NOT `round === 0 && !sessionId` — if
          // a session id never gets parsed out of qwen's output, every
          // round after the first would otherwise spawn a completely
          // fresh, contextless qwen invocation carrying only the tool-
          // result text. Once a session id IS captured, --resume takes
          // over and this stops re-sending the system prompt.
          const promptWithSystem = !sessionId
            ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
            : nextPrompt;

          const outcome = await this.runTurn(bin, promptWithSystem, sessionId, args);
          if (outcome.sessionId) sessionId = outcome.sessionId;

          if (outcome.hangSuspected) {
            throw new Error(
              `QwenAgentRunner: qwen produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
              'This usually means it is stuck on a first-run interactive prompt (trust/telemetry gate) ' +
              'that headless mode has no way to answer. Run `qwen` once manually in a real terminal in ' +
              `this project to accept any prompts, then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          if (outcome.exitCode !== 0 || outcome.error) {
            throw new Error(
              `QwenAgentRunner: qwen failed (exit ${outcome.exitCode})` +
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
          'QwenAgentRunner requires the Qwen Code CLI (qwen) on PATH. ' +
          'Install it: npm install -g @qwen-code/qwen-code, then run `qwen` once ' +
          'to authenticate. Or unset the runtime to use Claude.',
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
      const cliArgs: string[] = ['-p', prompt, '--output-format', 'stream-json', '--yolo'];
      if (args.model) cliArgs.push('-m', args.model);
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
          const parsed = parseQwenEvents(lines);
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
