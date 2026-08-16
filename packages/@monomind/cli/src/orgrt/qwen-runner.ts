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
 * Subprocess protocol — per Qwen Code's public "Headless Mode" docs, NOT
 * byte-verified against a running binary:
 *   - Invocation: `qwen -p "<prompt>" --output-format stream-json --yolo
 *                 [-m <model>] [--resume <sessionId> | --continue]`
 *   - stream-json emits one JSON object per line; documented shape:
 *       { type: 'system'|'assistant'|'result', subtype, uuid, session_id,
 *         role: 'assistant',
 *         message: { content: [{type:'text', text}], usage: { tokens: { input, output, total } } } }
 *   - Session continuity: `--resume [sessionId]` resumes a specific session,
 *     `--continue` resumes the most recent one; `session_id` is carried on
 *     every event.
 *   - `--yolo` auto-approves tool actions (org roles gate tool execution
 *     themselves via canUseTool/tool-fence, so CLI-level approval prompts
 *     would otherwise hang a non-interactive run).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
import type { SpawnProcess, SpawnedProcess } from './grok-runner.js';

export type { SpawnProcess } from './grok-runner.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const defaultSpawnProcess: SpawnProcess = (bin, args, opts): SpawnedProcess =>
  nodeSpawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });

interface QwenMessage {
  content?: Array<{ type: string; text?: string }>;
  usage?: { tokens?: { input?: number; output?: number } };
}

interface QwenEvent {
  type?: 'system' | 'assistant' | 'result';
  subtype?: string;
  session_id?: string;
  message?: QwenMessage;
  error?: { message?: string } | string;
}

interface TurnOutcome {
  texts: string[];
  rawTexts: string[];
  sessionId?: string;
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
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
      const tokens = ev.message?.usage?.tokens;
      if (tokens) {
        inputTokens = tokens.input ?? 0;
        outputTokens = tokens.output ?? 0;
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
  constructor(private qwenBin?: string, private spawnProcess: SpawnProcess = defaultSpawnProcess) {}

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
          const promptWithSystem = (round === 0 && !sessionId)
            ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
            : nextPrompt;

          const outcome = await this.runTurn(bin, promptWithSystem, sessionId, args);
          if (outcome.sessionId) sessionId = outcome.sessionId;

          if (outcome.exitCode !== 0 || outcome.error) {
            throw new Error(
              `QwenAgentRunner: qwen failed (exit ${outcome.exitCode})` +
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
          const parsed = parseQwenEvents(lines);
          resolve({
            texts: parsed.texts,
            rawTexts: parsed.rawTexts,
            sessionId: parsed.sessionId ?? sessionId,
            exitCode,
            stderrTail,
            timedOut,
            inputTokens: parsed.inputTokens,
            outputTokens: parsed.outputTokens,
            error: parsed.error,
          });
        }, reject);
    });
  }
}
