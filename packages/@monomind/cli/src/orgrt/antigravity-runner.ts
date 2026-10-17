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
 *   are forwarded as rich `tool_use`/`tool_result` pairs (ACTIVE step =
 *   start, DONE step of the same step_index = end with the tool's output,
 *   verified live 2026-09-29) so the StateDetector/idle watchdog see a
 *   working agent throughout the turn and agent exec gets full-fidelity
 *   tool_activity. Tool_call fences are
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
 *
 * File-size sweep: the wire-shape types live in antigravity-runner-types.ts,
 * and the subprocess stream reader (streamTurn, computeSafeChunk, turnError)
 * lives in antigravity-runner-stream.ts — both re-exported below where other
 * modules import them from here.
 */
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { streamTurn, turnError } from './antigravity-runner-stream.js';
import type { TurnOutcome } from './antigravity-runner-types.js';
import { realBinary } from './launcher-binary.js';
import {
  addUsage,
  BUDGET_STOP_SUBTYPE,
  budgetExhausted,
  budgetRefusal,
  noUsage,
  splitCachedInput,
  usageBeyond,
  usageFields,
  usageMessage,
} from './runner-usage.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export { computeSafeChunk } from './antigravity-runner-stream.js';

export class AntigravityAgentRunner implements AgentRunner {
  readonly budgetFloorGated = true; // #550
  constructor(private agyBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.agyBin || process.env.ANTIGRAVITY_CLI_BIN || 'agy');
    let conversationId: string | undefined = args.resume;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        // #550: this mailbox message's usage (runner-usage.ts), and why it
        // stopped short for budget, if it did.
        const metered = noUsage();
        let budgetStop: string | undefined;

        // Tool-call loop (same shape as KimiCodeAgentRunner / CodexAgentRunner):
        // keep driving the same agy session until a turn produces no tool_call
        // fences (or the round cap hits).
        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          const refusal = budgetRefusal(args); // #550: no exec without room for one
          if (refusal) {
            budgetStop = `${refusal}; agy turn not started`;
            break;
          }
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
          // #550: what this exec's steps reported as they completed.
          const steps = noUsage();

          for await (const ev of streamTurn(bin, promptWithSystem, conversationId, args, outcome)) {
            if (ev.conversationId) conversationId = ev.conversationId;
            if (ev.kind === 'usage' && ev.usage) {
              // #550: meter each step as it completes; session-run checks
              // the budget on it. Leaving the loop at the step that spends
              // the budget ends streamTurn, whose finally kills agy.
              addUsage(steps, ev.usage);
              const usage = usageMessage(ev.usage, conversationId);
              if (usage) yield usage;
              if (budgetExhausted(args)) {
                budgetStop = 'token budget exhausted; agy turn stopped at the step that spent it';
                break;
              }
            } else if (ev.kind === 'assistant') {
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
              // Spawn-time liveness: session.ts never renders tool_use as
              // chat — it only feeds the StateDetector ('tool-call' state)
              // and refreshes last-activity. No label: a bare ping never
              // becomes a tool_activity event (agy's real steps do, below).
              yield { type: 'tool_use', session_id: conversationId };
            } else if (ev.kind === 'native' && ev.native) {
              // agy's own tool steps as matched start/end pairs (session.ts
              // still sees 'tool_use' liveness; agent exec gets tool_activity).
              for (const m of ev.native) yield { ...m, session_id: conversationId };
            }
          }
          addUsage(metered, steps);
          if (budgetStop) break;
          if (outcome.conversationId) conversationId = outcome.conversationId;

          if (outcome.exitCode !== 0 || outcome.error) {
            throw turnError(outcome, round, bin);
          }
          // #550: whatever the exec's result counts beyond its steps.
          const rest = usageBeyond(
            splitCachedInput({
              input: outcome.inputTokens,
              output: outcome.outputTokens,
              cached: outcome.cachedInputTokens,
            }),
            steps,
          );
          addUsage(metered, rest);
          const restUsage = usageMessage(rest, conversationId);
          if (restUsage) yield restUsage;

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

          // Execute org tools in-process, gated through canUseTool
          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', session_id: conversationId, text: note };
          if (!results) break;
          nextPrompt = formatToolResults(calls, results);
        }

        if (budgetStop) {
          const text = `[monomind] ${budgetStop}.`;
          yield { type: 'assistant', session_id: conversationId, text };
        }
        // Synthesize one result message per mailbox prompt — session.ts uses
        // these for usage accounting and budget checks.
        yield {
          type: 'result',
          session_id: conversationId,
          subtype: budgetStop ? BUDGET_STOP_SUBTYPE : 'success',
          ...usageFields(metered),
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
}
