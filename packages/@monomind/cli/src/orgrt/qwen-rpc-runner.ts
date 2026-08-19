// packages/@monomind/cli/src/orgrt/qwen-rpc-runner.ts
/**
 * QwenRpcAgentRunner — AgentRunner impl backed by the Qwen Code CLI's
 * bidirectional `--input-format stream-json --output-format stream-json`
 * mode (session-lifetime), instead of the default QwenAgentRunner
 * (qwen-runner.ts), which spawns a fresh `qwen -p "<prompt>"` process per
 * mailbox turn.
 *
 * OPT-IN, not the default. Select via role/org `runtime: 'qwen-rpc'`.
 * Prefer plain `runtime: 'qwen'` (QwenAgentRunner) unless you specifically
 * want the benefit this buys: the subprocess stays alive for the WHOLE
 * mailbox session, so conversational context carries naturally (no
 * `--resume <sessionId>` round-trip per turn) and there's no per-turn
 * spawn/bootstrap cost.
 *
 * Protocol — LIVE-VERIFIED against qwen-code v0.21.13 (issue #182). The
 * flag exists but is hidden from `qwen --help`; found by reading the
 * bundled minified source (`packages/cli`'s yargs config,
 * `.option("input-format", { choices: ["text","stream-json"] })`) and
 * confirmed the exact message schema from the CLI's own bundled source
 * (`packages/cli/src/nonInteractive/types.ts`, compiled into
 * `chunks/session-*.js`) — the `isCLIUserMessage`/`extractUserMessageText`
 * predicates there define the client→server shape literally, not from
 * prose docs. Then confirmed LIVE: sent both message forms below on the
 * same persistent subprocess against a z.ai/GLM-5.3 backend — both
 * answered correctly, on the SAME session_id, proving session-lifetime
 * persistence:
 *
 *   Client → server (this runner sends):
 *     {"type":"user","message":{"content":"<text>"}}
 *     (a content-block-array form is also accepted —
 *      {"type":"user","message":{"content":[{"type":"text","text":"..."}]}}
 *      — but the plain-string form is simpler and was used for all live
 *      verification, so this runner sticks to it)
 *
 *   Server → client (same vocabulary as QwenAgentRunner's per-spawn
 *   stream-json, confirmed identical live under RPC mode too):
 *     {"type":"system","subtype":"init","session_id":"...",...}
 *     {"type":"assistant","session_id":"...",
 *      "message":{"content":[{"type":"text","text":"..."},
 *                             {"type":"thinking","thinking":"..."}]}}
 *     {"type":"result","subtype":"success"|"error","session_id":"...",
 *      "usage":{"input_tokens":N,"output_tokens":N,...},
 *      "error":{"message":"..."}|"<string>"}
 *   `result` is a single-fire-per-turn completion signal — confirmed live
 *   (same as the non-RPC QwenAgentRunner already relies on for its
 *   per-spawn invocations). A `system`/`init` event was also observed
 *   re-emitted at the start of a SECOND turn on the same subprocess — not
 *   treated as a new-session signal here, since session_id stayed
 *   identical across it in the live test.
 *
 * NOT verified live: a turn where qwen runs multiple of its OWN native
 * tools (read/edit/bash) in sequence before responding — same class of gap
 * pi-rpc-runner.ts disclosed for pi before its own live verification
 * confirmed a single fire-once completion signal there too. `result`
 * firing exactly once per submitted `user` message (not once per internal
 * tool-use cycle) is inferred by symmetry with the non-RPC QwenAgentRunner
 * (which already treats `result` this way across a `-p` invocation that
 * CAN involve multiple internal tool calls) rather than independently
 * re-confirmed here. Revalidate if this runner ends a turn early or hangs
 * on a heavily tool-call-heavy prompt; fall back to plain `runtime: 'qwen'`
 * if it misbehaves.
 *
 * Auth: inherited from the CLI's own login flow — same as QwenAgentRunner.
 * No env vars set here. (Live verification against a custom
 * OpenAI-compatible backend needed `--auth-type openai` plus
 * `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` env vars, per
 * qwen-runner.ts's own header — not something this runner forces, since a
 * real deployment's own qwen config/subscription should already be set up
 * the way its operator wants.)
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Qwen's own native tools (read/edit/bash) execute autonomously inside
 *   qwen itself and never reach this runner — only org tools ride the
 *   shared tool-fence protocol (tool-fence.ts), extracted from assistant
 *   text collected before `result` and fed back as a new `user` message in
 *   the SAME session.
 */
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';

/** Upper bound on how long a single turn's wait for `result` may run before
 *  the mid-session silence watchdog (below) considers qwen wedged. */
const SETTLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STARTUP_GRACE_MS = 45_000;

interface QwenRpcContentBlock { type: string; text?: string; thinking?: string; }
interface QwenRpcMessage { content?: QwenRpcContentBlock[]; }

/** Pure, transport-independent JSONL line decoder — same shape as
 *  pi-rpc-runner.ts's JsonlDecoder. Exported for unit testing without a
 *  real subprocess. */
export class QwenJsonlDecoder {
  private buf = '';
  feed(chunk: string): Record<string, unknown>[] {
    this.buf += chunk;
    const parts = this.buf.split('\n');
    this.buf = parts.pop() ?? '';
    const out: Record<string, unknown>[] = [];
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed)); } catch { /* skip malformed line */ }
    }
    return out;
  }
}

/** Encode a client→server `user` message as one LF-terminated JSON line —
 *  the plain-string content form (see file header for why the
 *  content-block-array form isn't used). Exported for unit testing the
 *  exact wire format. */
export function encodeQwenRpcUserMessage(text: string): string {
  return JSON.stringify({ type: 'user', message: { content: text } }) + '\n';
}

/** Extract assistant-visible text from an `assistant` event's
 *  `message.content` array. `thinking` blocks are dropped (internal
 *  reasoning, not meant for the bus). Exported for unit testing against
 *  fixture content arrays. */
export function extractQwenRpcText(message: QwenRpcMessage): string {
  return (message.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** The subset of a spawned child process this runner needs — same
 *  duck-typed seam as pi-rpc-runner.ts's PiRpcProcess, so tests can supply
 *  a fake implementation to exercise the full turn-completion state
 *  machine without a real `qwen` binary. */
export interface QwenRpcProcess {
  stdin: { write(data: string): void } | null;
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: 'data', cb: (chunk: Buffer) => void): void } | null;
  on(event: 'close', cb: (code: number | null) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  kill(signal?: string): void;
}

export type SpawnQwenRpc = (bin: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => QwenRpcProcess;

const defaultSpawnQwenRpc: SpawnQwenRpc = (bin, args, opts) =>
  spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as QwenRpcProcess;

export class QwenRpcAgentRunner implements AgentRunner {
  constructor(private qwenBin?: string, private spawnFn: SpawnQwenRpc = defaultSpawnQwenRpc) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.qwenBin || process.env.QWEN_CLI_BIN || 'qwen';

    const cliArgs = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--yolo'];
    if (args.model) cliArgs.push('-m', args.model);

    const child = this.spawnFn(bin, cliArgs, {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
    });

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-4000); });

    const decoder = new QwenJsonlDecoder();
    const eventQueue: Record<string, unknown>[] = [];
    const waiters: Array<(ev: Record<string, unknown>) => void> = [];
    let closed = false;
    let closeCode: number | null = null;
    let lastEventAt = Date.now();

    const pushEvents = (evs: Record<string, unknown>[]) => {
      for (const ev of evs) {
        const waiter = waiters.shift();
        if (waiter) waiter(ev);
        else eventQueue.push(ev);
      }
    };
    child.stdout?.on('data', (c: Buffer) => { lastEventAt = Date.now(); pushEvents(decoder.feed(c.toString())); });
    let processExited = false;
    child.on('close', (code) => { closed = true; processExited = true; closeCode = code; pushEvents([{ type: '__closed__', code }]); });
    child.on('error', (err) => { closed = true; pushEvents([{ type: '__error__', error: err }]); });

    const nextEvent = (): Promise<Record<string, unknown>> => {
      const queued = eventQueue.shift();
      if (queued) return Promise.resolve(queued);
      if (closed) return Promise.resolve({ type: '__closed__', code: closeCode });
      return new Promise((resolve) => waiters.push(resolve));
    };

    const send = (text: string): void => {
      child.stdin?.write(encodeQwenRpcUserMessage(text));
    };

    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const killChild = (): void => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
      killTimer.unref?.();
    };

    let sawAnyEvent = false;
    let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      if (!sawAnyEvent) { closed = true; killChild(); pushEvents([{ type: '__hang__' }]); }
    }, STARTUP_GRACE_MS);
    const disarmHang = () => { if (!sawAnyEvent) { sawAnyEvent = true; if (hangTimer) { clearTimeout(hangTimer); hangTimer = undefined; } } };

    // Rolling watchdog — same rationale/pause logic as pi-rpc-runner.ts:
    // paused whenever an org tool call is in flight (ask_human can
    // legitimately block far longer than the silence window) or there's no
    // turn in flight at all (idling on the role's own mailbox is normal).
    let toolCallInFlight = false;
    let turnInFlight = false;
    const MID_SESSION_SILENCE_MS = SETTLE_TIMEOUT_MS;
    const silenceWatchdog: ReturnType<typeof setInterval> = setInterval(() => {
      if (closed || toolCallInFlight || !turnInFlight) return;
      if (Date.now() - lastEventAt > MID_SESSION_SILENCE_MS) {
        closed = true;
        killChild();
        pushEvents([{ type: '__hang__' }]);
      }
    }, 30_000);
    silenceWatchdog.unref?.();

    let sessionId: string | undefined;

    try {
      let first = true;
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextMessage = first ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}` : text;
        first = false;

        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let round = 0;

        turnInFlight = true;
        try {
        turnLoop: for (;;) {
          send(nextMessage);

          const collectedText: string[] = [];
          let sawResult = false;
          let resultError: string | undefined;

          for (;;) {
            const ev = await nextEvent();
            disarmHang();
            const kind = ev.type as string | undefined;

            if (kind === '__closed__' || kind === '__error__' || kind === '__hang__') {
              if (kind === '__error__') {
                throw ev.error as Error;
              }
              const hangSuspected = kind === '__hang__';
              throw new Error(
                hangSuspected
                  ? `QwenRpcAgentRunner: qwen produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
                    'This usually means it is stuck on a prompt headless mode has no way to answer. Run `qwen` ' +
                    `once manually in a real terminal in this project to check, then retry.${stderrTail ? `\nstderr: ${stderrTail.slice(-500)}` : ''}`
                  : `QwenRpcAgentRunner: qwen rpc process ended unexpectedly (${kind})` +
                    (stderrTail ? `\nstderr: ${stderrTail.slice(-500)}` : ''),
              );
            }

            const evSessionId = ev.session_id as string | undefined;
            if (evSessionId) sessionId = evSessionId;

            if (kind === 'assistant') {
              const message = ev.message as QwenRpcMessage | undefined;
              if (message) {
                const t = extractQwenRpcText(message);
                if (t) collectedText.push(t);
              }
              continue;
            }

            if (kind === 'result') {
              sawResult = true;
              const usage = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
              if (usage) {
                turnInputTokens += usage.input_tokens ?? 0;
                turnOutputTokens += usage.output_tokens ?? 0;
              }
              if (ev.subtype === 'error') {
                const err = ev.error as { message?: string } | string | undefined;
                resultError = typeof err === 'string' ? err : err?.message ?? 'qwen result: error';
              }
              break;
            }

            // system/init and anything else — drained and ignored.
          }

          if (resultError) {
            throw new Error(`QwenRpcAgentRunner: qwen turn failed: ${resultError}` + (stderrTail ? `\nstderr: ${stderrTail.slice(-500)}` : ''));
          }
          if (!sawResult) break turnLoop; // process closed before result — nothing to extract this round

          const rawText = collectedText.join('\n');
          const visibleText = rawText.replace(TOOL_CALL_RE, '').trim();
          if (visibleText) yield { type: 'assistant', session_id: sessionId, text: visibleText };

          const malformed: string[] = [];
          const calls = parseToolCalls([rawText], (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
          for (const note of malformed) yield { type: 'assistant', session_id: sessionId, text: note };
          if (calls.length === 0) break turnLoop;

          round += 1;
          if (round > MAX_TOOL_ROUNDS) {
            yield { type: 'assistant', session_id: sessionId, text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)` };
            break turnLoop;
          }

          toolCallInFlight = true;
          const results: string[] = [];
          try {
            for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
          } finally {
            toolCallInFlight = false;
            lastEventAt = Date.now();
          }
          nextMessage = formatToolResults(calls, results);
        }
        } finally {
          turnInFlight = false;
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
          'QwenRpcAgentRunner requires the Qwen Code CLI (qwen) on PATH. ' +
          'Install it: npm install -g @qwen-code/qwen-code, then run `qwen` once ' +
          'to authenticate. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    } finally {
      if (hangTimer) clearTimeout(hangTimer);
      clearInterval(silenceWatchdog);
      if (processExited) {
        if (killTimer) clearTimeout(killTimer);
      } else {
        if (!killTimer) killChild();
      }
    }
  }
}
