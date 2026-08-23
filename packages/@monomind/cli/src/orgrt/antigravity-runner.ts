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
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
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
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per agent_response DONE
              // boundary, not after process exit): an agy turn can run many
              // minutes, and session.ts's watchdog must see messages DURING
              // the turn. Note this means partial output may already be
              // yielded when a turn later exits non-zero — preferable to
              // losing it entirely.
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

    // Arm the turn timeout BEFORE consuming stdout — a hung CLI must be
    // killed while we're still reading, not after it finishes.
    let timedOut = false;
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A wedged CLI that ignores SIGTERM must not leak a zombie per turn:
      // escalate to SIGKILL after a short grace period.
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    }, TURN_TIMEOUT_MS);

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
    // and flushed as ONE assistant event at the step's DONE boundary (or at
    // end of stream if no DONE arrives). Fence stripping needs the complete
    // text — per-token deltas would split a ```tool_call fence across events.
    let pendingText = '';
    let pendingStepIndex: number | undefined;
    let sawStreamedText = false;
    let resultResponse: string | undefined;

    // Flush the accumulated agent_response text as one assistant event.
    // Defined as a closure returning the event (or null) so both the DONE
    // boundary and the end-of-stream path share the exact same logic.
    const flushText = (): AgyStreamEvent | null => {
      if (!pendingText) return null;
      const raw = pendingText;
      pendingText = '';
      pendingStepIndex = undefined;
      const stripped = raw.replace(TOOL_CALL_RE, '').trim();
      return {
        kind: 'assistant',
        rawText: raw,
        text: stripped || undefined,
        conversationId: lastConversationId,
      };
    };

    // Normalize one parsed wire event: capture the conversation id from ANY
    // event that carries it (resume needs it on the next turn), record result
    // envelope state, and return the AgyStreamEvent to yield (or null).
    // init and other event kinds matter only for the conversation id.
    const handleEvent = (ev: AgyEvent): AgyStreamEvent | null => {
      const cid =
        ev.conversation_id ?? ev.step_update?.conversation_id ?? ev.result?.conversation_id;
      if (cid) lastConversationId = cid;

      if (ev.event === 'step_update' && ev.step_update) {
        const step = ev.step_update;
        if (step.step_type === 'agent_response') {
          if (
            pendingStepIndex !== undefined &&
            step.step_index !== undefined &&
            step.step_index !== pendingStepIndex
          ) {
            // A new response step started — flush the previous one.
            const flushed = flushText();
            if (step.step_index !== undefined) pendingStepIndex = step.step_index;
            if (typeof step.text_delta === 'string') {
              sawStreamedText = true;
              pendingText += step.text_delta;
            }
            return flushed;
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
          if (step.state === 'DONE') return flushText();
        } else if (step.step_type === 'tool' && step.tool_info?.name) {
          return {
            kind: 'tool',
            toolName: step.tool_info.name.slice(0, 200),
            conversationId: lastConversationId,
          };
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
      return null;
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
          const out = handleEvent(ev);
          if (out) yield out;
        }
      }
      const tail = buf.trim();
      if (tail?.startsWith('{')) {
        try {
          const out = handleEvent(JSON.parse(tail) as AgyEvent);
          if (out) yield out;
        } catch {
          /* not JSON, skip */
        }
      }

      // Flush any trailing text whose DONE boundary never arrived.
      const flushed = flushText();
      if (flushed) yield flushed;

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
      if (killTimer) clearTimeout(killTimer);
      // If the consumer abandons this stream mid-turn (session.ts's
      // silent-abort calls iterator.return(), the mailbox closes, or an
      // error is thrown downstream), don't leak the CLI subprocess.
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }

    const exitCode = await exitPromise;
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
