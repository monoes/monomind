// packages/@monomind/cli/src/orgrt/pi-rpc-runner.ts
/**
 * PiRpcAgentRunner — AgentRunner impl backed by the Pi coding agent CLI's
 * `--mode rpc` (session-lifetime, bidirectional JSON-over-stdio), instead of
 * the default PiAgentRunner (pi-runner.ts), which spawns a fresh `pi --mode
 * json` process per mailbox turn.
 *
 * OPT-IN, not the default. Select via role/org `runtime: 'pi-rpc'`. Prefer
 * plain `runtime: 'pi'` unless you specifically want the subprocess alive
 * for the WHOLE mailbox session (no per-turn spawn/bootstrap cost).
 *
 * Target: pi 0.87.1 (docs/rpc.md, docs/rpc-commands.md, docs/json.md — the
 * session events are the same as `--mode json`, without the `session`
 * header). Verified against a real pi 0.87.1 driven by a local
 * OpenAI-compatible endpoint (fixtures/pi-0.87/rpc-abort.jsonl).
 *
 * Invocation (pi-runner-state.ts's piCliArgs, shared with the json runner):
 *   pi --mode rpc --session-id <id> [--model m] [--thinking E]
 *      (--approve | --no-approve -ne -ns -np -nc)
 * `--session-id` keeps the session in pi's own store (nothing written into
 * the project) and makes it resumable: AgentRunArgs.resume reopens it, and
 * every result carries the id.
 *
 *   Client → server: {"type":"prompt","message":"<text>"} per round, and
 *     {"type":"abort"} for the emulated max-turns cap.
 *   Server → client: `response` acks (ignored — an abort's ack arrives after
 *     agent_settled), then session events. Exception: a `prompt` response
 *     with `success:false` (e.g. "No API key found") is the only reply pi
 *     sends, so it fails the turn at once (pi-rpc-runner-auth.ts).
 *
 * Completion: `agent_settled`. An `agent_end` with `willRetry:true` is
 * followed by `auto_retry_*` and another agent run, so the round keeps
 * reading; each agent_end's `messages` (only that low-level run's messages)
 * are collected until settle. An `agent_end` with no `willRetry` field at all
 * (a pre-0.8x pi with no agent_settled) completes the round by itself.
 *
 * Usage: summed over the assistant entries of the collected agent_end
 * messages (one per internal turn, each with its own usage — input, output,
 * cacheRead, cacheWrite, cost.total).
 *
 * Streaming — opt-in via AgentRunArgs.extras.includePartialMessages (agent
 * exec sets it; session.ts does not, it wants one AgentMessage per round):
 * `text_delta` increments stream fence-safely (PiTextStream), reconciled at
 * each assistant message_end and against agent_end's text. Without it, the
 * round's whole text is yielded once at settle.
 *
 * Native tools: `tool_execution_start`/`tool_execution_end` become matched
 * tool_use/tool_result pairs by toolCallId, like the json runner.
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   extracted from the assistant text and fed back as a new `prompt` in the
 *   SAME session.
 */
import { randomUUID } from 'node:crypto';
import {
  type AgentMessage,
  type AgentRunArgs,
  type AgentRunner,
  killOnAbort,
} from './agent-runner.js';
import { maskedCommand } from './authority-mask.js';
import { classifyStderr } from './kimicode-runner.js';
import { NativeToolCalls } from './kimicode-runner-tools.js';
import { realBinary } from './launcher-binary.js';
import { piAuthErrorFromText, piAuthPrecheck } from './pi-rpc-runner-auth.js';
import {
  defaultSpawnPiRpc,
  encodePiRpcCommand,
  JsonlDecoder,
  type PiRpcCommand,
  type SpawnPiRpc,
} from './pi-rpc-runner-io.js';
import { PI_INSTALL_HINT } from './pi-runner.js';
import { type PiEvent, parsePiEvent, piMessageText, piMessageUsage } from './pi-runner-parse.js';
import { PiRunTracker, PiTextStream, PiTurnBudget, piCliArgs } from './pi-runner-state.js';
import { omitAnthropicManagedKeys } from './provider.js';
import { withVendorRetries } from './provider-limit.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export {
  encodePiRpcCommand,
  extractPiRpcText,
  JsonlDecoder,
  type PiRpcProcess,
  type SpawnPiRpc,
} from './pi-rpc-runner-io.js';

/** Upper bound on total event SILENCE while a prompt is in flight before the
 *  mid-session watchdog (below) considers pi wedged. Not a per-turn
 *  deadline — a long prompt that keeps producing events is not a hang. */
const SETTLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const STARTUP_GRACE_MS = 45_000;

type EndMessage = {
  role?: string;
  content?: unknown;
  usage?: Parameters<typeof piMessageUsage>[0];
};

export class PiRpcAgentRunner implements AgentRunner {
  constructor(
    private piBin?: string,
    private spawnFn: SpawnPiRpc = defaultSpawnPiRpc,
  ) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const streamPartials = args.extras?.includePartialMessages === true;
    const bin = realBinary(this.piBin || process.env.PI_CLI_BIN || 'pi');
    const sessionId = args.resume || randomUUID();
    const tools = new NativeToolCalls();
    // Cumulative per session, like every runner's cost_usd.
    let runCostUsd: number | undefined;

    // o-18: ambient ANTHROPIC_* creds never belong to a non-Anthropic
    // vendor CLI; an explicit value in args.env still wins below.
    const env = {
      ...omitAnthropicManagedKeys(process.env),
      PI_TELEMETRY: '0',
      PI_SKIP_VERSION_CHECK: '1',
      ...args.env,
    };
    // Fail before spawning when pi itself says the model has no usable
    // credential — pi would only reject the prompt (pi-rpc-runner-auth.ts).
    const notReady = await piAuthPrecheck(bin, args.model, {
      env,
      cwd: args.cwd,
      signal: args.signal,
    });
    if (notReady) throw notReady;

    const child = this.spawnFn(
      ...maskedCommand(args.authorityMask, bin, piCliArgs('rpc', sessionId, args)),
      { cwd: args.cwd, env },
      args,
    );

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });

    const decoder = new JsonlDecoder();
    const eventQueue: Record<string, unknown>[] = [];
    const waiters: Array<(ev: Record<string, unknown>) => void> = [];
    let closed = false;
    let closeCode: number | null = null;
    // Bumped only by REAL stdout activity (not the synthetic __closed__/
    // __error__/__hang__ events) — the silence watchdog reads it.
    let lastEventAt = Date.now();

    const pushEvents = (evs: Record<string, unknown>[]) => {
      for (const ev of evs) {
        const waiter = waiters.shift();
        if (waiter) waiter(ev);
        else eventQueue.push(ev);
      }
    };
    child.stdout?.on('data', (c: Buffer) => {
      lastEventAt = Date.now();
      pushEvents(decoder.feed(c.toString()));
    });
    // Distinct from `closed` (which WE set to stop routing new commands) —
    // true only once the OS confirms the process exited; the finally block
    // uses it to decide whether a pending SIGKILL escalation is still needed.
    let processExited = false;
    child.on('close', (code) => {
      closed = true;
      processExited = true;
      closeCode = code;
      pushEvents([{ type: '__closed__', code }]);
    });
    child.on('error', (err) => {
      closed = true;
      pushEvents([{ type: '__error__', error: err }]);
    });
    // A write to a stdin the process already closed (EPIPE) surfaces as a
    // stream 'error'; without a listener it would crash the daemon instead
    // of failing this turn.
    child.stdin?.on?.('error', (err) => {
      closed = true;
      pushEvents([
        {
          type: '__error__',
          error: new Error(`PiRpcAgentRunner: failed to write to pi stdin: ${err.message}`),
        },
      ]);
    });

    const nextEvent = (): Promise<Record<string, unknown>> => {
      const queued = eventQueue.shift();
      if (queued) return Promise.resolve(queued);
      if (closed) return Promise.resolve({ type: '__closed__', code: closeCode });
      return new Promise((resolve) => waiters.push(resolve));
    };

    const send = (cmd: PiRpcCommand): void => {
      child.stdin?.write(encodePiRpcCommand(cmd));
    };

    // SIGTERM→SIGKILL escalation — a hang detection that only sent SIGTERM
    // would leave a zombie behind if pi ignores it.
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const killChild = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    };

    // Abort hook (see AgentRunArgs.signal): kill the long-lived child and
    // unblock whichever nextEvent() wait is in flight.
    const unsubscribeAbort = killOnAbort(args.signal, {
      kill: () => {
        if (closed) return;
        closed = true;
        killChild();
        pushEvents([{ type: '__aborted__' }]);
      },
    });

    // Startup-hang detection, once at process start (the process is long-lived).
    let sawAnyEvent = false;
    let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      if (!sawAnyEvent) {
        closed = true;
        killChild();
        pushEvents([{ type: '__hang__' }]);
      }
    }, STARTUP_GRACE_MS);
    const disarmHang = () => {
      if (!sawAnyEvent) {
        sawAnyEvent = true;
        if (hangTimer) {
          clearTimeout(hangTimer);
          hangTimer = undefined;
        }
      }
    };

    // Rolling watchdog for a mid-session wedge. PAUSED while an org tool
    // call is in flight (ask_human can wait on a person far longer than the
    // window) and while no prompt is in flight (the mailbox idles normally).
    let toolCallInFlight = false;
    let turnInFlight = false;
    const silenceWatchdog: ReturnType<typeof setInterval> = setInterval(() => {
      if (closed || toolCallInFlight || !turnInFlight) return;
      if (Date.now() - lastEventAt > SETTLE_TIMEOUT_MS) {
        closed = true;
        killChild();
        pushEvents([{ type: '__hang__' }]);
      }
    }, 30_000);
    silenceWatchdog.unref?.();

    try {
      let first = !args.resume;
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextMessage = first
          ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`
          : text;
        first = false;

        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let turnCacheRead = 0;
        let turnCacheWrite = 0;
        let round = 0;
        // Emulated max turns, per mailbox message across its tool rounds.
        const budget = new PiTurnBudget(args.maxTurns);

        turnInFlight = true;
        try {
          for (;;) {
            send({ type: 'prompt', message: nextMessage });
            const tracker = new PiRunTracker();
            const textStream = new PiTextStream(streamPartials);
            const endMessages: EndMessage[] = [];

            while (!tracker.settled) {
              const ev = await nextEvent();
              disarmHang();
              const kind = ev.type as string | undefined;

              if (
                kind === '__closed__' ||
                kind === '__error__' ||
                kind === '__hang__' ||
                kind === '__aborted__'
              ) {
                // Rethrow the ORIGINAL spawn error so the ENOENT check below
                // still sees its .code.
                if (kind === '__error__') throw ev.error as Error;
                // pi may print its no-credential error on stderr and exit.
                const authErr =
                  kind !== '__aborted__' ? piAuthErrorFromText(stderrTail, args.model) : undefined;
                if (authErr) throw authErr;
                throw new Error(
                  kind === '__hang__'
                    ? `PiRpcAgentRunner: pi produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
                        'This usually means it is stuck on a prompt headless mode has no way to answer. Run `pi` ' +
                        `once manually in a real terminal in this project to check, then retry.${stderrTail ? `\nstderr: ${stderrTail.slice(-500)}` : ''}`
                    : kind === '__aborted__'
                      ? 'PiRpcAgentRunner: pi turn aborted by the caller; the pi process was killed'
                      : `PiRpcAgentRunner: pi rpc process ended unexpectedly (${kind})` +
                        (stderrTail ? `\nstderr: ${stderrTail.slice(-500)}` : ''),
                );
              }

              // A rejected prompt is pi's only answer to it — no session
              // events follow, so waiting would sit on the silence watchdog.
              if (kind === 'response' && ev.command === 'prompt' && ev.success === false) {
                throw promptRejected(String(ev.error ?? ''), stderrTail, args.model);
              }

              const parsed = parsePiEvent(ev as PiEvent);
              if (!parsed) continue;
              tracker.observe(parsed, false);
              if (budget.observe(parsed)) send({ type: 'abort' });
              if (parsed.assistantStart) textStream.messageStart();
              if (parsed.textDelta) {
                const inc = textStream.delta(parsed.textDelta.index, parsed.textDelta.delta);
                if (inc) yield { type: 'assistant', session_id: sessionId, text: inc };
              }
              if (parsed.assistantEnd) {
                const inc = textStream.messageEnd(parsed.assistantText ?? '');
                if (streamPartials && inc)
                  yield { type: 'assistant', session_id: sessionId, text: inc };
              }
              if (parsed.toolStart) {
                const t = parsed.toolStart;
                const m = tools.start(t.id, t.name, t.input, sessionId);
                if (m) yield m;
              }
              if (parsed.toolEnd) {
                const t = parsed.toolEnd;
                yield* tools.end(t.id, t.output, t.isError, sessionId);
              }
              if (parsed.agentEnd && Array.isArray(ev.messages)) {
                endMessages.push(...(ev.messages as EndMessage[]));
              }
            }

            const assistantMessages = endMessages.filter((m) => m.role === 'assistant');
            for (const m of assistantMessages) tracker.addUsage(piMessageUsage(m.usage));
            turnInputTokens += tracker.inputTokens;
            turnOutputTokens += tracker.outputTokens;
            turnCacheRead += tracker.cacheReadTokens;
            turnCacheWrite += tracker.cacheWriteTokens;
            if (tracker.costUsd !== undefined) runCostUsd = (runCostUsd ?? 0) + tracker.costUsd;

            const rawText = assistantMessages.map(piMessageText).filter(Boolean).join('\n');
            // Only what the stream has not shown yet (everything, when not
            // streaming). An unclosed fence leaks through unchanged, matching
            // TOOL_CALL_RE leaving it untouched.
            const remainder = textStream.remainder(rawText);
            if (remainder) yield { type: 'assistant', session_id: sessionId, text: remainder };

            const failure = budget.hit ? undefined : tracker.failure();
            if (failure) throw withVendorRetries(rpcFailure(failure, stderrTail), tracker.retries);
            if (budget.hit) break;

            const malformed: string[] = [];
            const calls = parseToolCalls([rawText], (raw, err) =>
              malformed.push(
                `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
              ),
            );
            for (const note of malformed) yield { type: 'assistant', text: note };
            if (calls.length === 0) break;

            // Pause the silence watchdog for the org tool call (see above).
            toolCallInFlight = true;
            let ran: Awaited<ReturnType<typeof runToolRound>>;
            try {
              ran = await runToolRound(args, calls, round);
            } finally {
              toolCallInFlight = false;
              lastEventAt = Date.now(); // the post-tool-call silence window starts fresh
            }
            round += 1;
            if (ran.note) yield { type: 'assistant', text: ran.note };
            if (!ran.results) break;
            nextMessage = formatToolResults(calls, ran.results);
          }
        } finally {
          turnInFlight = false;
        }

        yield {
          type: 'result',
          session_id: sessionId,
          subtype: budget.hit ? 'error_max_turns' : 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
          ...(turnCacheRead ? { cache_read_input_tokens: turnCacheRead } : {}),
          ...(turnCacheWrite ? { cache_creation_input_tokens: turnCacheWrite } : {}),
          ...(runCostUsd !== undefined ? { cost_usd: runCostUsd } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `PiRpcAgentRunner requires the Pi coding agent CLI (pi) on PATH. Install it: ${PI_INSTALL_HINT}, ` +
            'then configure a provider. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    } finally {
      unsubscribeAbort();
      if (hangTimer) clearTimeout(hangTimer);
      clearInterval(silenceWatchdog);
      if (processExited) {
        // Confirmed dead — a pending SIGKILL escalation is no longer needed.
        if (killTimer) clearTimeout(killTimer);
      } else if (!killTimer) {
        // NOT confirmed dead: keep an escalation already armed by a watchdog
        // (clearing it would orphan a process ignoring SIGTERM), or arm one.
        killChild();
      }
    }
  }
}

/** The error for a `prompt` command pi answered with `success:false`: the
 *  missing-key error when it is pi's no-credential wording. */
function promptRejected(error: string, stderrTail: string, model: string | undefined): Error {
  return (
    piAuthErrorFromText(error, model) ??
    rpcFailure(`pi rejected the prompt: ${error || '(no error text)'}`, stderrTail)
  );
}

/** The error for a prompt pi settled on with a failure (a final assistant
 *  error or a failed auto-retry); auth/quota failures are tagged fatal. */
function rpcFailure(failure: string, stderrTail: string): Error {
  const cls = classifyStderr(`${failure}\n${stderrTail}`);
  const err = new Error(
    cls.fatal
      ? `PiRpcAgentRunner: FATAL provider error (${cls.label}) — not retrying. error: ${failure.slice(-500)}`
      : `PiRpcAgentRunner: pi reported an error: ${failure.slice(-500)}`,
  );
  if (cls.fatal) (err as Error & { fatal?: boolean }).fatal = true;
  return err;
}
