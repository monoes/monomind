// packages/@monomind/cli/src/orgrt/copilot-runner.ts
/**
 * CopilotAgentRunner — AgentRunner impl backed by the GitHub Copilot CLI
 * (`copilot`, https://docs.github.com/en/copilot/reference/copilot-cli-reference).
 *
 * Architectural pattern: SAME as the other subprocess runners — spawn the
 * CLI, parse its output, normalize to AgentMessage.
 *
 * Auth: GitHub's own device/browser login flow (`copilot` handles this
 * itself on first run). No env vars set here.
 *
 * Streaming / liveness — WHY INCREMENTAL (#204):
 *   This runner originally buffered ALL of copilot's stdout until the
 *   subprocess exited before parsing anything, so any turn longer than
 *   session.ts's 4-minute silent-stream watchdog (SILENT_SESSION_MS) yielded
 *   zero messages in time — abort, retry, kill, circuit breaker. Same bug
 *   class the kimi/antigravity/codex runners had (#204 audit). This runner
 *   now parses stdout LINE BY LINE as data arrives: a liveness `tool_use`
 *   message is yielded the moment the subprocess spawns (deterministically
 *   winning the watchdog's first-pull race regardless of copilot's latency),
 *   and each assistant-shaped NDJSON event is yielded as it lands rather
 *   than accumulated until process close. Any tool-activity-shaped event
 *   (see handleLine's `kind.startsWith('tool')` check) is forwarded as a
 *   `tool_use` liveness message too — a wrong guess there only costs a
 *   missed heartbeat, unlike assistant text, which still fails closed (no
 *   text extracted) on an unrecognized shape per the note below.
 *
 * Subprocess protocol — per public docs, NOT byte-verified against a running
 * binary:
 *   - Invocation: `copilot -p "<prompt>" --output-format json -s
 *                 --allow-all-tools --no-ask-user [--model=<model>]`. `-s`
 *     (silent) suppresses the stats/decoration footer that otherwise mixes
 *     into stdout (documented GitHub issue: without `-s`, response text can
 *     be absent from plain stdout entirely — `--output-format json` + `-s`
 *     is the documented workaround). `--no-ask-user` disables the CLI's
 *     ask_user tool so a headless run can never block waiting on a question
 *     with no human to answer it — confirmed by cross-checking a second,
 *     independent public agentic-CLI wrapper's provider table, which lists
 *     the identical `-s --allow-all-tools --no-ask-user` combination for
 *     Copilot's non-interactive mode; this runner was missing `--no-ask-user`
 *     until that cross-check.
 *   - Output: NDJSON; assistant text arrives on `assistant.message`-shaped
 *     events. The exact full field list isn't published, so handleLine
 *     tolerates a couple of plausible shapes (an explicit `type`/`kind` of
 *     'assistant.message' or 'assistant' carrying `content`/`text`) and
 *     fails closed (no text extracted) on anything else, rather than
 *     guessing wrong and emitting garbage. UPDATE (#181, byte-verified
 *     against copilot 1.0.83): the REAL shape nests the payload one level
 *     down — `{"type":"assistant.message","data":{"content":"...", ...}}` —
 *     which none of the guessed shapes above matched, so this runner
 *     previously extracted NO assistant text at all. handleLine now reads
 *     `data.content`/`data.text` first; the guessed shapes are kept as
 *     fallbacks rather than removed (they cost nothing and other copilot
 *     versions may differ).
 *   - Session/resume: the closing `{"type":"result","sessionId":...}` line
 *     names the session (verified live, copilot 1.0.88); later invocations
 *     pass `--resume=<id>` and send only the new prompt, and
 *     AgentRunArgs.resume seeds it.
 *   - Native tools: `tool.execution_start` {toolCallId, toolName,
 *     arguments} and `tool.execution_complete` {toolCallId, success,
 *     result.content} (verified live, 1.0.88) become matched
 *     tool_use/tool_result pairs.
 *   - Token usage (#181) — RESOLVED, byte-verified against copilot 1.0.83 on
 *     2026-09-18. Copilot CLI has a first-class `--usage-output-file <file>`
 *     flag ("Write final usage statistics as JSON to the specified file").
 *     This runner passes a per-turn temp path and reads it back after the
 *     subprocess exits (see parseCopilotUsage). Captured shape:
 *       { "modelMetrics": { "<model>": { "usage": {
 *           "inputTokens": 30522, "outputTokens": 47,
 *           "cacheReadTokens": 15224, "cacheWriteTokens": 15292,
 *           "reasoningTokens": 9 } } }, ... }
 *     `inputTokens` is TOTAL prompt tokens for the whole invocation (the
 *     identity inputTokens === tokenDetails.input + cache_read + cache_write
 *     held exactly on both samples) and the counts are cumulative across
 *     every model call, not last-call-only. Deliberately NOT reported,
 *     because copilot does not report them: `cost_usd` (copilot meters in AI
 *     credits / premium requests, and the credit→USD rate is plan-dependent
 *     — inventing one would poison policy.overBudgetUsd) and
 *     `reasoningTokens` (present, but nothing states whether outputTokens
 *     already includes it, so adding it risks double-counting).
 *     Rejected alternatives, both inspected: stdout's final `result` event
 *     has no token counts and its `session.usage_checkpoint` events carry
 *     prompt/cache but no output tokens; the OTel file export
 *     (`COPILOT_OTEL_FILE_EXPORTER_PATH`) would work but needs a histogram
 *     parser for what this flag hands over as plain JSON. Older copilot
 *     builds reject the flag at argv-parse time (before any spend) —
 *     turnError makes that an explicit "update copilot" failure rather than
 *     falling back to 0, which is the silent free lunch this issue is about.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { STARTUP_GRACE_MS, streamTurn, turnError } from './copilot-runner-stream.js';
import type { TurnOutcome } from './copilot-runner-types.js';
import { NativeToolCalls } from './kimicode-runner-tools.js';
import { realBinary } from './launcher-binary.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export { parseCopilotEvents, parseCopilotUsage } from './copilot-runner-parse.js';
export type { CopilotStreamEvent, CopilotUsage } from './copilot-runner-types.js';

export class CopilotAgentRunner implements AgentRunner {
  constructor(private copilotBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.copilotBin || process.env.COPILOT_CLI_BIN || 'copilot');
    // copilot's closing `result` line names the session; later invocations
    // `--resume=<id>` it, so only a fresh session needs the system prompt
    // and tool protocol re-sent.
    let sessionId: string | undefined = args.resume;
    const withSystem = (body: string): string =>
      sessionId ? body : `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${body}`;
    const tools = new NativeToolCalls();
    // copilot rejects --reasoning-effort outright for a model without it
    // (verified live: `Model "auto" does not support reasoning effort
    // configuration`, exit 1 before any model call). The first such refusal
    // drops the effort for the rest of the run and retries the invocation.
    let turnArgs = args;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = withSystem(text);
        // #181: every tool-fence round is its own `copilot -p` invocation with
        // its own usage file, so the counts reported on this prompt's single
        // 'result' message must be the sum over all of them.
        let promptInputTokens = 0;
        let promptOutputTokens = 0;

        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            hangSuspected: false,
          };
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];

          for await (const ev of streamTurn(bin, nextPrompt, sessionId, turnArgs, outcome)) {
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per NDJSON line, not
              // after process exit): a copilot turn can run many minutes,
              // and session.ts's watchdog must see messages DURING the turn.
              if (ev.text) yield { type: 'assistant', text: ev.text };
            } else if (ev.kind === 'session' && ev.sessionId) {
              sessionId = ev.sessionId;
            } else if (ev.kind === 'native') {
              // copilot's own tool calls, paired by its toolCallId.
              if (ev.toolStart) {
                const s = ev.toolStart;
                const m = tools.start(s.id, s.name, s.input, sessionId);
                if (m) yield m;
              }
              if (ev.toolEnd) {
                const { id, output, isError, exitCode } = ev.toolEnd;
                yield* tools.end(id, output, isError, sessionId, undefined, exitCode);
              }
            } else if (ev.kind === 'tool') {
              // Liveness for copilot's other tool events (partial results)
              // or the spawn-time yield: session.ts never renders tool_use
              // as chat — it only feeds the StateDetector ('tool-call'
              // state) and refreshes last-activity. No label: a bare ping
              // never becomes a tool_activity event (real calls do, above).
              yield { type: 'tool_use', session_id: sessionId };
            }
          }

          if (outcome.usage) {
            promptInputTokens += outcome.usage.inputTokens;
            promptOutputTokens += outcome.usage.outputTokens;
          }

          if (outcome.hangSuspected) {
            throw new Error(
              `CopilotAgentRunner: copilot produced no output within ${STARTUP_GRACE_MS / 1000}s and was ` +
                'killed. This is a documented copilot CLI issue: its directory-trust/path-access prompts can ' +
                'hang indefinitely in headless invocations with no way to answer them. Run `copilot` once ' +
                'manually in a real terminal in this project to accept any prompts (and confirm --add-dir ' +
                `covers every path it needs), then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          if (
            outcome.exitCode !== 0 &&
            turnArgs.effort &&
            /does not support reasoning effort/i.test(outcome.stderrTail)
          ) {
            turnArgs = { ...args, effort: undefined };
            round--;
            continue;
          }
          if (outcome.exitCode !== 0) {
            throw turnError(outcome);
          }

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) {
            yield {
              type: 'result',
              session_id: sessionId,
              subtype: 'success',
              input_tokens: promptInputTokens,
              output_tokens: promptOutputTokens,
            };
            break;
          }

          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', text: note };
          if (!results) {
            yield {
              type: 'result',
              session_id: sessionId,
              subtype: 'success',
              input_tokens: promptInputTokens,
              output_tokens: promptOutputTokens,
            };
            break;
          }
          nextPrompt = withSystem(formatToolResults(calls, results));
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'CopilotAgentRunner requires the GitHub Copilot CLI (copilot) on PATH. ' +
            'Install it: npm install -g @github/copilot, then run `copilot` once to ' +
            'authenticate. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }
}
