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
 * Protocol — JSON objects, one per line (LF-delimited). RESOLVED against a
 * live pi v0.73.1 install (issue #179): pi's docs (docs/rpc.md, bundled with
 * the package) define `agent_end` — "Emitted when the agent completes.
 * Contains all messages generated during this run." — as a distinct event
 * from `message_end`/`turn_end`, and it's exactly the "prompt is fully done"
 * signal this runner needs. Confirmed live with a prompt that made pi run 3
 * of its own native tools in sequence (read → edit → bash): the run produced
 * 4 separate turn_start/turn_end cycles and many message_end events, but
 * EXACTLY ONE agent_end, firing only after the last turn closed. This
 * replaces the old get_state-polling heuristic entirely — no more `isStreaming`
 * ambiguity to worry about.
 *
 *   Client → server (this runner sends), each with an optional "id" for
 *   response correlation:
 *     {"type":"prompt","message":"<text>"}          — new/continuing turn
 *     {"type":"abort"}                                — not used by this runner
 *
 *   Server → client (only agent_end is acted on; everything else — agent_start,
 *   turn_start/turn_end, message_start/message_update/message_end,
 *   tool_execution_* — is drained and ignored):
 *     {"type":"response","command":"prompt","success":true}
 *     {"type":"agent_end","messages":[
 *        {"role":"user","content":[{"type":"text","text":"..."}]},
 *        {"role":"assistant","content":[
 *           {"type":"thinking","thinking":"..."},
 *           {"type":"text","text":"..."},
 *           {"type":"toolCall","id":"call_1","name":"bash","arguments":{...}}
 *         ],"usage":{"input":N,"output":N,"totalTokens":N,"cost":{"total":N}}},
 *        {"role":"toolResult","content":[{"type":"text","text":"..."}]},
 *        ... (repeats per internal turn — one "assistant" entry per turn,
 *             each with ITS OWN per-turn `usage`, not cumulative)
 *      ]}
 *
 * Usage accounting: `agent_end.messages` includes one `assistant` entry per
 * internal turn, each carrying that turn's OWN `usage` (confirmed live: a
 * 4-turn run had usage.output of 65/109/13/22 across the 4 assistant
 * entries — small, turn-scoped numbers, not a running cumulative total).
 * This runner sums `usage.input`/`usage.output` across every assistant
 * entry in `agent_end.messages` to get the correct total for the prompt.
 * The PREVIOUS implementation (overwriting from `message_update`'s running
 * total, which only tracks the CURRENT assistant message) silently
 * undercounted any prompt that triggered more than one internal turn —
 * confirmed via the same live test above.
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Pi's own native tools (bash, file edits) execute autonomously inside pi
 *   itself and never reach this runner — only org tools ride the shared
 *   tool-fence protocol (tool-fence.ts), extracted from the assistant text
 *   in `agent_end.messages` and fed back as a new `prompt` command in the
 *   SAME session.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';

/** Upper bound on how long a single prompt's wait for `agent_end` may run
 *  before the mid-session silence watchdog (below) considers pi wedged.
 *  Distinct from a hard per-turn deadline — a long-running prompt that's
 *  still producing events well within this window is not a hang; only
 *  total SILENCE past this bound is. */
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

    // No --approve: confirmed against a live v0.73.1 install that pi rejects
    // it outright ("Unknown option: --approve") — no such flag exists.
    // Confirmed unnecessary too: built-in tools (read/edit/bash) execute
    // autonomously in --mode rpc with zero confirmation gating (a live
    // multi-tool prompt — read, edit, bash — ran end-to-end with no prompt
    // or block). See #179.
    const cliArgs = ['--mode', 'rpc', '--session-dir', sessionDir];
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
    // Distinct from `closed` (which WE set to stop routing new commands, e.g.
    // as soon as a hang is suspected) — this is only true once the OS
    // confirms the process actually exited. The finally block below uses it
    // to decide whether a pending SIGKILL escalation is still needed.
    let processExited = false;
    child.on('close', (code) => { closed = true; processExited = true; closeCode = code; pushEvents([{ type: '__closed__', code }]); });
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
    //
    // PAUSED (not just clock-bumped) whenever this runner isn't actually
    // waiting on pi — either an org tool call is in flight (executeToolCall
    // can run ask_human, which waits on a real person and can legitimately
    // take far longer than MID_SESSION_SILENCE_MS), or there's no turn in
    // flight at all: `for await (const p of args.prompt)` blocks on the
    // ROLE'S OWN MAILBOX (session.ts), which idles for as long as the role
    // has nothing new to do — completely normal, and NOT "pi is wedged".
    // A pure "bump lastEventAt" approach would still let the watchdog fire
    // mid-wait for anything slower than the silence window itself; pausing
    // the check entirely for the duration is the correct fix in both cases.
    let toolCallInFlight = false;
    let turnInFlight = false;
    const MID_SESSION_SILENCE_MS = SETTLE_TIMEOUT_MS; // reuse the same bound as the ceiling for total event silence
    const silenceWatchdog: ReturnType<typeof setInterval> = setInterval(() => {
      if (closed || toolCallInFlight || !turnInFlight) return;
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

        // The silence watchdog only applies from here to the end of this
        // turn's work — see its declaration above. Always cleared in
        // `finally` so a thrown error (which exits the loop) can't leave it
        // stuck true and permanently disable the watchdog for the rest of
        // the session.
        turnInFlight = true;
        try {
        turnLoop: for (;;) {
          send({ type: 'prompt', message: nextMessage });

          let agentEndMessages: Array<{ role: string; content?: PiContentBlock[]; usage?: { input?: number; output?: number } }> | undefined;

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

            if (kind === 'agent_end') {
              // See file header: agent_end is pi's own, confirmed-live,
              // single unambiguous "this prompt is fully done" signal —
              // fires exactly once even across multiple internal
              // turn_start/turn_end cycles from pi's own native tool use.
              agentEndMessages = ev.messages as typeof agentEndMessages;
              break;
            }

            // agent_start, turn_start/turn_end, message_start/message_update/
            // message_end, tool_execution_* (pi's own native tools), other
            // response acks — all drained and ignored; agent_end alone
            // carries everything this runner needs (final text + usage).
          }

          if (!agentEndMessages) break turnLoop; // process closed before agent_end — nothing to extract this round

          const assistantMessages = agentEndMessages.filter((m) => m.role === 'assistant');
          for (const m of assistantMessages) {
            // Summed, not overwritten: each assistant entry carries ITS OWN
            // per-turn usage (confirmed live — see file header), so summing
            // across every internal turn in this agent_end is the correct
            // total for the prompt just sent.
            if (m.usage) {
              turnInputTokens += m.usage.input ?? 0;
              turnOutputTokens += m.usage.output ?? 0;
            }
          }

          const rawText = assistantMessages.map((m) => extractPiRpcText(m)).filter(Boolean).join('\n');
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

          // Pause the silence watchdog for the duration — see its
          // declaration above for why a call like ask_human blocking on a
          // human isn't "pi is wedged". Always un-paused in `finally` so an
          // exception out of executeToolCall can't leave it stuck off.
          toolCallInFlight = true;
          const results: string[] = [];
          try {
            for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
          } finally {
            toolCallInFlight = false;
            lastEventAt = Date.now(); // the post-tool-call silence window starts fresh, not already partway elapsed
          }
          nextMessage = formatToolResults(calls, results);
        }
        } finally {
          turnInFlight = false;
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
      clearInterval(silenceWatchdog);
      if (processExited) {
        // Process is confirmed dead — any pending SIGKILL escalation from
        // killChild() is no longer needed.
        if (killTimer) clearTimeout(killTimer);
      } else {
        // NOT confirmed dead (e.g. the hang/silence watchdog fired and
        // sent SIGTERM, but the process hasn't closed yet). Clearing
        // killTimer here would cancel the SIGKILL escalation mid-grace-
        // period and orphan a process that's ignoring SIGTERM — exactly
        // the wedged case these watchdogs exist to handle. Leave the
        // existing (unref'd) escalation timer running, or arm a fresh one
        // if we're exiting via a path that never called killChild() at all.
        if (!killTimer) killChild();
      }
    }
  }
}
