// packages/@monomind/cli/src/orgrt/codex-runner.ts
/**
 * CodexAgentRunner — AgentRunner impl backed by the Codex CLI (subprocess).
 *
 * Architectural pattern: SAME as KimiCodeAgentRunner/AntigravityAgentRunner —
 * spawn the vendor's CLI binary, parse its JSONL stream, normalize to
 * AgentMessage. No SDK dependency (the @openai/codex-sdk package would add
 * ~100MB; we use the CLI directly like we do for kimi).
 *
 * Auth: inherited from ~/.codex/auth.json (created by `codex login`). The
 * ChatGPT subscription flows through this credential cache. No env vars.
 *
 * Streaming / liveness — WHY INCREMENTAL (#204):
 *   This runner originally buffered ALL of stdout until the codex subprocess
 *   exited, then parsed the whole batch. session.ts races the FIRST pull from
 *   this runner against a 4-minute silent-stream watchdog (SILENT_SESSION_MS),
 *   so any turn longer than 4 minutes yielded zero messages in time — abort,
 *   retry, kill, circuit breaker, stalled org. Same bug class as the
 *   kimi/antigravity runners had (#204 audit). This runner now parses stdout
 *   LINE BY LINE as data arrives: a liveness `tool_use` message is yielded
 *   the moment the subprocess spawns (deterministically winning the
 *   first-pull race regardless of model-thinking latency), assistant text is
 *   yielded as each `agent_message` item lands (codex sends whole items, not
 *   per-token deltas — no accumulation needed, unlike agy), and codex's own
 *   tool items (command_execution, file_change, mcp_tool_call, web_search,
 *   todo_list) are forwarded as id-carrying `tool_use` at `item.started`
 *   and a matched `tool_result` at `item.completed` (codex-runner-tools.ts). Tool_call fences are still collected
 *   from the raw texts and parsed at end of turn (fence parsing needs the
 *   complete text).
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Same approach as kimi/opencode/antigravity. Tools are rendered INTO the
 *   first prompt; the model emits ```tool_call fences; this runner parses
 *   them out of the agent_message text, executes the real OrgToolDef handlers
 *   in-process (gated through canUseTool), and feeds results back as the
 *   next prompt.
 *
 * Subprocess protocol — REWRITTEN against openai/codex's own Rust source
 * (issue #178). This runner previously assumed a "thread.started" /
 * "item.completed" event shape sourced from `openai/codex/sdk/typescript`,
 * which turned out to be a DIFFERENT wire format than what `codex exec
 * --json` actually emits. Confirmed two ways: (1) live output from an
 * installed codex v0.21.0 (`brew install codex`) showed events shaped like
 * `{"id":"1","msg":{"type":"task_started"}}` — nothing resembling
 * "thread.started"; (2) cross-checked against
 * `codex-rs/protocol/src/protocol.rs`'s `EventMsg` enum
 * (`#[serde(tag = "type", rename_all = "snake_case")]`) and
 * `codex-rs/protocol/src/legacy_events.rs`, which is EXACTLY this wire
 * format and is explicitly comment-labeled "v1 wire format" (still the
 * live default for `--json`, not a deprecated relic).
 *
 *   - Invocation: `codex exec --json [--model X] [-c model_reasoning_effort=L]
 *                 -c features.shell_snapshot{,_v2}=false (security, see
 *                 CODEX_SNAPSHOT_OFF_ARGS) [--cd Y] [--skip-git-repo-check] [--sandbox <mode>]
 *                 [resume <sessionId>] -- -` with the prompt on STDIN
 *     (the sandbox mode follows the role's policy.git level — cli-sandbox.ts;
 *     coder mode, `access: 'full'`, passes
 *     `--dangerously-bypass-approvals-and-sandbox` instead — see
 *     codexExecArgs in codex-runner-stream.ts)
 *     (see streamTurn for why argv is not used). `--experimental-json`
 *     (the old flag name) doesn't exist in v0.21.0 — confirmed live
 *     ("unexpected argument '--experimental-json' found"); `--json` is
 *     correct in both v0.21.0 and the current v0.147.0 (where
 *     `--experimental-json` IS an alias again, per current
 *     `codex-rs/exec/src/cli.rs` — but v0.21.0 predates that alias).
 *   - `resume` is a SUBCOMMAND of `exec`, not a positional after other exec
 *     flags in isolation — `codex exec resume <sessionId> ["<prompt>"]`,
 *     with `exec`'s own global flags (--json, --model, --sandbox, etc.)
 *     specified BEFORE the `resume` token. Confirmed live (v0.147.0 AND
 *     v0.149.0) that this exact arg order parses cleanly. v0.21.0 has no
 *     `resume` subcommand at all (confirmed live: "resume" was consumed as
 *     the PROMPT text itself, then the actual session id was rejected as an
 *     unexpected extra positional) — so resume silently can't work
 *     pre-~v0.12x. This runner doesn't detect codex's version; if resume
 *     fails on an old install, each turn falls back to a fresh (contextless)
 *     session rather than erroring — a real limitation, not fixed here.
 *   - JSONL on stdout, one event per line. Confirmed real EventMsg variants
 *     (source: `EventMsg` enum + each variant's struct, all in
 *     `protocol.rs`):
 *       {"type":"session_configured","session_id":"...","thread_id":"...",
 *        "model":"...",...}                            — session/thread id
 *       {"type":"task_started"}                          — turn started
 *       {"type":"agent_message","message":"...","phase":...}
 *                                                         — assistant text
 *       {"type":"token_count","info":{"last_token_usage":
 *        {"input_tokens":N,"output_tokens":N,"reasoning_output_tokens":N,
 *         "total_tokens":N,...},"total_token_usage":{...}},...}
 *                       — `last_token_usage` is per-TURN (not cumulative);
 *                         `total_token_usage` IS cumulative — use the former
 *       {"type":"task_complete","turn_id":"...",
 *        "last_agent_message":"...","error":{"message":"..."}|absent,...}
 *       {"type":"error","message":"...",...}
 *   - NO per-token streaming in this event set (whole agent_message events
 *     only, unlike the discarded thread/item assumption).
 *   - Session ID: captured from `session_configured.session_id` (or
 *     `.thread_id` — both present, same value in observed live output),
 *     NOT from a "thread.started" event, which doesn't exist in THIS
 *     (legacy) protocol variant — see the CURRENT shape below, where it does.
 *   - stderr is human diagnostics; buffer and surface on non-zero exit only.
 *
 * WIRE-FORMAT UPDATE (#178 follow-up, #204) — live-verified 2026-08-22
 * against an authenticated codex v0.149.0 (`codex login status` →
 * "Logged in using ChatGPT"), three real `codex exec --json` invocations:
 *
 *   1. Plain turn (`"reply with exactly the word: pong"`):
 *      {"type":"thread.started","thread_id":"01a02a2f-...-...-...-..."}
 *      {"type":"turn.started"}
 *      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}
 *      {"type":"turn.completed","usage":{"input_tokens":13085,"cached_input_tokens":9984,
 *       "cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
 *   2. Turn with a shell tool call (`"run: echo hello-from-codex-shell"`) — adds:
 *      {"type":"item.started","item":{"id":"item_1","type":"command_execution",
 *       "command":"...","aggregated_output":"","exit_code":null,"status":"in_progress"}}
 *      {"type":"item.completed","item":{"id":"item_1","type":"command_execution",
 *       "command":"...","aggregated_output":"hello-from-codex-shell\n","exit_code":0,
 *       "status":"completed"}}
 *   3. `codex exec resume <threadId> "..."` × 3 in the same thread — confirms
 *      (a) `resume` still works exactly as documented above, (b)
 *      `turn.completed.usage.input_tokens` stays roughly flat across resumed
 *      turns (13097 → 13112) rather than growing cumulatively, consistent
 *      with per-turn (not cumulative) usage — same inference as legacy
 *      `token_count.info.last_token_usage` vs `total_token_usage`, though
 *      this wasn't cross-checked against Rust source (no `codex-rs` checkout
 *      in this environment) the way the legacy shape originally was.
 *
 * NONE of `session_configured` / `task_started` / `agent_message` (top-level)
 * / `token_count` / `task_complete` — the shape this runner was originally
 * written against — appeared in ANY of the above. This runner was silently
 * broken against any codex install emitting the current shape: every switch
 * branch missed, so assistant text/inputTokens/outputTokens/threadId all
 * stayed at their zero-values for every single turn, producing no assistant
 * text, no token accounting, and no session resumption — while `exitCode`
 * was still 0, so nothing surfaced as an error either.
 *
 * Both shapes are now parsed (see CURRENT vs LEGACY branches in
 * `handleEvent` below). The legacy shape is kept because there's no live
 * evidence it was ever wrong for the v0.147.0 install it was verified
 * against — only that a newer install (v0.149.0) has since moved to the
 * item-based shape. Error/failure item types (e.g. a possible
 * `turn.failed`) were NOT observed live and are not guessed at here — an
 * error turn was only ever seen as a non-zero exit with a plain-text stderr
 * message (e.g. `resume`ing an unknown thread id → exit 1, no JSON on
 * stdout at all), which the existing `outcome.exitCode !== 0` handling
 * already covers unchanged.
 */
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { streamTurn, turnError } from './codex-runner-stream.js';
import type { TurnOutcome } from './codex-runner-types.js';
import { realBinary } from './launcher-binary.js';
import {
  addUsage,
  BUDGET_STOP_SUBTYPE,
  budgetRefusal,
  noUsage,
  splitCachedInput,
  usageFields,
  usageMessage,
} from './runner-usage.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export type { CodexStreamEvent } from './codex-runner-types.js';

export class CodexAgentRunner implements AgentRunner {
  readonly budgetFloorGated = true; // #550
  constructor(private codexBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.codexBin || process.env.CODEX_CLI_BIN || 'codex');
    let threadId: string | undefined = args.resume;
    // Per-spawn tool-call id prefix (codex-runner-tools.ts).
    let spawnSeq = 0;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        // #550: this mailbox message's usage (runner-usage.ts), and why it
        // stopped short for budget, if it did.
        const metered = noUsage();
        let budgetStop: string | undefined;

        // Tool-call loop (same shape as KimiCodeAgentRunner/AntigravityAgentRunner):
        // keep driving the same codex session until a turn produces no
        // tool_call fences (or the round cap hits).
        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          // #550: codex reports usage only when an exec ends, so a started
          // exec can't be stopped for budget — don't start one without room.
          const refusal = budgetRefusal(args);
          if (refusal) {
            budgetStop = `${refusal}; codex turn not started`;
            break;
          }
          // Prepend system prompt + tool protocol on first turn only (when
          // there's no thread to resume). Subsequent turns in the same
          // session carry context via the thread_id.
          const promptWithSystem =
            round === 0 && !threadId
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

          const idPrefix = `codex_${++spawnSeq}_`;
          for await (const ev of streamTurn(
            bin,
            promptWithSystem,
            threadId,
            args,
            outcome,
            idPrefix,
          )) {
            if (ev.threadId) threadId = ev.threadId;
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per agent_message item,
              // not after process exit): a codex turn can run many minutes,
              // and session.ts's watchdog must see messages DURING the turn.
              // Note this means partial output may already be yielded when a
              // turn later exits non-zero — preferable to losing it entirely.
              if (ev.text) yield { type: 'assistant', session_id: threadId, text: ev.text };
            } else if (ev.kind === 'tool') {
              // Spawn-time liveness: session.ts never renders tool_use as
              // chat — it only feeds the StateDetector ('tool-call' state)
              // and refreshes last-activity. No `text`: a label here would
              // become a bogus unpaired tool_activity start (tool-activity.ts
              // maps a text-only tool_use for any fidelity but `none`).
              yield { type: 'tool_use', session_id: threadId };
            } else if (ev.kind === 'tool_start') {
              // Codex's own tool call, with a real id and canonical input
              // (contract §4) — ToolActivityTracker pairs it with the
              // tool_result below; session.ts sees it as liveness.
              yield {
                type: 'tool_use',
                session_id: threadId,
                text: ev.toolName,
                tool_use_id: ev.toolUseId,
                tool: ev.tool,
                kind: ev.toolKind,
                input: ev.input,
                parent_tool_use_id: null,
              };
            } else if (ev.kind === 'tool_end') {
              yield {
                type: 'tool_result',
                session_id: threadId,
                tool_use_id: ev.toolUseId,
                tool: ev.tool,
                is_error: ev.isError === true,
                text: ev.output ?? '',
                ...(ev.exitCode !== undefined ? { exit_code: ev.exitCode } : {}),
                ...(ev.durationMs !== undefined ? { duration_ms: ev.durationMs } : {}),
              };
            }
          }
          if (outcome.threadId) threadId = outcome.threadId;

          if (outcome.exitCode !== 0 || outcome.error) {
            throw turnError(outcome, round, bin);
          }
          // #550: meter each exec as it ends, cached input split out, so
          // session-run checks the budget before the next round.
          const exec = splitCachedInput({
            input: outcome.inputTokens,
            output: outcome.outputTokens,
            cached: outcome.cachedInputTokens,
            cacheWrite: outcome.cacheWriteInputTokens,
          });
          addUsage(metered, exec);
          const usage = usageMessage(exec, threadId);
          if (usage) yield usage;

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) {
            yield { type: 'assistant', session_id: threadId, text: note };
          }
          if (calls.length === 0) break;

          // Execute org tools in-process, gated through canUseTool
          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', session_id: threadId, text: note };
          if (!results) break;
          nextPrompt = formatToolResults(calls, results);
        }

        if (budgetStop) {
          const text = `[monomind] ${budgetStop}.`;
          yield { type: 'assistant', session_id: threadId, text };
        }
        // Synthesize one result message per mailbox prompt — session.ts uses
        // these for usage accounting and budget checks.
        yield {
          type: 'result',
          session_id: threadId,
          subtype: budgetStop ? BUDGET_STOP_SUBTYPE : 'success',
          ...usageFields(metered),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'CodexAgentRunner requires the Codex CLI (codex) on PATH. ' +
            'Install it: npm install -g @openai/codex, then run `codex login` ' +
            'to authenticate with ChatGPT. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }
}
