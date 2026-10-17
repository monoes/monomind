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
 *     would otherwise hang a non-interactive run).
 *   - Native tools: qwen-code's headless adapter writes Claude-compatible
 *     frames — `tool_use` blocks in assistant messages and `tool_result`
 *     blocks (with `is_error`) in `user` messages, correlated by the call
 *     id (read from the qwen-code 0.x bundle, not a live run). They are
 *     forwarded as rich tool_use/tool_result pairs.
 *
 * File-size sweep: the wire types + event parser (handleQwenEvent,
 * parseQwenEvents) live in qwen-runner-parse.ts, and the subprocess turn
 * runner (streamTurn) and turn-error builder (turnError) live in
 * qwen-runner-stream.ts — both re-exported below where other modules import
 * them from here.
 */
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { NativeToolCalls } from './kimicode-runner-tools.js';
import { realBinary } from './launcher-binary.js';
import type { TurnOutcome } from './qwen-runner-parse.js';
import { STARTUP_GRACE_MS, streamTurn, turnError } from './qwen-runner-stream.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export type { QwenStreamEvent } from './qwen-runner-parse.js';
export { parseQwenEvents } from './qwen-runner-parse.js';

export class QwenAgentRunner implements AgentRunner {
  constructor(private qwenBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.qwenBin || process.env.QWEN_CLI_BIN || 'qwen');
    let sessionId: string | undefined = args.resume;
    const tools = new NativeToolCalls();

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
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

          for await (const ev of streamTurn(bin, promptWithSystem, sessionId, args, outcome)) {
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
            }
            // qwen's own tool_use/tool_result blocks, paired by call id.
            for (const u of ev.toolUses ?? []) {
              const m = tools.start(u.id, u.name, u.input, sessionId);
              if (m) yield m;
            }
            for (const r of ev.toolResults ?? []) {
              yield* tools.end(r.id, r.output, r.isError, sessionId);
            }
            if (ev.kind === 'tool') {
              // Liveness only (see header): session.ts never renders
              // tool_use as chat — it only feeds the StateDetector
              // ('tool-call' state) and refreshes last-activity. No label:
              // a bare ping never becomes a tool_activity event.
              yield { type: 'tool_use', session_id: sessionId };
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

          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', session_id: sessionId, text: note };
          if (!results) break;
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
}
