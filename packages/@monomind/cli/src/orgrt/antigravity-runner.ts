// packages/@monomind/cli/src/orgrt/antigravity-runner.ts
/**
 * AntigravityAgentRunner — AgentRunner impl backed by the Antigravity CLI (`agy`).
 *
 * Architectural pattern: SAME as KimiCodeAgentRunner and CodexAgentRunner —
 * spawn the vendor's CLI binary as a subprocess, parse its JSONL stream,
 * normalize to AgentMessage. No SDK dependency (Antigravity ships a Go binary
 * installed via curl, plus a Python SDK; no Node SDK exists).
 *
 * Auth: inherited from the OS keyring after `agy` interactive login. Google
 * AI Pro / Google AI Ultra consumer subscriptions flow through this credential
 * cache. No env vars needed.
 *
 * Streaming / liveness — WHY INCREMENTAL:
 *   agy turns routinely run many minutes when a role reads large dossiers or
 *   chains tool steps. session.ts races the FIRST pull from this runner
 *   against a 4-minute silent-stream watchdog (SILENT_SESSION_MS), so
 *   buffering stdout until process exit (the original design) meant any turn
 *   longer than 4 minutes yielded zero messages in time — abort, retry, kill,
 *   circuit breaker, stalled org (observed live: "SDK stream silent for 240s
 *   with zero messages" every ~4 minutes on antigravity roles). This runner
 *   therefore parses stdout LINE BY LINE as data arrives: a liveness
 *   `tool_use` message is yielded the moment the subprocess spawns
 *   (deterministically winning the first-pull race regardless of
 *   model-thinking latency), assistant text is yielded at agent_response DONE
 *   boundaries, and agy's own tool steps (step_type 'tool' with tool_info)
 *   are forwarded as `tool_use` liveness messages so the StateDetector/idle
 *   watchdog see a working agent throughout the turn. Tool_call fences are
 *   still collected from the raw texts and parsed at end of turn (fence
 *   parsing needs the complete text — agy's per-token deltas would split a
 *   fence across many events).
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Same approach as kimi/opencode/codex. Tools are rendered INTO the first
 *   prompt; the model emits ```tool_call fences; this runner parses them out
 *   of the agent_response text, executes the real OrgToolDef handlers
 *   in-process (gated through canUseTool), and feeds results back as the
 *   next prompt.
 *
 * Subprocess protocol (from https://antigravity.google/docs/cli/headless):
 *   - Invocation: `agy -p "<prompt>" --output-format stream-json
 *                  [--model X] [--dangerously-skip-permissions]
 *                  [--continue | --conversation <id>]`
 *   - NDJSON on stdout, one event per line
 *   - Event types: `init`, `step_update` (multiple), `result`
 *   - step_update carries `step_type` ∈ {user_input, agent_response, tool,
 *     checkpoint}, `state` ∈ {ACTIVE, DONE}, `text_delta` for streaming text,
 *     `tool_info` for tool calls, `subagent_info` for subagents
 *   - Assistant text arrives via step_update with step_type === 'agent_response'
 *     and text_delta (per-token streaming — unlike codex which sends whole items)
 *   - result envelope: { conversation_id, status, response, error, usage }
 *   - status ∈ {SUCCESS, ERROR, CANCELED, INTERRUPTED, INVALID, WAITING, RUNNING}
 *   - Resume: `--continue` (last session) or `--conversation <id>` (specific)
 *   - Session ID captured from result.conversation_id
 *   - stderr is human diagnostics; buffer and surface on non-zero exit only
 *   - Unknown --model fails loudly (exit 1, ERROR status)
 *   - Headless requires cached creds — must authenticate interactively first
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

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching kimi/codex runners

// Wire shape (verified against agy 0.35.0 stream-json output): each line is
// { "event": "init" | "step_update" | "result", ...payload nested under a
// key matching the event name }. init's conversation_id is a sibling of
// "event"/"init"; step_update's and result's fields live inside their own
// nested object — NOT flat on the top-level event.
interface AgyStepUpdatePayload {
  conversation_id?: string;
  step_index?: number;
  step_type?: 'user_input' | 'agent_response' | 'tool' | 'checkpoint' | 'unknown';
  state?: 'ACTIVE' | 'DONE';
  text_delta?: string;
  duration_seconds?: number;
  usage?: AgyUsage;
  tool_info?: { name: string; args?: Record<string, unknown> };
  subagent_info?: { name?: string };
}

interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

interface AgyResultPayload {
  conversation_id?: string;
  status?: 'SUCCESS' | 'ERROR' | 'CANCELED' | 'INTERRUPTED' | 'INVALID' | 'WAITING' | 'RUNNING';
  response?: string;
  error?: string;
  usage?: AgyUsage;
  duration_seconds?: number;
  num_turns?: number;
}

interface AgyEvent {
  event: 'init' | 'step_update' | 'result' | string;
  conversation_id?: string;
  init?: { model?: string; cwd?: string; tools?: string[]; permission_mode?: string };
  step_update?: AgyStepUpdatePayload;
  result?: AgyResultPayload;
}

/**
 * One parsed agy stream-json event, normalized for incremental streaming.
 *   - 'assistant': rawText is the accumulated agent_response text (fences
 *     intact) for end-of-turn tool-call parsing; text is the fence-stripped
 *     prose, present only when non-empty.
 *   - 'tool':      agy's own tool activity (step_type 'tool' with tool_info)
 *     — forwarded by run() as a `tool_use` liveness AgentMessage (see header).
 *   - 'meta':      any other event that only carries a conversation id.
 */
export interface AgyStreamEvent {
  kind: 'assistant' | 'tool' | 'meta';
  text?: string;
  rawText?: string;
  toolName?: string;
  conversationId?: string;
}

// The opening marker TOOL_CALL_RE looks for (see tool-fence.ts:
// /```tool_call\s*\n([\s\S]*?)```/g). computeSafeChunk matches on this
// literal substring rather than the full regex (including its \s*\n
// requirement) — a deliberate simplification: the only cost of being
// slightly less strict is that literal prose containing "```tool_call" not
// followed by a real fence body would be held back until the step ends,
// at which point it flushes as-is (matching TOOL_CALL_RE's own behavior
// for anything that never forms a complete, well-closed fence). That is
// an acceptable, self-correcting edge case for something the model is
// never instructed to write outside the real fence protocol.
const FENCE_OPEN = '```tool_call';

/**
 * Fence-boundary-aware incremental streaming cursor. Given the full text
 * accumulated so far for one in-progress agent_response step and how much
 * of it (from the start) has already been surfaced as visible text, returns
 * the additional prefix that is now also safe to surface, plus the new
 * high-water mark to pass back in on the next call.
 *
 * "Safe" means: never any part of an unclosed ```tool_call fence (its
 * content must never reach the user, complete or not — same as
 * TOOL_CALL_RE's own stripping), and never a trailing partial match of the
 * "```tool_call" opening marker itself, which could still complete into a
 * real fence as more text arrives on the next call. A complete fence found
 * along the way is skipped in its entirety — scanning resumes right after
 * its closing ``` — so the fence never appears in the returned chunk.
 *
 * Pure and only ever reads forward from flushedUpTo, so calling it once
 * per accumulated string or once per tiny incremental slice (as real
 * per-token deltas arrive) converges on the identical assembled output —
 * exercised directly in this file's own test suite.
 */
export function computeSafeChunk(
  text: string,
  flushedUpTo: number,
): { chunk: string; safeEnd: number } {
  let cursor = flushedUpTo;
  let visibleStart = flushedUpTo;
  let chunk = '';
  for (;;) {
    const openIdx = text.indexOf(FENCE_OPEN, cursor);
    if (openIdx === -1) {
      // No complete opening marker ahead. The tail might still be the
      // start of one forming — hold back the longest suffix of the
      // unscanned text that exactly matches a prefix of FENCE_OPEN.
      const tail = text.slice(cursor);
      let holdBack = 0;
      for (let n = Math.min(FENCE_OPEN.length - 1, tail.length); n > 0; n--) {
        if (FENCE_OPEN.startsWith(tail.slice(-n))) {
          holdBack = n;
          break;
        }
      }
      const safeEnd = text.length - holdBack;
      chunk += text.slice(visibleStart, safeEnd);
      return { chunk, safeEnd };
    }
    // Everything before the opening marker is safe.
    chunk += text.slice(visibleStart, openIdx);
    const closeIdx = text.indexOf('```', openIdx + FENCE_OPEN.length);
    if (closeIdx === -1) {
      // Opened but not yet closed — nothing from here on is safe yet.
      return { chunk, safeEnd: openIdx };
    }
    // Fully closed — skip the entire fence, keep scanning after it.
    cursor = closeIdx + 3;
    visibleStart = cursor;
  }
}

interface TurnOutcome {
  conversationId?: string;
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

export class AntigravityAgentRunner implements AgentRunner {
  constructor(private agyBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.agyBin || process.env.ANTIGRAVITY_CLI_BIN || 'agy';
    let conversationId: string | undefined = args.resume;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        // Tool-call loop (same shape as KimiCodeAgentRunner / CodexAgentRunner):
        // keep driving the same agy session until a turn produces no tool_call
        // fences (or the round cap hits).
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          // Prepend system prompt + tool protocol on first turn only (when
          // there's no conversation to resume). Subsequent turns in the same
          // conversation carry context via the conversation_id.
          const promptWithSystem =
            round === 0 && !conversationId
              ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
              : nextPrompt;

          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            inputTokens: 0,
            outputTokens: 0,
          };
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];

          for await (const ev of this.streamTurn(
            bin,
            promptWithSystem,
            conversationId,
            args,
            outcome,
          )) {
            if (ev.conversationId) conversationId = ev.conversationId;
            if (ev.kind === 'assistant') {
              // rawText bookkeeping (fence-parsing input) and visible text
              // are independent: an incremental event carries text with no
              // rawText (must NOT feed rawTexts — it's a fragment, not the
              // step's accumulated text), while a flush event carries
              // rawText and, only if emitVisible hasn't already shown
              // everything, a final text remainder too. Yield assistant
              // prose AS IT ARRIVES (per safe increment or step boundary,
              // not after process exit): an agy turn can run many minutes,
              // and session.ts's watchdog must see messages DURING the
              // turn. Note this means partial output may already be
              // yielded when a turn later exits non-zero — preferable to
              // losing it entirely.
              if (ev.rawText !== undefined) rawTexts.push(ev.rawText);
              if (ev.text) yield { type: 'assistant', session_id: conversationId, text: ev.text };
            } else if (ev.kind === 'tool') {
              // Liveness for agy's own tool activity: session.ts never
              // renders tool_use as chat — it only feeds the StateDetector
              // ('tool-call' state) and refreshes last-activity.
              yield { type: 'tool_use', session_id: conversationId, text: ev.toolName };
            }
          }
          if (outcome.conversationId) conversationId = outcome.conversationId;

          if (outcome.exitCode !== 0 || outcome.error) {
            throw turnError(outcome, round, bin);
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) {
            yield { type: 'assistant', session_id: conversationId, text: note };
          }
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant',
              session_id: conversationId,
              text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)`,
            };
            break;
          }

          // Execute org tools in-process, gated through canUseTool
          const results: string[] = [];
          for (const call of calls) {
            results.push(await executeToolCall(args.tools, call, args.canUseTool));
          }
          nextPrompt = formatToolResults(calls, results);
        }

        // Synthesize one result message per mailbox prompt — session.ts uses
        // these for usage accounting and budget checks.
        yield {
          type: 'result',
          session_id: conversationId,
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'AntigravityAgentRunner requires the Antigravity CLI (agy) on PATH. ' +
            'Install it: curl -fsSL https://antigravity.google/cli/install.sh | bash, ' +
            'then run `agy` once to authenticate with your Google AI Pro/Ultra account. ' +
            'Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }

  /**
   * Run one `agy` invocation and stream its stream-json output
   * INCREMENTALLY: each parsed event is yielded as soon as its line arrives
   * on stdout (see the header's "Streaming / liveness" note for why buffering
   * until process exit was a bug). End-of-turn facts (exit code, stderr tail,
   * conversation id, usage, error, timeout flag) are written into `outcome`,
   * which the caller reads after this generator completes.
   */
  private async *streamTurn(
    bin: string,
    prompt: string,
    conversationId: string | undefined,
    args: AgentRunArgs,
    outcome: TurnOutcome,
  ): AsyncGenerator<AgyStreamEvent> {
    // ARG ORDER (from agy headless docs):
    //   agy -p "<prompt>" --output-format stream-json
    //       [--model X] [--dangerously-skip-permissions]
    //       [--continue | --conversation <id>]
    const cliArgs: string[] = ['-p', prompt, '--output-format', 'stream-json'];
    if (args.model) cliArgs.push('--model', args.model);
    cliArgs.push('--dangerously-skip-permissions');
    if (conversationId) {
      cliArgs.push('--conversation', conversationId);
    }

    const child = spawn(bin, cliArgs, {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });

    // SIGTERM→SIGKILL escalation, shared by the turn timeout, the abort
    // signal, and the abandoned-stream path in `finally` — a CLI that
    // ignores SIGTERM must not leak a zombie per turn.
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

    // Arm the turn timeout BEFORE consuming stdout — a hung CLI must be
    // killed while we're still reading, not after it finishes.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, TURN_TIMEOUT_MS);
    // Abort hook (see AgentRunArgs.signal): kill the child so the stdout
    // loop below unblocks instead of orphaning it on iterator.return().
    const unsubscribeAbort = killOnAbort(args.signal, child, KILL_GRACE_MS);

    // Attach the exit promise BEFORE consuming stdout: on a spawn failure
    // (ENOENT, bad binary) the 'error' event fires almost immediately —
    // if no listener is attached yet it escapes as an unhandled 'error'
    // event and crashes the process instead of reaching our catch block.
    const exitPromise = new Promise<number>((res, rej) => {
      child.on('error', rej);
      child.on('close', (code) => res(code ?? 1));
    });
    // Prevent an unhandled-rejection crash if the stdout loop below throws
    // before we await exitPromise (the await still sees the rejection).
    exitPromise.catch(() => {});

    let lastConversationId: string | undefined = conversationId;
    // Per-token text_delta fragments are accumulated per agent_response step
    // (pendingText, raw, fences intact) so fence stripping at flush time
    // always sees the complete text — a per-token delta could split a
    // ```tool_call fence across events. rawText bookkeeping (what
    // parseToolCalls sees) is therefore still computed exactly once per
    // step, at the same DONE/step-change/end-of-stream boundaries as
    // before. visibleSoFar decouples FROM that: it is the fence-safe
    // prefix of pendingText already shown to the user (via computeSafeChunk
    // — see its header for the safety definition), and lets emitVisible()
    // stream new safe text live, mid-step, instead of waiting for the
    // step's rawText flush.
    let pendingText = '';
    let pendingStepIndex: number | undefined;
    let visibleSoFar = '';
    let sawStreamedText = false;
    let resultResponse: string | undefined;

    // Stream any NEWLY safe text since the last call, as its own event
    // (rawText intentionally omitted — this must never feed rawTexts,
    // which needs one accumulated-per-step string, not fragments).
    // Recomputes computeSafeChunk(pendingText, 0) from scratch each call
    // rather than tracking a raw-text cursor: computeSafeChunk's chunk is
    // provably prefix-stable as pendingText grows (exercised directly by
    // this file's own "handles a fence delivered across many small
    // incremental calls" test), so diffing against visibleSoFar is both
    // correct and — for chat-sized text — cheap enough not to matter.
    const emitVisible = (): AgyStreamEvent | null => {
      const { chunk } = computeSafeChunk(pendingText, 0);
      // Trailing whitespace is held back rather than shown immediately:
      // it might be interior (more text follows, e.g. the blank line
      // before a fence) or truly trailing (nothing follows, and old
      // behavior's whole-text `.trim()` would have dropped it) — which
      // one it is isn't known until the step ends, so flushText's own
      // finalStripped diff (also `.trim()`-ed) is what ultimately
      // resolves it, one way or the other.
      const trimmed = chunk.replace(/\s+$/, '');
      if (trimmed.length <= visibleSoFar.length) return null;
      const increment = trimmed.slice(visibleSoFar.length);
      visibleSoFar = trimmed;
      return { kind: 'assistant', text: increment, conversationId: lastConversationId };
    };

    // Flush the accumulated agent_response text as one assistant event:
    // rawText is the full accumulated text (fence parsing's input, UNCHANGED
    // from before incremental streaming existed), text is whatever fence-safe
    // content hasn't already been streamed by emitVisible (undefined once
    // emitVisible has already shown everything there is to show). Using the
    // same TOOL_CALL_RE + trim as the old single-shot design — rather than
    // computeSafeChunk — for this final reveal is deliberate: an unclosed
    // fence must still leak through unchanged at true end-of-stream (matching
    // TOOL_CALL_RE leaving it untouched — computeSafeChunk withholds it
    // forever, since it can never be told a step is truly over), and
    // trailing whitespace must still be dropped exactly the way the old
    // whole-text `.trim()` dropped it.
    const flushText = (): AgyStreamEvent[] => {
      if (!pendingText) return [];
      const raw = pendingText;
      const finalStripped = raw.replace(TOOL_CALL_RE, '').trim();
      const remainder =
        finalStripped.length > visibleSoFar.length ? finalStripped.slice(visibleSoFar.length) : undefined;
      pendingText = '';
      pendingStepIndex = undefined;
      visibleSoFar = '';
      return [{ kind: 'assistant', rawText: raw, text: remainder, conversationId: lastConversationId }];
    };

    // Normalize one parsed wire event: capture the conversation id from ANY
    // event that carries it (resume needs it on the next turn), record result
    // envelope state, and return the AgyStreamEvents to yield (zero, one, or
    // — on a step-index change that both flushes the old step AND streams
    // the new step's first delta — two).
    // init and other event kinds matter only for the conversation id.
    const handleEvent = (ev: AgyEvent): AgyStreamEvent[] => {
      const cid =
        ev.conversation_id ?? ev.step_update?.conversation_id ?? ev.result?.conversation_id;
      if (cid) lastConversationId = cid;

      const events: AgyStreamEvent[] = [];

      if (ev.event === 'step_update' && ev.step_update) {
        const step = ev.step_update;
        if (step.step_type === 'agent_response') {
          if (
            pendingStepIndex !== undefined &&
            step.step_index !== undefined &&
            step.step_index !== pendingStepIndex
          ) {
            // A new response step started — flush the previous one. rawText
            // bookkeeping timing is UNCHANGED from before incremental
            // streaming: still exactly one flush for the OLD step here: the
            // new step's own delta (if any) just joins pendingText for a
            // LATER event to flush, same as before.
            events.push(...flushText());
            pendingStepIndex = step.step_index;
            if (typeof step.text_delta === 'string') {
              sawStreamedText = true;
              pendingText += step.text_delta;
              const inc = emitVisible();
              if (inc) events.push(inc);
            }
            return events;
          }
          if (step.step_index !== undefined) pendingStepIndex = step.step_index;
          if (typeof step.text_delta === 'string') {
            sawStreamedText = true;
            // A DONE step can carry the step's FULL text after ACTIVE
            // deltas streamed the same content per-token — replace
            // instead of double-appending when the accumulated text is
            // a prefix of the DONE payload.
            if (step.state === 'DONE' && pendingText && step.text_delta.startsWith(pendingText)) {
              pendingText = step.text_delta;
            } else {
              pendingText += step.text_delta;
            }
          }
          if (step.state === 'DONE') {
            events.push(...flushText());
          } else {
            const inc = emitVisible();
            if (inc) events.push(inc);
          }
          return events;
        } else if (step.step_type === 'tool' && step.tool_info?.name) {
          events.push({
            kind: 'tool',
            toolName: step.tool_info.name.slice(0, 200),
            conversationId: lastConversationId,
          });
          return events;
        }
      } else if (ev.event === 'result' && ev.result) {
        const result = ev.result;
        if (result.status && result.status !== 'SUCCESS') {
          outcome.error = result.error ?? `status: ${result.status}`;
        }
        if (result.usage) {
          outcome.inputTokens = result.usage.input_tokens ?? 0;
          outcome.outputTokens = result.usage.output_tokens ?? 0;
        }
        if (result.response) resultResponse = result.response;
      }
      return events;
    };

    try {
      // Immediate liveness yield: session.ts races the FIRST pull against a
      // 4-minute silent-stream watchdog, and the model's first event can
      // itself take minutes (long thinking chains, large file reads).
      // Yielding at spawn wins that race deterministically instead of
      // depending on agy's latency.
      yield { kind: 'tool', toolName: 'turn started', conversationId };

      let buf = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed?.startsWith('{')) continue;
          let ev: AgyEvent;
          try {
            ev = JSON.parse(trimmed) as AgyEvent;
          } catch {
            continue;
          }
          for (const out of handleEvent(ev)) yield out;
        }
      }
      const tail = buf.trim();
      if (tail?.startsWith('{')) {
        try {
          for (const out of handleEvent(JSON.parse(tail) as AgyEvent)) yield out;
        } catch {
          /* not JSON, skip */
        }
      }

      // Flush any trailing text whose DONE boundary never arrived.
      for (const flushed of flushText()) yield flushed;

      // Fallback for agy versions that only return result.response (no
      // streaming): surface it as the turn's assistant text.
      if (!sawStreamedText && resultResponse) {
        const stripped = resultResponse.replace(TOOL_CALL_RE, '').trim();
        yield {
          kind: 'assistant',
          rawText: resultResponse,
          text: stripped || undefined,
          conversationId: lastConversationId,
        };
      }
    } finally {
      clearTimeout(timer);
      unsubscribeAbort();
      if (child.exitCode === null && child.signalCode === null) {
        // NOT confirmed dead. Either the consumer abandoned this stream
        // mid-turn (session.ts's silent abort calls iterator.return(), the
        // mailbox closes, or an error is thrown downstream) — kill it, WITH
        // the SIGKILL escalation — or a SIGTERM from the timeout/abort is
        // still inside its grace period: leave that escalation armed, since
        // clearing it here would orphan a CLI that ignores SIGTERM and then
        // wait on `exitPromise` forever (same fix as codex/kimi/pi-rpc).
        if (!child.killed) killChild();
      } else if (killTimer) {
        clearTimeout(killTimer);
      }
    }

    const exitCode = await exitPromise;
    if (killTimer) clearTimeout(killTimer);
    outcome.conversationId = lastConversationId;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
  }
}

/** Build the actionable error for a failed agy turn. */
function turnError(outcome: TurnOutcome, round: number, _bin: string): Error {
  if (outcome.timedOut) {
    return new Error(
      `AntigravityAgentRunner: agy turn (tool round ${round}) exceeded the ${Math.round(TURN_TIMEOUT_MS / 60000)}min ` +
        `turn timeout and was killed.${outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  // Fatal provider errors (auth/permission/quota — classified from the result
  // envelope's error string AND stderr): report what actually happened, and
  // tag the error so the daemon does NOT restart into the same guaranteed
  // failure (a restart on quota exhaustion can only hang or fail again).
  const cls = classifyStderr(`${outcome.error ?? ''}\n${outcome.stderrTail}`);
  if (cls.fatal) {
    const err = new Error(
      `AntigravityAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.error ? ` error: ${outcome.error}` : '') +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `AntigravityAgentRunner: agy failed (exit ${outcome.exitCode})` +
      (outcome.error ? `: ${outcome.error}` : '') +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
