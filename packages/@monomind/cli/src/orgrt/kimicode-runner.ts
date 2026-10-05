// packages/@monomind/cli/src/orgrt/kimicode-runner.ts
/**
 * KimiCodeAgentRunner — AgentRunner impl backed by the Kimi Code CLI.
 *
 * Architectural difference from ClaudeAgentRunner:
 *   - Claude's `query()` runs the whole agent loop IN-PROCESS (tools execute
 *     inside the same Node process as the daemon). That's why ClaudeAgentRunner
 *     can register org tools (org_send, ask_human, …) directly via
 *     createSdkMcpServer.
 *   - Kimi Code has no embeddable SDK. The CLI is driven as a subprocess:
 *     `kimi --print --output-format stream-json` with the prompt on stdin
 *     runs one non-interactive turn and emits JSONL events on stdout
 *     (event shapes verified against kimi 0.29.2:
 *     {"role":"assistant","content":...} per reply, then a
 *     {"role":"meta","type":"session.resume_hint",session_id} event).
 *     Session continuity comes from `--session <id>` on later turns.
 *     The prompt is NOT passed as `-p <text>` — see streamTurn for why.
 *
 * Streaming / liveness — WHY INCREMENTAL:
 *   Kimi turns routinely run 10-20+ minutes when the model chains many
 *   internal tool calls (observed: 45+ steps in one turn). session.ts races
 *   the FIRST pull from this runner against a 4-minute silent-stream
 *   watchdog, so buffering stdout until process exit (the original design)
 *   meant any turn longer than 4 minutes yielded zero messages in time —
 *   abort, retry, kill, circuit breaker, stalled org. This runner therefore
 *   parses stdout LINE BY LINE as data arrives: a liveness `tool_use`
 *   message is yielded the moment the subprocess spawns (deterministically
 *   winning the first-pull race regardless of model-thinking latency),
 *   assistant text is yielded as each event lands, and kimi's own tool
 *   calls (an assistant message's `tool_calls`) and results
 *   ({"role":"tool","tool_call_id",...}) are forwarded as rich
 *   `tool_use`/`tool_result` pairs matched by kimi's call id, so the
 *   StateDetector/idle watchdog see a working agent throughout the turn and
 *   agent exec gets full-fidelity tool_activity. Tool_call fences are still collected from
 *   the raw texts and parsed at end of turn (fence parsing needs the
 *   complete text).
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   kimi's tool surface can only be extended via MCP servers or plugins, both
 *   loaded by the CLI itself, not by an external caller per-turn. Instead the
 *   tools are rendered INTO the role's system prompt: the model emits
 *   ```tool_call fenced JSON blocks, this runner parses them out of the
 *   assistant text, executes the real OrgToolDef handlers in-process (the same
 *   handlers ClaudeAgentRunner registers with the SDK), and feeds the results
 *   back as the next prompt IN THE SAME kimi session. Loop repeats until a
 *   turn produces no tool calls (cap: AgentRunArgs.maxToolRounds, default MAX_TOOL_ROUNDS). Tool-call fences are
 *   stripped from the text yielded to session.ts so the bus only sees prose.
 *
 * Usage accounting — WIRE FILE:
 *   kimi's stream-json has no usage/result event, but every session writes
 *   usage.record entries to $KIMI_CODE_HOME/sessions/<wd>/<session_id>/
 *   agents/main/wire.jsonl. After each CLI turn this runner reads the new
 *   entries written since each round started (timestamp-filtered, so a
 *   resumed session's historical entries are never double-counted) and
 *   attaches the summed tokens to the synthesized result message session.ts
 *   needs for budget checks.
 *
 * Non-disturbance guarantees (mirrors the opencode integration):
 *   - No new package dependency: the runner shells out to the `kimi` binary
 *     via node:child_process; nothing is imported at module load time.
 *   - The runner is only constructed when MONOMIND_RUNTIME=kimicode is set
 *     (daemon.ts runner resolution). Without the env var, or without a `kimi`
 *     binary on PATH, the Claude path is byte-for-byte unchanged and run()
 *     rejects with a clear actionable error instead of crashing at import.
 *
 * File-size sweep: the stream-json parser + fatal-error classification live
 * in kimicode-runner-parse.ts, and the subprocess turn runner (streamTurn),
 * usage-file reader (readUsageDelta) and turn-error builder (turnError) live
 * in kimicode-runner-stream.ts — both re-exported below where other modules
 * import them from here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import type { TurnOutcome } from './kimicode-runner-stream.js';
import { readUsageDelta, streamTurn, turnError } from './kimicode-runner-stream.js';
import { NativeToolCalls } from './kimicode-runner-tools.js';
import { createRunnerInputDir, writeRunnerInput } from './runner-inputs.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

export type { FatalErrorInfo, KimiStreamEvent } from './kimicode-runner-parse.js';
export {
  classifyStderr,
  parseStreamJsonLine,
  parseStreamJsonLines,
} from './kimicode-runner-parse.js';

export class KimiCodeAgentRunner implements AgentRunner {
  private emptySkillsDir: string | undefined = '';

  constructor(private kimiBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.kimiBin || process.env.KIMI_CLI_BIN || 'kimi';
    // Coder mode. Full access drops the role agent file — its `tools:`
    // allowlist is an org-role gate — so the user's default kimi agent
    // runs with its whole tool surface; the system prompt then rides on the
    // first prompt instead (as codex/antigravity already carry theirs).
    // Full access or `--settings` also keeps the user's own skills (no
    // empty --skills-dir) and thinking config.
    const fullAccess = args.access === 'full';
    const userSetup = fullAccess || (args.settingSources?.length ?? 0) > 0;

    // The system prompt reaches kimi as an agent file (--agent-file binds the
    // agent at session creation; resume restores it, so later turns only need
    // --session). Written to a per-run temp dir and cleaned up in finally.
    //
    // The `tools:` allowlist is load-bearing TWICE over:
    //   1. Token cost: kimi injects the schemas of every tool the agent may
    //      see into each request — measured 73KB/turn for the full built-in
    //      surface (Agent, Skill, Cron, WebSearch, …) that org roles never
    //      use. This list cuts it to the handful an org role actually needs.
    //   2. Policy: on the subprocess backends the daemon cannot intercept
    //      native tool calls (canUseTool only gates Claude's in-process
    //      tools), so this allowlist IS the tool gate for kimi org roles.
    //      Keep it minimal — org-specific denials belong here, not prose.
    const tmpDir = createRunnerInputDir('kimi', args);
    const agentFile = fullAccess ? undefined : path.join(tmpDir, 'org-role.md');
    let sessionId: string | undefined = args.resume;
    const tools = new NativeToolCalls();

    try {
      // kimi rejects an agent file whose body (everything after the frontmatter)
      // is empty with "Missing prompt body". `args.systemPrompt` is legitimately
      // '' for bare `agent exec` calls with no --system-file (agent.ask, `chat`
      // without --canvas, `agent test`), and buildToolProtocol() is also '' with
      // no tools — so the two together can leave nothing after the frontmatter.
      // Fall back to a minimal default so the file body is never empty.
      const body =
        (args.systemPrompt || 'You are a helpful assistant.') + buildToolProtocol(args.tools);
      if (agentFile) {
        writeRunnerInput(
          agentFile,
          `---\nname: monomind-org-role\ndescription: Monomind org role (managed by monomind orgrt)\n` +
            `tools: [Bash, Read, Write, Edit, Glob, Grep]\n---\n\n` +
            body,
        );
      }

      // Empty skills dir: kimi loads every user/project skill's description
      // into the system prompt on launch (measured: 47 skills ≈ several KB per
      // turn). Org roles get their instructions from the role prompt — user
      // skills are pure overhead and a source of instruction drift.
      this.emptySkillsDir = userSetup ? undefined : path.join(tmpDir, 'no-skills');
      if (this.emptySkillsDir) fs.mkdirSync(this.emptySkillsDir, { recursive: true });

      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        // Tool-call loop: keep driving the same kimi session until a turn
        // produces no tool_call fences (or the round cap hits).
        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          const roundStart = Date.now();
          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = { exitCode: 1, stderrTail: '', timedOut: false };
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];
          // No agent file (full access): a fresh session gets the system
          // prompt and tool protocol ahead of the first prompt.
          const prefix = `${args.systemPrompt ?? ''}${buildToolProtocol(args.tools)}`;
          const promptText =
            !agentFile && !sessionId && prefix ? `${prefix}\n\n---\n\n${nextPrompt}` : nextPrompt;

          for await (const ev of streamTurn(
            bin,
            promptText,
            sessionId,
            args,
            agentFile,
            this.emptySkillsDir,
            outcome,
          )) {
            if (ev.sessionId) sessionId = ev.sessionId;
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (not after process exit):
              // a kimi turn can run 10-20+ minutes, and session.ts's watchdog
              // must see messages DURING the turn. Note this means partial
              // output may already be yielded when a turn later exits
              // non-zero — preferable to losing it entirely.
              if (ev.text) yield { type: 'assistant', session_id: sessionId, text: ev.text };
            }
            // kimi's own tool calls and results, paired by its call id.
            for (const c of ev.toolCalls ?? []) {
              const m = tools.start(c.id, c.name, c.input, sessionId);
              if (m) yield m;
            }
            if (ev.toolResult) {
              yield* tools.end(ev.toolResult.id, ev.toolResult.output, false, sessionId);
            }
            if (ev.kind === 'tool') {
              // Liveness (spawn-time, or a tool event with no call id):
              // session.ts never renders tool_use as chat — it only feeds
              // the StateDetector ('tool-call' state) and refreshes
              // last-activity. No label: a bare ping never becomes a
              // tool_activity event (kimi's real calls do, above).
              yield { type: 'tool_use', session_id: sessionId };
            }
          }
          if (outcome.sessionId) sessionId = outcome.sessionId;

          if (outcome.exitCode !== 0) {
            throw turnError(outcome, round, bin);
          }

          const usage = readUsageDelta(sessionId, args.env, roundStart);
          turnInputTokens += usage.input;
          turnOutputTokens += usage.output;

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) {
            yield { type: 'assistant', session_id: sessionId, text: note };
          }
          if (calls.length === 0) break;

          // Execute the real OrgToolDef handlers in-process and feed results
          // back into the same kimi session as the next prompt.
          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', session_id: sessionId, text: note };
          if (!results) break;
          nextPrompt = formatToolResults(calls, results);
        }

        // kimi emits no usage/result event, so synthesize one per mailbox
        // prompt: session.ts uses result messages for usage accounting and
        // budget checks, and other runners yield exactly one result per turn.
        yield {
          type: 'result',
          session_id: sessionId,
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
        };
      }
    } catch (err) {
      // Spawn-level failure (binary missing) gets the opencode-style guidance.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'KimiCodeAgentRunner requires the Kimi Code CLI (kimi) on PATH. ' +
            'Install it and log in, or unset MONOMIND_RUNTIME to use the Claude runner.',
        );
      }
      throw err;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}
