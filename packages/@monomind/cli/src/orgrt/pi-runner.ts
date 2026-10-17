// packages/@monomind/cli/src/orgrt/pi-runner.ts
/**
 * PiAgentRunner — AgentRunner impl backed by the Pi coding agent CLI
 * (`pi`, https://github.com/earendil-works/pi, package
 * @earendil-works/pi-coding-agent), one `pi --mode json` process per mailbox
 * turn / tool round. Target: pi 0.87.1, full coder-mode parity.
 *
 * Auth: pi's own provider login (`auth.json`, or provider env vars). No env
 * vars set here.
 *
 * Streaming / liveness (#204): stdout is parsed LINE BY LINE as it arrives.
 * A liveness `tool_use` is yielded the moment the subprocess spawns (wins
 * session.ts's first-pull watchdog race), assistant text streams per
 * `text_delta` when `extras.includePartialMessages` is set (agent exec) or
 * per assistant `message_end` otherwise (the org runtime wants one message
 * per model message), and `tool_execution_start`/`tool_execution_end`
 * become matched `tool_use`/`tool_result` pairs by toolCallId.
 *
 * Invocation (pi-runner-state.ts's piCliArgs):
 *   pi --mode json --session-id <id> [--model m] [--thinking E]
 *      (--approve | --no-approve -ne -ns -np -nc) -- "<prompt>"
 *   - `--session-id` opens or creates that exact session in pi's own store,
 *     so nothing is written into the user's project (the old
 *     `.monomind-pi-session` directory is gone) and resume is by id.
 *   - `--approve` (trust the project's `.pi/` resources) only with coder
 *     mode's `--settings` sources; otherwise the isolation flags. pi has no
 *     per-tool approval and no sandbox (docs/security.md), so it is always
 *     full access; `--access full` adds the process-group spawn.
 *
 * Completion: pi exits after `agent_settled`. An `agent_end` with
 * `willRetry:true` is followed by `auto_retry_*` and a new agent run, and pi
 * exits 0 even when the last retry failed — the run's failure is read from
 * the stream (pi-runner-state.ts's PiRunTracker), not the exit code.
 *
 * Usage: summed over every assistant `message_end` (input, output,
 * cacheRead, cacheWrite, cost.total) — a multi-step run has one usage per
 * assistant message.
 *
 * max_turns: pi has no cap, so it is emulated — `turn_start` events are
 * counted per mailbox message and the process tree is killed at the first
 * turn past `maxTurns`; the result is `subtype: 'error_max_turns'`.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { randomUUID } from 'node:crypto';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { NativeToolCalls } from './kimicode-runner-tools.js';
import { realBinary } from './launcher-binary.js';
import { PiRunTracker, PiTextStream, PiTurnBudget } from './pi-runner-state.js';
import type { TurnOutcome } from './pi-runner-stream.js';
import { STARTUP_GRACE_MS, streamTurn, turnError } from './pi-runner-stream.js';
import { withVendorRetries } from './provider-limit.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export { parsePiEvents } from './pi-runner-parse.js';
export type { PiStreamEvent } from './pi-runner-stream.js';

/** Install hint for the current pi package (the repo moved to
 *  earendil-works/pi; @mariozechner/pi-coding-agent is stale). */
export const PI_INSTALL_HINT =
  'npm install -g --ignore-scripts @earendil-works/pi-coding-agent (or curl -fsSL https://pi.dev/install.sh | sh)';

export class PiAgentRunner implements AgentRunner {
  constructor(private piBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.piBin || process.env.PI_CLI_BIN || 'pi');
    // pi 0.87 `--session-id <id>` opens that exact session or creates it, in
    // pi's own store — no directory in the user's project. The runner picks
    // the id up front (AgentRunArgs.resume seeds it), so every tool round
    // and every later prompt reopens the same conversation.
    let sessionId = args.resume || randomUUID();
    const streamPartials = args.extras?.includePartialMessages === true;
    const tools = new NativeToolCalls();
    // pi prices each assistant message; the result carries this run's
    // running sum (cumulative, like every runner's cost_usd).
    let runCostUsd: number | undefined;

    try {
      let first = !args.resume;
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = first
          ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`
          : text;
        first = false;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let turnCacheRead = 0;
        let turnCacheWrite = 0;
        // Emulated max turns, per mailbox message across its tool rounds.
        const budget = new PiTurnBudget(args.maxTurns);

        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            hangSuspected: false,
          };
          const tracker = new PiRunTracker();
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];

          for await (const ev of streamTurn(bin, nextPrompt, sessionId, args, outcome, {
            tracker,
            text: new PiTextStream(streamPartials),
            budget,
          })) {
            if (outcome.sessionId) sessionId = outcome.sessionId;
            if (ev.kind === 'assistant') {
              if (ev.rawText !== undefined) rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per text_delta when
              // streaming, else per message_end), not after process exit: a
              // pi turn can run many minutes, and session.ts's watchdog
              // must see messages DURING the turn.
              if (ev.text) yield { type: 'assistant', session_id: sessionId, text: ev.text };
            } else if (ev.kind === 'native') {
              // pi's own tool calls, paired by toolCallId.
              if (ev.toolStart) {
                const t = ev.toolStart;
                const m = tools.start(t.id, t.name, t.input, sessionId);
                if (m) yield m;
              }
              if (ev.toolEnd) {
                yield* tools.end(ev.toolEnd.id, ev.toolEnd.output, ev.toolEnd.isError, sessionId);
              }
            } else if (ev.kind === 'tool') {
              // Spawn-time liveness: session.ts never renders tool_use as
              // chat — it only feeds the StateDetector ('tool-call' state)
              // and refreshes last-activity. No label: a bare ping never
              // becomes a tool_activity event (pi's real calls do, above).
              yield { type: 'tool_use', session_id: sessionId };
            }
          }

          if (outcome.hangSuspected) {
            throw new Error(
              `PiAgentRunner: pi produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
                'This usually means it is stuck on a prompt headless mode has no way to answer. Run `pi` once ' +
                `manually in a real terminal in this project to check, then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          // The max-turns abort kills pi, so its exit status is not a failure.
          if (!budget.hit) {
            const failure = tracker.failure();
            if (outcome.exitCode !== 0 || failure)
              throw withVendorRetries(turnError(outcome, round, failure), tracker.retries);
          }

          turnInputTokens += tracker.inputTokens;
          turnOutputTokens += tracker.outputTokens;
          turnCacheRead += tracker.cacheReadTokens;
          turnCacheWrite += tracker.cacheWriteTokens;
          if (outcome.sessionId) sessionId = outcome.sessionId;
          if (tracker.costUsd !== undefined) runCostUsd = (runCostUsd ?? 0) + tracker.costUsd;
          if (budget.hit) break;

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) break;

          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', text: note };
          if (!results) break;
          nextPrompt = formatToolResults(calls, results);
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
          `PiAgentRunner requires the Pi coding agent CLI (pi) on PATH. Install it: ${PI_INSTALL_HINT}, ` +
            'then configure a provider. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }
}
