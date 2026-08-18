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
 *   - Invocation: `codex exec --json [--model X] [--cd Y]
 *                 [--skip-git-repo-check] [--sandbox danger-full-access]
 *                 [resume <sessionId> "<prompt>"]`. `--experimental-json`
 *     (the old flag name) doesn't exist in v0.21.0 — confirmed live
 *     ("unexpected argument '--experimental-json' found"); `--json` is
 *     correct in both v0.21.0 and the current v0.147.0 (where
 *     `--experimental-json` IS an alias again, per current
 *     `codex-rs/exec/src/cli.rs` — but v0.21.0 predates that alias).
 *   - `resume` is a SUBCOMMAND of `exec`, not a positional after other exec
 *     flags in isolation — `codex exec resume <sessionId> ["<prompt>"]`,
 *     with `exec`'s own global flags (--json, --model, --sandbox, etc.)
 *     specified BEFORE the `resume` token. Confirmed live (v0.147.0) that
 *     this exact arg order parses cleanly — it got past all argument
 *     parsing straight to an (unrelated, expired-token) auth error, not a
 *     flag/subcommand error. v0.21.0 has no `resume` subcommand at all
 *     (confirmed live: "resume" was consumed as the PROMPT text itself,
 *     then the actual session id was rejected as an unexpected extra
 *     positional) — so resume silently can't work pre-~v0.12x. This runner
 *     doesn't detect codex's version; if resume fails on an old install,
 *     each turn falls back to a fresh (contextless) session rather than
 *     erroring — a real limitation, not fixed here.
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
 *     NOT from a "thread.started" event, which doesn't exist in this
 *     protocol.
 *   - stderr is human diagnostics; buffer and surface on non-zero exit only.
 *
 * STILL UNVERIFIED end-to-end (this environment's ~/.codex/auth.json had a
 * dead refresh token — "refresh token was already used... sign in again" —
 * needs a fresh `codex login`, not something driven here): a full
 * successful `task_complete`/`token_count` pair was never actually
 * observed. The struct field names above are taken directly from the Rust
 * source (high confidence, not a guess), but a live confirmation of the
 * exact JSON once auth works would still be worthwhile.
 */
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching kimi runner

/** `EventMsg`'s legacy v1 wire format — see file header for the source
 *  citation (codex-rs/protocol/src/protocol.rs + legacy_events.rs). Only
 *  the variants this runner acts on are typed; everything else (exec
 *  command begin/end, mcp tool call begin/end, reasoning, …) is ignored. */
interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexEvent {
  type:
    | 'session_configured'
    | 'task_started'
    | 'agent_message'
    | 'token_count'
    | 'task_complete'
    | 'error';
  // session_configured
  session_id?: string;
  thread_id?: string;
  // agent_message
  message?: string;
  // token_count
  info?: { last_token_usage?: CodexTokenUsage; total_token_usage?: CodexTokenUsage };
  // task_complete
  turn_id?: string;
  last_agent_message?: string;
  error?: { message: string };
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
      // ARG ORDER — see file header for the live-verified citation:
      //   codex exec --json [--model X] [--cd Y]
      //              [--skip-git-repo-check] [--sandbox danger-full-access]
      //              [resume <threadId>] "<prompt>"
      const cliArgs: string[] = ['exec', '--json'];
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
            if (ev.type === 'session_configured' && (ev.session_id || ev.thread_id)) {
              outcome.threadId = ev.session_id ?? ev.thread_id;
            } else if (ev.type === 'agent_message' && ev.message) {
              outcome.rawTexts.push(ev.message);
            } else if (ev.type === 'token_count' && ev.info?.last_token_usage) {
              // last_token_usage is per-TURN; total_token_usage is
              // cumulative for the whole session — using the latter here
              // would over-report on every turn after the first.
              outcome.inputTokens = ev.info.last_token_usage.input_tokens ?? 0;
              outcome.outputTokens = ev.info.last_token_usage.output_tokens ?? 0;
            } else if (ev.type === 'task_complete') {
              if (ev.error) outcome.error = ev.error.message;
              // last_agent_message is a convenience summary already covered
              // by the agent_message events collected above — not pushed
              // again here to avoid duplicating the same text.
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
