// packages/@monomind/cli/src/orgrt/pi-rpc-runner.ts
/**
 * PiRpcAgentRunner — AgentRunner impl backed by the Pi coding agent CLI's
 * `--mode rpc` (session-lifetime, bidirectional JSON-over-stdio), instead of
 * the default PiAgentRunner (pi-runner.ts), which spawns a fresh `pi --mode
 * json` process per mailbox turn.
 *
 * OPT-IN, not the default. Select via role/org `runtime: 'pi-rpc'`. Prefer
 * plain `runtime: 'pi'` (PiAgentRunner) unless you specifically want the
 * benefit this buys: the subprocess stays alive for the WHOLE mailbox
 * session, so conversational context carries naturally (no --session-dir
 * resume guessing) and there's no per-turn spawn/bootstrap cost.
 *
 * Protocol — JSON objects, one per line (LF-delimited), verified against
 * pi-mono's rpc.md doc source directly (literal JSON examples quoted below,
 * not paraphrased from prose — unlike this file's sibling runners, which
 * work from public docs that don't always show raw wire examples):
 *
 *   Client → server (this runner sends), each with an optional "id" for
 *   response correlation:
 *     {"type":"prompt","message":"<text>"}          — new/continuing turn
 *     {"type":"get_state"}                           — poll idle/streaming status
 *     {"type":"abort"}                                — not used by this runner
 *
 *   Server → client:
 *     {"type":"response","command":"prompt","success":true}
 *     {"type":"response","command":"get_state","success":true,
 *      "data":{"isStreaming":false, ...}}
 *     {"type":"agent_start"}
 *     {"type":"message_update","usage":{"input":N,"output":N,"totalTokens":N,
 *      "cost":{"total":N}},"assistantMessageEvent":{...}}   — streaming deltas, ignored
 *     {"type":"message_end","message":{"role":"assistant","content":[
 *        {"type":"text","text":"..."},
 *        {"type":"thinking","thinking":"..."},
 *        {"type":"toolCall","id":"call_1","name":"bash","arguments":{...}}
 *      ]}}
 *
 * KNOWN GAP — turn-completion detection is a best-effort HEURISTIC, not a
 * confirmed protocol contract: pi executes its own native tools (bash, file
 * edits, …) autonomously inside the RPC session, so a single `prompt` can
 * produce MULTIPLE agent_start/message_end cycles before pi is genuinely
 * done responding, and the docs don't show an explicit "fully idle" event
 * distinct from message_end. This runner sends `get_state` after every
 * message_end and treats `data.isStreaming === false` as "done" — a
 * reasonable, protocol-grounded inference (get_state IS documented), but
 * NOT independently verified against a live pi install (none was available
 * here). If pi's real behavior differs, this could end a turn early or hang
 * waiting past STARTUP_GRACE_MS. Validate against a real `pi --mode rpc`
 * session before relying on this in production; fall back to plain
 * `runtime: 'pi'` if it misbehaves.
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Pi's own native tools (bash, file edits) execute autonomously inside pi
 *   itself and never reach this runner — only org tools ride the shared
 *   tool-fence protocol (tool-fence.ts), extracted from message_end's text
 *   content and fed back as a new `prompt` command in the SAME session.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';

/** Distinct from a turn timeout — this is how long we wait for pi to settle
 *  to isStreaming:false after a message_end before giving up on the
 *  heuristic and treating the turn as complete anyway (better to risk
 *  cutting a turn slightly short than to hang forever on a wrong inference). */
const SETTLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STARTUP_GRACE_MS = 45_000;

interface PiContentBlock { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: Record<string, unknown>; }
interface PiRpcMessage { content?: PiContentBlock[]; }

/** Pure, transport-independent JSONL line decoder — feed it raw string
 *  chunks, get back every complete parsed object found so far (silently
 *  skipping malformed lines rather than throwing, matching this repo's
 *  other subprocess parsers). Exported for unit testing without a real
 *  subprocess. */
export class JsonlDecoder {
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

/** Encode a client→server RPC command as one LF-terminated JSON line.
 *  Exported for unit testing the exact wire format. */
export function encodePiRpcCommand(cmd: { type: string; message?: string; id?: string }): string {
  return JSON.stringify(cmd) + '\n';
}

/** Extract assistant-visible text and org tool_call fences from a
 *  message_end event's `message.content` array. `thinking` blocks are
 *  dropped (internal reasoning, not meant for the bus); `toolCall` blocks
 *  are pi's own native tool calls, executed autonomously by pi itself —
 *  this runner never sees their results and doesn't need to. Exported for
 *  unit testing against fixture content arrays. */
export function extractPiRpcText(message: PiRpcMessage): string {
  return (message.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** The subset of a spawned child process this runner needs — narrower than
 *  node:child_process's real type, and deliberately duck-typed so tests can
 *  supply a fake implementation (an EventEmitter-backed fake process) to
 *  exercise the full turn-completion state machine without a real `pi`
 *  binary. Given the residual protocol-inference risk documented in this
 *  file's header, testing the orchestration logic itself — not just the
 *  pure JSONL/extraction helpers — is the point of this seam. */
export interface PiRpcProcess {
  stdin: { write(data: string): void } | null;
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: 'data', cb: (chunk: Buffer) => void): void } | null;
  on(event: 'close', cb: (code: number | null) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  kill(signal?: string): void;
}

export type SpawnPiRpc = (bin: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => PiRpcProcess;

const defaultSpawnPiRpc: SpawnPiRpc = (bin, args, opts) =>
  spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as PiRpcProcess;

export class PiRpcAgentRunner implements AgentRunner {
  constructor(private piBin?: string, private spawnFn: SpawnPiRpc = defaultSpawnPiRpc) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.piBin || process.env.PI_CLI_BIN || 'pi';
    const sessionDir = join(args.cwd, '.monomind-pi-session');

    const cliArgs = ['--mode', 'rpc', '--approve', '--session-dir', sessionDir];
    if (args.model) cliArgs.push('--model', args.model);

    const child = this.spawnFn(bin, cliArgs, {
      cwd: args.cwd,
      env: { ...process.env, PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', ...args.env },
    });

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-4000); });

    const decoder = new JsonlDecoder();
    const eventQueue: Record<string, unknown>[] = [];
    const waiters: Array<(ev: Record<string, unknown>) => void> = [];
    let closed = false;
    let closeCode: number | null = null;
    // Bumped only by REAL stdout activity (not the synthetic __closed__/
    // __error__/__hang__ events pushed below) — see silenceWatchdog further
    // down, which uses this to detect a mid-session hang.
    let lastEventAt = Date.now();

    const pushEvents = (evs: Record<string, unknown>[]) => {
      for (const ev of evs) {
        const waiter = waiters.shift();
        if (waiter) waiter(ev);
        else eventQueue.push(ev);
      }
    };
    child.stdout?.on('data', (c: Buffer) => { lastEventAt = Date.now(); pushEvents(decoder.feed(c.toString())); });
    child.on('close', (code) => { closed = true; closeCode = code; pushEvents([{ type: '__closed__', code }]); });
    child.on('error', (err) => { closed = true; pushEvents([{ type: '__error__', error: err }]); });

    const nextEvent = (): Promise<Record<string, unknown>> => {
      const queued = eventQueue.shift();
      if (queued) return Promise.resolve(queued);
      if (closed) return Promise.resolve({ type: '__closed__', code: closeCode });
      return new Promise((resolve) => waiters.push(resolve));
    };

    const send = (cmd: { type: string; message?: string; id?: string }): void => {
      child.stdin?.write(encodePiRpcCommand(cmd));
    };

    // SIGTERM→SIGKILL escalation, matching the other subprocess runners'
    // pattern — a hang detection that only ever sends SIGTERM would leave a
    // zombie process behind if pi ignores it.
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const killChild = (): void => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
      killTimer.unref?.();
    };

    // Startup-hang detection — same rationale as the other subprocess
    // runners' STARTUP_GRACE_MS, applied once at process start rather than
    // per turn since the process is long-lived here.
    let sawAnyEvent = false;
    let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      if (!sawAnyEvent) { closed = true; killChild(); pushEvents([{ type: '__hang__' }]); }
    }, STARTUP_GRACE_MS);

    const disarmHang = () => { if (!sawAnyEvent) { sawAnyEvent = true; if (hangTimer) { clearTimeout(hangTimer); hangTimer = undefined; } } };

    // Rolling watchdog — catches a hang AFTER the startup check has already
    // passed (e.g. pi wedges mid-session on turn 5), which the one-shot
    // startup timer above can't see since it disarms itself on the first
    // event. Checked periodically rather than a single per-turn timer,
    // since a turn's own wait can legitimately take a long time (real model
    // latency) — what matters is total SILENCE from the process, not how
    // long any one turn takes.
    const MID_SESSION_SILENCE_MS = SETTLE_TIMEOUT_MS; // reuse the same bound the settle-heuristic gives up at
    const silenceWatchdog: ReturnType<typeof setInterval> = setInterval(() => {
      if (closed) return;
      if (Date.now() - lastEventAt > MID_SESSION_SILENCE_MS) {
        closed = true;
        killChild();
        pushEvents([{ type: '__hang__' }]);
      }
    }, 30_000);
    silenceWatchdog.unref?.();

    try {
      let first = true;
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextMessage = first ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}` : text;
        first = false;

        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let round = 0;

        turnLoop: for (;;) {
          send({ type: 'prompt', message: nextMessage });

          const collectedText: string[] = [];
          const settleDeadline = Date.now() + SETTLE_TIMEOUT_MS;
          let sawMessageEnd = false;

          for (;;) {
            const ev = await nextEvent();
            disarmHang();
            const kind = ev.type as string | undefined;

            if (kind === '__closed__' || kind === '__error__' || kind === '__hang__') {
              if (kind === '__error__') {
                // Rethrow the ORIGINAL spawn error (not a fresh generic one)
                // so the outer catch's `err.code === 'ENOENT'` check below
                // can actually match it — a wrapped/re-created Error loses
                // the .code property, which silently broke the "missing pi
                // binary" install-instructions message.
                throw ev.error as Error;
              }
              const hangSuspected = kind === '__hang__';
              throw new Error(
                hangSuspected
                  ? `PiRpcAgentRunner: pi produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
                    'This usually means it is stuck on a prompt headless mode has no way to answer. Run `pi` ' +
                    `once manually in a real terminal in this project to check, then retry.${stderrTail ? `\nstderr: ${stderrTail.slice(-500)}` : ''}`
                  : `PiRpcAgentRunner: pi rpc process ended unexpectedly (${kind})` +
                    (stderrTail ? `\nstderr: ${stderrTail.slice(-500)}` : ''),
              );
            }

            if (kind === 'message_update') {
              // Overwrite (not accumulate) — the confirmed example in this
              // file's header shows `usage` as a running total FOR THE
              // CURRENT RESPONSE, so the latest value read during a turn is
              // that turn's correct total. UNCONFIRMED: whether it's scoped
              // to the current prompt or to the whole (session-lifetime) rpc
              // process. If it turns out to be session-cumulative, every
              // turn after the first would over-report by including prior
              // turns' tokens — inflating org budget consumption. Validate
              // against a live pi install before relying on this for tight
              // budget enforcement; this is exactly the kind of gap opt-in
              // 'pi-rpc' (vs. default 'pi') is meant to warn callers about.
              const usage = ev.usage as { input?: number; output?: number } | undefined;
              if (usage) {
                turnInputTokens = usage.input ?? turnInputTokens;
                turnOutputTokens = usage.output ?? turnOutputTokens;
              }
              continue;
            }

            if (kind === 'message_end') {
              sawMessageEnd = true;
              const message = ev.message as PiRpcMessage | undefined;
              if (message) {
                const text2 = extractPiRpcText(message);
                if (text2) collectedText.push(text2);
              }
              // See file header: get_state is the documented, best-effort
              // signal for "pi is done responding to this prompt", since a
              // single prompt can trigger multiple internal tool-use cycles.
              send({ type: 'get_state' });
              continue;
            }

            if (kind === 'response' && ev.command === 'get_state') {
              const data = ev.data as { isStreaming?: boolean } | undefined;
              if (data?.isStreaming === false) break; // turn settled — fall through to tool-fence handling below
              if (Date.now() > settleDeadline) break; // heuristic gave up — proceed rather than hang forever
              continue; // still streaming — keep waiting for more message_end cycles
            }

            // agent_start, other response acks, tool_execution_* (pi's own
            // native tools — nothing for this runner to do) — ignored.
          }

          if (!sawMessageEnd) break turnLoop; // nothing to extract this round — avoid an infinite loop on an empty settle

          const rawText = collectedText.join('\n');
          const visibleText = rawText.replace(TOOL_CALL_RE, '').trim();
          if (visibleText) yield { type: 'assistant', text: visibleText };

          const malformed: string[] = [];
          const calls = parseToolCalls([rawText], (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) break turnLoop;

          round += 1;
          if (round > MAX_TOOL_ROUNDS) {
            yield { type: 'assistant', text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)` };
            break turnLoop;
          }

          const results: string[] = [];
          for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
          nextMessage = formatToolResults(calls, results);
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
          'PiRpcAgentRunner requires the Pi coding agent CLI (pi) on PATH. ' +
          'Install it: npm install -g @mariozechner/pi-coding-agent, then configure a ' +
          'provider. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    } finally {
      if (hangTimer) clearTimeout(hangTimer);
      if (killTimer) clearTimeout(killTimer);
      clearInterval(silenceWatchdog);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }
}
