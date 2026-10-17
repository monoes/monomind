// packages/@monomind/cli/src/orgrt/cline-runner.ts
/**
 * ClineAgentRunner — AgentRunner backed by the Cline CLI (`cline`, npm
 * `cline`, cline/cline apps/cli; verified against 3.0.65). Same shape as the
 * other CLI runners: spawn the CLI per turn, parse its stream, normalize to
 * AgentMessage; org tools ride the fence protocol (tool-fence.ts).
 *
 * Two protocols, one per kind of turn:
 *   - A fresh session: `cline --json` (cline-runner-stream.ts) — NDJSON with
 *     tool start/end on toolCallId, per-step usage and cost, `run_result` as
 *     the terminal frame, `--thinking` for effort, and `iteration_start`
 *     counted for max turns. The session id is not in the stream; it is
 *     read back from `cline history --json`.
 *   - Every later turn of that session (a tool round, the next mailbox
 *     message, AgentRunArgs.resume): ACP `session/load` + `session/prompt`
 *     (cline-runner-acp.ts), because `--id` cannot be combined with `--json`.
 *     ACP drops usage, iterations and thinking: usage/cost come from the
 *     history row's cumulative totals, max turns is approximated by model
 *     steps, and effort does not apply to resumed turns.
 *
 * Access: never `-y/--yolo` (it narrows the toolset). Full access, or
 * `--settings`, runs on the user's own ~/.cline — auth, rules, hooks, MCP —
 * untouched, with auto-approve on. Scoped isolates state with
 * `--config`/`--data-dir` and an empty CLINE_MCP_SETTINGS_PATH
 * (cline-runner-host.ts), and refuses every tool call that needs approval —
 * commands, edits, subagents, MCP tools — instead of approving it; a refused
 * call ends `denied` and the turn goes on (cline-runner-scoped.ts).
 *
 * Hub daemon: cline starts a detached `cline --cline-hub-daemon` that
 * outlives the run. Every process the runner spawns carries a per-turn
 * marker env; the daemon a turn started is found by it (and by the hub lock
 * file) and killed when the turn's process closes and on abort (Stop).
 *
 * Nested-agent marker: MONOMIND_CLINE_TURN (CLINE_TURN_ENV) is set on cline
 * and everything it runs.
 */

import { UNCLASSIFIED_MARKER } from './agent-exec-errors.js';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { streamAcpTurn } from './cline-runner-acp.js';
import { defaultClineHost, prepareClineSetup } from './cline-runner-host.js';
import { streamJsonTurn } from './cline-runner-stream.js';
import { ClineToolCalls } from './cline-runner-tools.js';
import type { ClineHost, ClineTurnOutcome } from './cline-runner-types.js';
import { classifyStderr } from './kimicode-runner.js';
import { realBinary } from './launcher-binary.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
  TOOL_CALL_RE,
} from './tool-fence.js';

export const CLINE_INSTALL_HINT = 'npm install -g cline && cline auth';
const PING_INTERVAL_MS = 1000;

function missingBinary(): Error {
  return new Error(
    `ClineAgentRunner requires the Cline CLI (cline) on PATH. Install it: ${CLINE_INSTALL_HINT}. ` +
      'Or unset the runtime to use Claude.',
  );
}

function fatal(message: string): Error {
  const err = new Error(message);
  (err as Error & { fatal?: boolean }).fatal = true;
  return err;
}

/**
 * cline stops a run after consecutive failed tool calls (its mistake limit,
 * `--retries`, default 3; verified live: `run_result.finishReason
 * "aborted"`). When the last call was a limited-mode refusal, the turn ended
 * on refusals — a normal end, not an error.
 */
export function endedOnRefusals(o: ClineTurnOutcome, lastCallRefused: boolean): boolean {
  return (
    lastCallRefused &&
    !o.timedOut &&
    !o.fatal &&
    ['aborted', 'mistake_limit', 'cancelled'].includes(o.finishReason ?? '')
  );
}

/** The error of a finished turn, or undefined when it completed. */
export function clineTurnFailure(o: ClineTurnOutcome, resumed: boolean): Error | undefined {
  if (o.maxTurnsHit) return undefined;
  if (o.fatal) return fatal(`ClineAgentRunner: ${o.errorMessage ?? 'cline setup failed'}`);
  if (o.timedOut)
    return new Error('ClineAgentRunner: cline exceeded the turn timeout and was killed.');
  const ok = resumed ? o.finishReason === 'end_turn' : o.finishReason === 'completed';
  if (ok && o.exitCode === 0) return undefined;
  if (!resumed && o.exitCode === 127 && /not found|No such file/i.test(o.stderrTail))
    return missingBinary();
  const detail =
    o.errorMessage ??
    (o.finishReason ? `cline stopped: ${o.finishReason}` : `cline exited ${o.exitCode}`);
  const message =
    `ClineAgentRunner: ${detail}` +
    (o.stderrTail && !o.errorMessage ? `\nstderr: ${o.stderrTail.slice(-500)}` : '') +
    (o.resultText && !o.errorMessage
      ? `${UNCLASSIFIED_MARKER}cline final text: ${o.resultText.slice(-500)}`
      : '');
  return classifyStderr(`${detail}\n${o.stderrTail}`).fatal ? fatal(message) : new Error(message);
}

export class ClineAgentRunner implements AgentRunner {
  constructor(
    private clineBin?: string,
    private host: ClineHost = defaultClineHost,
  ) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.clineBin || process.env.CLINE_CLI_BIN || 'cline');
    const setup = prepareClineSetup(args, bin, this.host);
    let sessionId: string | undefined = args.resume;
    const known: { provider?: string; model?: string } = {};
    const tools = new ClineToolCalls();
    // Cost of this run's turns (cumulative, like every runner's cost_usd).
    let runCostUsd: number | undefined;
    let lastPing = 0;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        let maxTurnsHit = false;

        for (let round = 0; ; round++) {
          const resumed = sessionId;
          const prompt = resumed
            ? nextPrompt
            : `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`;
          const outcome: ClineTurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            maxTurnsHit: false,
          };
          const stream = resumed
            ? streamAcpTurn(setup, resumed, prompt, args, this.host, outcome, known)
            : streamJsonTurn(setup, prompt, args, this.host, outcome);
          const rawTexts: string[] = [];
          tools.lastDenied = false;
          for await (const ev of stream) {
            if (ev.kind === 'text') {
              rawTexts.push(ev.text);
              const shown = ev.text.replace(TOOL_CALL_RE, '').trim();
              if (shown) yield { type: 'assistant', session_id: sessionId, text: shown };
            } else if (ev.kind === 'tool_start') {
              const m = tools.start(ev.id, ev.name, ev.input, sessionId);
              if (m) yield m;
            } else if (ev.kind === 'tool_end') {
              yield* tools.end(ev.id, ev.name, ev.output, ev.error, sessionId, ev.denied);
            } else if (Date.now() - lastPing >= PING_INTERVAL_MS) {
              // Liveness only (a bare tool_use never becomes tool_activity),
              // throttled: cline streams reasoning one chunk per event.
              lastPing = Date.now();
              yield { type: 'tool_use', session_id: sessionId };
            }
          }

          if (outcome.sessionId) sessionId = outcome.sessionId;
          if (outcome.provider) known.provider = outcome.provider;
          if (outcome.model) known.model = outcome.model;
          const failure = clineTurnFailure(outcome, !!resumed);
          if (failure && endedOnRefusals(outcome, tools.lastDenied && !args.signal?.aborted)) {
            yield {
              type: 'assistant',
              session_id: sessionId,
              text: '[monomind] cline ended the turn after refused tool calls (limited mode refuses commands, edits, subagents and MCP tools)',
            };
          } else if (failure) throw failure;
          if (outcome.usage) {
            usage.input += outcome.usage.inputTokens;
            usage.output += outcome.usage.outputTokens;
            usage.cacheRead += outcome.usage.cacheReadTokens;
            usage.cacheWrite += outcome.usage.cacheWriteTokens;
            if (outcome.usage.totalCost !== undefined) {
              runCostUsd = (runCostUsd ?? 0) + outcome.usage.totalCost;
            }
          }
          if (!sessionId) {
            yield {
              type: 'assistant',
              text: '[monomind] cline session id not found in `cline history`; the next turn starts a new cline session',
            };
          }
          if (outcome.maxTurnsHit) {
            maxTurnsHit = true;
            break;
          }

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed)
            yield { type: 'assistant', session_id: sessionId, text: note };
          if (calls.length === 0) break;
          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', session_id: sessionId, text: note };
          if (!results) break;
          nextPrompt = formatToolResults(calls, results);
        }

        yield {
          type: 'result',
          session_id: sessionId,
          subtype: maxTurnsHit ? 'error_max_turns' : 'success',
          input_tokens: usage.input,
          output_tokens: usage.output,
          ...(usage.cacheRead ? { cache_read_input_tokens: usage.cacheRead } : {}),
          ...(usage.cacheWrite ? { cache_creation_input_tokens: usage.cacheWrite } : {}),
          ...(runCostUsd !== undefined ? { cost_usd: runCostUsd } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw missingBinary();
      throw err;
    }
  }
}
