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
 * Streaming / liveness — WHY INCREMENTAL (#204):
 *   This runner originally buffered ALL of qwen's stdout until the subprocess
 *   exited before parsing anything, so any turn longer than session.ts's
 *   4-minute silent-stream watchdog (SILENT_SESSION_MS) yielded zero messages
 *   in time — abort, retry, kill, circuit breaker. Same bug class as the
 *   kimi/antigravity/codex runners had (#204 audit). This runner now parses
 *   stdout LINE BY LINE as it arrives: a liveness `tool_use` message is
 *   yielded the moment the subprocess spawns (deterministically winning the
 *   first-pull race regardless of model-thinking latency), and each
 *   `assistant` event's text is yielded as its line lands (qwen's
 *   stream-json sends whole messages per event, not per-token deltas —
 *   confirmed live, #182 — so no accumulation is needed, unlike agy).
 *   Tool_call fences are still collected from the raw texts and parsed at
 *   end of turn (fence parsing needs the complete text).
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
 *     would otherwise hang a non-interactive run). No distinct tool-call
 *     wire event is documented/observed for this CLI, so — unlike codex's
 *     command_execution items — there is nothing else here to forward as
 *     mid-turn tool liveness beyond the spawn-time yield.
 */
import { spawn } from 'node:child_process';
import {
  type AgentMessage,
  type AgentRunArgs,
  type AgentRunner,
  killOnAbort,
} from './agent-runner.js';
import { classifyStderr } from './kimicode-runner.js';
import {
  buildToolProtocol,
  executeToolCall,
  formatToolResults,
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  TOOL_CALL_RE,
} from './tool-fence.js';

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

/**
 * One parsed qwen stream-json event, normalized for incremental streaming.
 *   - 'assistant': rawText is one whole assistant message (fences intact) for
 *     end-of-turn tool-call parsing; text is the fence-stripped prose,
 *     present only when non-empty.
 *   - 'tool':      liveness only — this runner has no live-verified wire
 *     event for qwen's own tool activity, so the only 'tool' event is the
 *     spawn-time yield (see header).
 *   - 'meta':      any other event that only carries a session id.
 */
export interface QwenStreamEvent {
  kind: 'assistant' | 'tool' | 'meta';
  text?: string;
  rawText?: string;
  toolName?: string;
  sessionId?: string;
}

interface TurnOutcome {
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

/**
 * Normalize one parsed qwen wire event into a QwenStreamEvent (or null for
 * events that carry nothing new). Usage/error facts are written into
 * `outcome` since they apply to the whole turn, not to a single event.
 */
function handleQwenEvent(
  ev: QwenEvent,
  outcome: Pick<TurnOutcome, 'inputTokens' | 'outputTokens' | 'error'>,
): QwenStreamEvent | null {
  if (ev.type === 'assistant' && ev.message?.content) {
    const text = ev.message.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
    if (!text) return ev.session_id ? { kind: 'meta', sessionId: ev.session_id } : null;
    const stripped = text.replace(TOOL_CALL_RE, '').trim();
    return {
      kind: 'assistant',
      rawText: text,
      text: stripped || undefined,
      sessionId: ev.session_id,
    };
  }

  if (ev.type === 'result') {
    if (ev.usage) {
      outcome.inputTokens = ev.usage.input_tokens ?? 0;
      outcome.outputTokens = ev.usage.output_tokens ?? 0;
    }
    if (ev.subtype === 'error') {
      outcome.error =
        typeof ev.error === 'string' ? ev.error : (ev.error?.message ?? 'qwen result: error');
    }
    return { kind: 'meta', sessionId: ev.session_id };
  }

  // 'system' events and anything else — only the session id (if any) matters.
  return ev.session_id ? { kind: 'meta', sessionId: ev.session_id } : null;
}

/** Pure stream-json parser — exported for unit testing against fixture lines
 *  built from Qwen Code's documented event schema (qwen-runner.test.ts).
 *  Built on the same handleQwenEvent() the live streaming path uses. */
export function parseQwenEvents(lines: string[]): {
  texts: string[];
  rawTexts: string[];
  sessionId?: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
} {
  const rawTexts: string[] = [];
  const texts: string[] = [];
  let sessionId: string | undefined;
  const outcome: Pick<TurnOutcome, 'inputTokens' | 'outputTokens' | 'error'> = {
    inputTokens: 0,
    outputTokens: 0,
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed?.startsWith('{')) continue;
    let ev: QwenEvent;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const out = handleQwenEvent(ev, outcome);
    if (!out) continue;
    if (out.sessionId) sessionId = out.sessionId;
    if (out.kind === 'assistant') {
      if (out.rawText !== undefined) rawTexts.push(out.rawText);
      if (out.text) texts.push(out.text);
    }
  }

  return {
    texts,
    rawTexts,
    sessionId,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    error: outcome.error,
  };
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

          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            hangSuspected: false,
            inputTokens: 0,
            outputTokens: 0,
          };
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];

          for await (const ev of this.streamTurn(bin, promptWithSystem, sessionId, args, outcome)) {
            if (ev.sessionId) sessionId = ev.sessionId;
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per event, not after
              // process exit): a qwen turn can run many minutes, and
              // session.ts's watchdog must see messages DURING the turn.
              // Note this means partial output may already be yielded when
              // a turn later exits non-zero — preferable to losing it
              // entirely.
              if (ev.text) yield { type: 'assistant', session_id: sessionId, text: ev.text };
            } else if (ev.kind === 'tool') {
              // Liveness only (see header): session.ts never renders
              // tool_use as chat — it only feeds the StateDetector
              // ('tool-call' state) and refreshes last-activity.
              yield { type: 'tool_use', session_id: sessionId, text: ev.toolName };
            }
          }
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
            throw turnError(outcome, round);
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed)
            yield { type: 'assistant', session_id: sessionId, text: note };
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant',
              session_id: sessionId,
              text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)`,
            };
            break;
          }

          const results: string[] = [];
          for (const call of calls)
            results.push(await executeToolCall(args.tools, call, args.canUseTool));
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

  /**
   * Run one `qwen` invocation and stream its stream-json output
   * INCREMENTALLY: each parsed event is yielded as soon as its line arrives
   * on stdout (see the header's "Streaming / liveness" note for why
   * buffering until process exit was a bug, #204). End-of-turn facts (exit
   * code, stderr tail, session id, usage, error, timeout/hang flags) are
   * written into `outcome`, which the caller reads after this generator
   * completes.
   */
  private async *streamTurn(
    bin: string,
    prompt: string,
    sessionId: string | undefined,
    args: AgentRunArgs,
    outcome: TurnOutcome,
  ): AsyncGenerator<QwenStreamEvent> {
    const cliArgs: string[] = ['-p', prompt, '--output-format', 'stream-json', '--yolo'];
    if (args.model) cliArgs.push('-m', args.model);
    if (sessionId) cliArgs.push('--resume', sessionId);

    const child = spawn(bin, cliArgs, {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });

    // Arm the turn timeout BEFORE consuming stdout — a hung CLI must be
    // killed while we're still reading, not after it finishes.
    let timedOut = false;
    let hangSuspected = false;
    // SIGTERM→SIGKILL escalation, shared by the turn timeout, the startup
    // hang check, the abort signal, and the abandoned-stream path in
    // `finally` — a CLI that ignores SIGTERM must not leak a zombie per turn.
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
    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, TURN_TIMEOUT_MS);

    // See STARTUP_GRACE_MS — disarmed by the first stdout chunk below.
    let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      hangSuspected = true;
      killChild();
    }, STARTUP_GRACE_MS);
    // Abort hook (see AgentRunArgs.signal): kill the child so the stdout
    // loop below unblocks instead of orphaning it on iterator.return().
    const unsubscribeAbort = killOnAbort(args.signal, child, KILL_GRACE_MS);

    // Attach the exit promise BEFORE consuming stdout: on a spawn failure
    // (ENOENT, bad binary) the 'error' event fires almost immediately — if
    // no listener is attached yet it escapes as an unhandled 'error' event
    // and crashes the process instead of reaching our catch block.
    const exitPromise = new Promise<number>((res, rej) => {
      child.on('error', rej);
      child.on('close', (code) => res(code ?? 1));
    });
    // Prevent an unhandled-rejection crash if the stdout loop below throws
    // before we await exitPromise (the await still sees the rejection).
    exitPromise.catch(() => {});

    let lastSessionId: string | undefined = sessionId;

    try {
      // Immediate liveness yield: session.ts races the FIRST pull against a
      // 4-minute silent-stream watchdog, and qwen's first stdout line can
      // itself take minutes (long thinking chains, large file reads).
      // Yielding at spawn wins that race deterministically instead of
      // depending on qwen's latency.
      yield { kind: 'tool', toolName: 'turn started', sessionId };

      let buf = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        // Any stdout at all disarms the hang-suspicion timer — see
        // STARTUP_GRACE_MS.
        if (hangTimer) {
          clearTimeout(hangTimer);
          hangTimer = undefined;
        }
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed?.startsWith('{')) continue;
          let ev: QwenEvent;
          try {
            ev = JSON.parse(trimmed) as QwenEvent;
          } catch {
            continue;
          }
          const out = handleQwenEvent(ev, outcome);
          if (out) {
            if (out.sessionId) lastSessionId = out.sessionId;
            yield out;
          }
        }
      }
      const tail = buf.trim();
      if (tail?.startsWith('{')) {
        try {
          const out = handleQwenEvent(JSON.parse(tail) as QwenEvent, outcome);
          if (out) {
            if (out.sessionId) lastSessionId = out.sessionId;
            yield out;
          }
        } catch {
          /* not JSON, skip */
        }
      }
    } finally {
      clearTimeout(timer);
      if (hangTimer) clearTimeout(hangTimer);
      unsubscribeAbort();
      if (child.exitCode === null && child.signalCode === null) {
        // NOT confirmed dead. Either the consumer abandoned this stream
        // mid-turn (session.ts's silent abort calls iterator.return(), the
        // mailbox closes, or an error is thrown downstream) — kill it, WITH
        // the SIGKILL escalation — or a SIGTERM from the timeout/hang/abort
        // is still inside its grace period: leave that escalation armed,
        // since clearing it here would orphan a CLI that ignores SIGTERM and
        // then wait on `exitPromise` forever (same fix as codex/kimi/pi-rpc).
        if (!child.killed) killChild();
      } else if (killTimer) {
        clearTimeout(killTimer);
      }
    }

    const exitCode = await exitPromise;
    if (killTimer) clearTimeout(killTimer);
    outcome.sessionId = lastSessionId;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
    outcome.hangSuspected = hangSuspected;
  }
}

/** Build the actionable error for a failed qwen turn. */
function turnError(outcome: TurnOutcome, round: number): Error {
  if (outcome.timedOut) {
    return new Error(
      `QwenAgentRunner: qwen turn (tool round ${round}) exceeded the ${TURN_TIMEOUT_MS / 3_600_000}h ` +
        `turn timeout and was killed.${outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  // Fatal provider errors (auth/permission/quota — classified from the error
  // field AND stderr): report what actually happened, and tag the error so
  // the daemon does NOT restart into the same guaranteed failure (a restart
  // on quota exhaustion can only hang or fail again).
  const cls = classifyStderr(`${outcome.error ?? ''}\n${outcome.stderrTail}`);
  if (cls.fatal) {
    const err = new Error(
      `QwenAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.error ? ` error: ${outcome.error}` : '') +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `QwenAgentRunner: qwen failed (exit ${outcome.exitCode})` +
      (outcome.error ? `: ${outcome.error}` : '') +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
