// packages/@monomind/cli/src/orgrt/codex-runner.ts
/**
 * CodexAgentRunner — AgentRunner impl backed by the Codex CLI (subprocess).
 *
 * Architectural pattern: SAME as KimiCodeAgentRunner — spawn the vendor's CLI
 * binary, parse its JSONL stream, normalize to AgentMessage. No SDK dependency
 * (the @openai/codex-sdk package would add ~100MB; we use the CLI directly
 * like we do for kimi).
 *
 * Auth: inherited from ~/.codex/auth.json (created by `codex login`). The
 * ChatGPT subscription flows through this credential cache. No env vars.
 *
 * Org tools (org_send, knowledge_search, ask_human, …) — FENCE PROTOCOL:
 *   Same approach as kimi/opencode. Tools are rendered INTO the first prompt;
 *   the model emits ```tool_call fences; this runner parses them out of the
 *   agent_message text, executes the real OrgToolDef handlers in-process
 *   (gated through canUseTool), and feeds results back as the next prompt.
 *
 * Subprocess protocol (byte-accurate from openai/codex/sdk/typescript/src):
 *   - Subcommand: `codex exec --experimental-json [--model X] [--cd Y]
 *                  [--skip-git-repo-check] [--sandbox danger-full-access]
 *                  [resume <thread_id>] "<prompt>"`
 *   - JSONL on stdout, one event per line
 *   - 8 event types: thread.started, turn.started, turn.completed,
 *     turn.failed, item.started, item.updated, item.completed, error
 *   - Assistant text arrives via item.completed with item.type === 'agent_message'
 *   - NO per-token streaming (whole items only)
 *   - Resume: positional `resume <thread_id>` (NOT a flag)
 *   - Session ID captured from thread.started.thread_id
 *   - stderr is human diagnostics; buffer and surface on non-zero exit only
 */
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching kimi runner

interface CodexItem {
  id: string;
  type: 'agent_message' | 'reasoning' | 'command_execution' | 'file_change' | 'mcp_tool_call' | 'web_search' | 'todo_list' | 'error';
  text?: string;
  message?: string;
  [key: string]: unknown;
}

interface CodexEvent {
  type: 'thread.started' | 'turn.started' | 'turn.completed' | 'turn.failed' | 'item.started' | 'item.updated' | 'item.completed' | 'error';
  thread_id?: string;
  item?: CodexItem;
  usage?: {
    input_tokens: number;
    cached_input_tokens: number;
    cache_write_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
  };
  error?: { message: string };
  message?: string;
}

interface TurnOutcome {
  /** Agent_message texts with tool_call fences stripped (for the bus). */
  texts: string[];
  /** Agent_message texts with fences intact (for tool-call parsing). */
  rawTexts: string[];
  threadId?: string;
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

export class CodexAgentRunner implements AgentRunner {
  constructor(private codexBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.codexBin || process.env.CODEX_CLI_BIN || 'codex';
    let threadId: string | undefined = args.resume;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        // Tool-call loop (same shape as KimiCodeAgentRunner): keep driving
        // the same codex session until a turn produces no tool_call fences
        // (or the round cap hits).
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          // Prepend system prompt + tool protocol on first turn only (when
          // there's no thread to resume). Subsequent turns in the same
          // session carry context via the thread_id.
          const promptWithSystem = (round === 0 && !threadId)
            ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
            : nextPrompt;

          const outcome = await this.runTurn(bin, promptWithSystem, threadId, args);
          if (outcome.threadId) threadId = outcome.threadId;

          if (outcome.exitCode !== 0 || outcome.error) {
            throw new Error(
              `CodexAgentRunner: codex exec failed (exit ${outcome.exitCode})` +
              (outcome.error ? `: ${outcome.error}` : '') +
              (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
            );
          }

          for (const t of outcome.texts) {
            if (t.trim()) yield { type: 'assistant', session_id: threadId, text: t };
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;

          const malformed: string[] = [];
          const calls = parseToolCalls(outcome.rawTexts, (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
          for (const note of malformed) {
            yield { type: 'assistant', session_id: threadId, text: note };
          }
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant', session_id: threadId,
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
          session_id: threadId,
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
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

  /** Run one `codex exec` invocation and normalize its JSONL output. */
  private runTurn(
    bin: string,
    prompt: string,
    threadId: string | undefined,
    args: AgentRunArgs,
  ): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve, reject) => {
      // ARG ORDER (byte-accurate from codex SDK source):
      //   codex exec --experimental-json [--model X] [--cd Y]
      //              [--skip-git-repo-check] [--sandbox danger-full-access]
      //              [resume <threadId>] "<prompt>"
      const cliArgs: string[] = ['exec', '--experimental-json'];
      if (args.model) cliArgs.push('--model', args.model);
      cliArgs.push('--cd', args.cwd);
      cliArgs.push('--skip-git-repo-check');
      cliArgs.push('--sandbox', 'danger-full-access');
      if (threadId) {
        cliArgs.push('resume', threadId);
      }
      cliArgs.push(prompt);

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
        const events: CodexEvent[] = [];
        let buf = '';
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          buf += chunk.toString();
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('{')) continue;
            try { events.push(JSON.parse(trimmed) as CodexEvent); } catch { /* skip */ }
          }
        }
        if (buf.trim()) {
          try { events.push(JSON.parse(buf.trim()) as CodexEvent); } catch { /* skip */ }
        }
        return events;
      })()
        .then((events) => exitPromise.finally(() => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); }).then((exitCode) => ({ events, exitCode })))
        .then(({ events, exitCode }) => {
          const outcome: TurnOutcome = {
            texts: [], rawTexts: [], threadId, exitCode, stderrTail, timedOut,
            inputTokens: 0, outputTokens: 0,
          };
          for (const ev of events) {
            if (ev.type === 'thread.started' && ev.thread_id) {
              outcome.threadId = ev.thread_id;
            } else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) {
              outcome.rawTexts.push(ev.item.text);
            } else if (ev.type === 'turn.completed' && ev.usage) {
              outcome.inputTokens = ev.usage.input_tokens ?? 0;
              outcome.outputTokens = ev.usage.output_tokens ?? 0;
            } else if (ev.type === 'turn.failed' && ev.error) {
              outcome.error = ev.error.message;
            } else if (ev.type === 'error' && ev.message) {
              outcome.error = ev.message;
            }
          }
          // Strip tool_call fences for bus-visible text (shared regex with
          // kimi/opencode/antigravity — keeps fence-parsing logic in one place).
          outcome.texts = outcome.rawTexts.map(t =>
            t.replace(TOOL_CALL_RE, '').trim(),
          );
          resolve(outcome);
        }, reject);
    });
  }
}
