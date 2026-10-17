// packages/@monomind/cli/src/orgrt/grok-runner.ts
/**
 * GrokAgentRunner — AgentRunner impl backed by the Grok Build CLI (`grok`,
 * xAI's agentic coding CLI: https://docs.x.ai/build/cli).
 *
 * Architectural pattern: SAME as CodexAgentRunner/AntigravityAgentRunner/
 * KimiCodeAgentRunner — spawn the vendor's CLI binary, parse its NDJSON
 * stream, normalize to AgentMessage. No SDK dependency.
 *
 * Auth: inherited from the CLI's own login flow (subscription/API key
 * managed by `grok` itself). No env vars set by this runner.
 *
 * Streaming / liveness — WHY INCREMENTAL (#204):
 *   This runner originally buffered ALL of grok's stdout until the
 *   subprocess exited before parsing anything, so any turn longer than
 *   session.ts's 4-minute silent-stream watchdog (SILENT_SESSION_MS) yielded
 *   zero messages in time — abort, retry, kill, circuit breaker. Same bug
 *   class the codex/kimi/antigravity runners had (#204 audit). This runner
 *   now parses stdout LINE BY LINE as data arrives: a liveness `tool_use`
 *   message is yielded the instant the subprocess spawns (deterministically
 *   winning the watchdog's first-pull race regardless of model latency), and
 *   each parsed assistant event is yielded as its line lands rather than
 *   accumulated until process exit. grok's own tool calls arrive as
 *   `tool_use` blocks in assistant frames and their results as
 *   `tool_result` blocks in user frames (`streaming-messages-json`, below);
 *   both are forwarded as rich tool_use/tool_result pairs matched by grok's
 *   call id. Fatal provider errors (auth/quota) are classified via
 *   the shared classifyStderr helper (same as kimi/codex/antigravity) and
 *   tagged non-retryable. The STARTUP_GRACE_MS first-run-prompt hang
 *   detection below is unrelated to #204 (it guards a different failure
 *   mode — a stuck interactive trust prompt, not a slow-but-alive turn) and
 *   is unchanged by this fix.
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Same approach as codex/kimi/opencode. Tools are rendered INTO the first
 *   prompt; the model emits ```tool_call fences; this runner parses them out
 *   of the assistant text, executes the real OrgToolDef handlers in-process
 *   (gated through canUseTool), and feeds results back as the next prompt.
 *
 * Subprocess protocol — per public docs (docs.x.ai/build/cli/reference),
 * PARTIALLY byte-verified against a live v1.0.5 install (`npm install -g
 * @xai-official/grok`; see #178). CONFIRMED LIVE: the flag was wrong — this
 * runner used to pass `--format json`, which grok rejects outright
 * ("unexpected argument '--format' found" — no such flag exists). Fixed to
 * `--output-format json`, confirmed correct by getting past argument
 * parsing straight to an auth error ("Not signed in") with no XAI_API_KEY
 * available to test further.
 *
 * STILL UNVERIFIED (no XAI_API_KEY in the environment this fix was made
 * in): grok's `--output-format` has FOUR documented values — `plain`,
 * `json`, `streaming-json` (NDJSON of native ACP session updates), and
 * `streaming-messages-json` (NDJSON in the Anthropic Messages API wire
 * format). This runner uses plain `json`, but events are parsed as
 * one-JSON-object-per-line (NDJSON) — worth checking live whether `json`
 * actually emits NDJSON, or a single (possibly multi-line-formatted) JSON
 * blob that would break the line-based parser. If it's the latter,
 * `streaming-messages-json` looks like the better fit (NDJSON, and a
 * documented wire format this codebase already knows how to parse
 * elsewhere) — untested, flagging rather than guessing. The exact NDJSON
 * event field names for whichever format is correct were STILL not
 * available at fix time, so event parsing tolerates several plausible
 * shapes (codex-style `item.type === 'agent_message'`, a flat `role:
 * 'assistant'` shape, and a flat `type: 'assistant'`/`'message'` shape)
 * rather than committing to one. Verify against a real XAI_API_KEY and
 * tighten this parser if the real shape differs — a wrong guess here fails
 * closed (no text extracted, not a crash), which is what the "no known
 * shape matched" path is for.
 *   - Invocation: `grok -p "<prompt>" --output-format streaming-messages-json
 *                 --always-approve [--sandbox workspace] [--model X]
 *                 [--reasoning-effort L] [--max-turns N] --cwd Y [--resume <id>]`
 *     (the sandbox profile follows the role's policy.git level — cli-sandbox.ts;
 *     `--access full` drops it). SUPERSEDES the `json` notes below: the
 *     format switch is documented in grok-runner-stream.ts.
 *   - Session continuity: `-r/--resume [<id>]` resumes a specific session,
 *     `-c/--continue` resumes the most recent one. Session id is captured
 *     from any event carrying `session_id` / `sessionId` / `thread_id`.
 *   - stderr is human diagnostics; buffered and surfaced on non-zero exit.
 *
 * File-size sweep: the NDJSON event extractors + batch parser live in
 * grok-runner-parse.ts, and the subprocess turn runner (streamTurn) and
 * turn-error builder (turnError) live in grok-runner-stream.ts — both
 * re-exported below where other modules import them from here.
 */
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import type { TurnOutcome } from './grok-runner-stream.js';
import { streamTurn, turnError } from './grok-runner-stream.js';
import { NativeToolCalls } from './kimicode-runner-tools.js';
import { realBinary } from './launcher-binary.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export type { GrokStreamEvent } from './grok-runner-parse.js';
export { parseGrokEvents } from './grok-runner-parse.js';

export class GrokAgentRunner implements AgentRunner {
  constructor(private grokBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.grokBin || process.env.GROK_CLI_BIN || 'grok');
    let sessionId: string | undefined = args.resume;
    const tools = new NativeToolCalls();
    // grok's total_cost_usd is per invocation (one `grok -p` process); the
    // result carries this run's running sum, the cumulative-per-session
    // figure every consumer of `cost_usd` expects.
    let runCostUsd: number | undefined;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let maxTurnsHit = false;

        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          // Gated on !sessionId alone, NOT `round === 0 && !sessionId` — if
          // a session id never gets parsed out of grok's output (a real
          // risk, per this file's header: the exact event shape is a
          // documented guess), every round after the first would otherwise
          // spawn a completely fresh, contextless grok invocation carrying
          // only the tool-result text — no system prompt, no session to
          // resume. Once a session id IS captured, --resume takes over and
          // this stops re-sending the system prompt.
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

          for await (const ev of streamTurn(bin, promptWithSystem, sessionId, args, outcome)) {
            if (ev.sessionId) sessionId = ev.sessionId;
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per parsed line, not
              // after process exit): a grok turn can run many minutes, and
              // session.ts's watchdog must see messages DURING the turn.
              if (ev.text) yield { type: 'assistant', session_id: sessionId, text: ev.text };
            }
            // grok's own tool_use/tool_result blocks, paired by their ids.
            for (const u of ev.toolUses ?? []) {
              const m = tools.start(u.id, u.name, u.input, sessionId);
              if (m) yield m;
            }
            for (const r of ev.toolResults ?? []) {
              yield* tools.end(r.id, r.output, r.isError, sessionId);
            }
            if (ev.kind === 'tool') {
              // Liveness only (see header) — session.ts never renders
              // tool_use as chat, it only feeds the StateDetector
              // ('tool-call' state) and refreshes last-activity. No label:
              // a bare ping never becomes a tool_activity event.
              yield { type: 'tool_use', session_id: sessionId };
            }
          }
          if (outcome.sessionId) sessionId = outcome.sessionId;

          if (
            outcome.hangSuspected ||
            (outcome.exitCode !== 0 && !outcome.maxTurnsHit) ||
            outcome.error
          ) {
            throw turnError(outcome, round);
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;
          if (outcome.costUsd !== undefined) runCostUsd = (runCostUsd ?? 0) + outcome.costUsd;
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
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
          ...(runCostUsd !== undefined ? { cost_usd: runCostUsd } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'GrokAgentRunner requires the Grok Build CLI (grok) on PATH. ' +
            'Install it per https://docs.x.ai/build/cli, then log in. ' +
            'Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }
}
