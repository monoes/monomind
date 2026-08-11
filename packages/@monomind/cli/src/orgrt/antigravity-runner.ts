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
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching kimi/codex runners

interface AgyStepUpdate {
  type: 'step_update';
  step_type?: 'user_input' | 'agent_response' | 'tool' | 'checkpoint';
  state?: 'ACTIVE' | 'DONE';
  text_delta?: string;
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

interface AgyResult {
  type: 'result';
  conversation_id?: string;
  status?: 'SUCCESS' | 'ERROR' | 'CANCELED' | 'INTERRUPTED' | 'INVALID' | 'WAITING' | 'RUNNING';
  response?: string;
  error?: string;
  usage?: AgyUsage;
}

interface AgyInit {
  type: 'init';
  conversation_id?: string;
}

type AgyEvent = AgyStepUpdate | AgyResult | AgyInit | { type: string; [key: string]: unknown };

interface TurnOutcome {
  /** Concatenated agent_response text (fences stripped for the bus). */
  texts: string[];
  /** Concatenated agent_response text (fences intact for tool-call parsing). */
  rawTexts: string[];
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
          const promptWithSystem = (round === 0 && !conversationId)
            ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
            : nextPrompt;

          const outcome = await this.runTurn(bin, promptWithSystem, conversationId, args);
          if (outcome.conversationId) conversationId = outcome.conversationId;

          if (outcome.exitCode !== 0 || outcome.error) {
            throw new Error(
              `AntigravityAgentRunner: agy failed (exit ${outcome.exitCode})` +
              (outcome.error ? `: ${outcome.error}` : '') +
              (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
            );
          }

          for (const t of outcome.texts) {
            if (t.trim()) yield { type: 'assistant', session_id: conversationId, text: t };
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;

          const malformed: string[] = [];
          const calls = parseToolCalls(outcome.rawTexts, (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
          for (const note of malformed) {
            yield { type: 'assistant', session_id: conversationId, text: note };
          }
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant', session_id: conversationId,
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

  /** Run one `agy` invocation and normalize its stream-json output. */
  private runTurn(
    bin: string,
    prompt: string,
    conversationId: string | undefined,
    args: AgentRunArgs,
  ): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve, reject) => {
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

      // Arm the turn timeout BEFORE consuming stdout.
      let timedOut = false;
      const KILL_GRACE_MS = 5000;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
        killTimer.unref?.();
      }, TURN_TIMEOUT_MS);

      const exitPromise = new Promise<number>((res, rej) => {
        child.on('error', rej);
        child.on('close', (code) => res(code ?? 1));
      });
      exitPromise.catch(() => {});

      (async () => {
        const events: AgyEvent[] = [];
        let buf = '';
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          buf += chunk.toString();
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('{')) continue;
            try { events.push(JSON.parse(trimmed) as AgyEvent); } catch { /* skip */ }
          }
        }
        if (buf.trim()) {
          try { events.push(JSON.parse(buf.trim()) as AgyEvent); } catch { /* skip */ }
        }
        return events;
      })()
        .then((events) => exitPromise.finally(() => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); }).then((exitCode) => ({ events, exitCode })))
        .then(({ events, exitCode }) => {
          const outcome: TurnOutcome = {
            texts: [], rawTexts: [], conversationId, exitCode, stderrTail, timedOut,
            inputTokens: 0, outputTokens: 0,
          };
          // Accumulate text_delta fragments per turn — agy streams per-token
          // via step_update events with step_type === 'agent_response'. We
          // accumulate the full text before stripping fences (unlike codex/kimi
          // which receive whole items; agy's per-token deltas would split a
          // ```tool_call fence across many events, making per-delta stripping
          // unreliable). The bus sees one assistant message per turn with the
          // complete cleaned text — matching kimi/codex behavior.
          let rawAccumulated = '';
          for (const ev of events) {
            if (ev.type === 'init' && (ev as AgyInit).conversation_id) {
              outcome.conversationId = (ev as AgyInit).conversation_id;
            } else if (ev.type === 'step_update') {
              const step = ev as AgyStepUpdate;
              if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
                rawAccumulated += step.text_delta;
              }
            } else if (ev.type === 'result') {
              const result = ev as AgyResult;
              if (result.conversation_id) outcome.conversationId = result.conversation_id;
              if (result.status && result.status !== 'SUCCESS') {
                outcome.error = result.error ?? `status: ${result.status}`;
              }
              if (result.usage) {
                outcome.inputTokens = result.usage.input_tokens ?? 0;
                outcome.outputTokens = result.usage.output_tokens ?? 0;
              }
            }
          }
          // Strip fences from the accumulated text for bus-visible output;
          // keep the raw version for tool-call parsing.
          if (rawAccumulated) {
            outcome.rawTexts.push(rawAccumulated);
            const stripped = rawAccumulated.replace(TOOL_CALL_RE, '').trim();
            if (stripped) outcome.texts.push(stripped);
          } else {
            // Fallback for agy versions that only return result.response (no streaming)
            const resultEvent = events.find(e => e.type === 'result') as AgyResult | undefined;
            if (resultEvent?.response) {
              outcome.rawTexts.push(resultEvent.response);
              const stripped = resultEvent.response.replace(TOOL_CALL_RE, '').trim();
              if (stripped) outcome.texts.push(stripped);
            }
          }

          resolve(outcome);
        }, reject);
    });
  }
}
