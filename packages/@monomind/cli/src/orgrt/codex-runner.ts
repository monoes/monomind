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
 *   `command_execution` items are forwarded as `tool_use` liveness messages
 *   at their `item.started` boundary. Tool_call fences are still collected
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
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
import { classifyStderr } from './kimicode-runner.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching kimi/antigravity runners

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

/** Current (v0.149.0+) item-based wire format's `item` payload. Only the
 *  fields this runner acts on are typed — other item types (reasoning,
 *  patch_apply, mcp_tool_call, …) are ignored, same policy as the legacy
 *  format's untyped variants. */
interface CodexItem {
  id: string;
  type: string;
  /** agent_message */
  text?: string;
  /** command_execution */
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

interface CodexEvent {
  type:
    // LEGACY (v0.147.0-era) shape
    | 'session_configured'
    | 'task_started'
    | 'agent_message'
    | 'token_count'
    | 'task_complete'
    | 'error'
    // CURRENT (v0.149.0+) item-based shape
    | 'thread.started'
    | 'turn.started'
    | 'item.started'
    | 'item.completed'
    | 'turn.completed'
    | (string & {});
  // LEGACY session_configured / CURRENT thread.started
  session_id?: string;
  thread_id?: string;
  // LEGACY agent_message (top-level)
  message?: string;
  // LEGACY token_count
  info?: { last_token_usage?: CodexTokenUsage; total_token_usage?: CodexTokenUsage };
  // LEGACY task_complete
  turn_id?: string;
  last_agent_message?: string;
  error?: { message: string };
  // CURRENT item.started / item.completed
  item?: CodexItem;
  // CURRENT turn.completed
  usage?: CodexTokenUsage;
}

/**
 * One parsed codex event, normalized for incremental streaming.
 *   - 'assistant': rawText is one whole agent_message (fences intact) for
 *     end-of-turn tool-call parsing; text is the fence-stripped prose,
 *     present only when non-empty.
 *   - 'tool':      codex's own tool activity (a command_execution item's
 *     start, or the spawn-time liveness yield) — forwarded by run() as a
 *     `tool_use` liveness AgentMessage (see header).
 *   - 'meta':      any other event that only carries a thread id.
 */
export interface CodexStreamEvent {
  kind: 'assistant' | 'tool' | 'meta';
  text?: string;
  rawText?: string;
  toolName?: string;
  threadId?: string;
}

interface TurnOutcome {
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

        // Tool-call loop (same shape as KimiCodeAgentRunner/AntigravityAgentRunner):
        // keep driving the same codex session until a turn produces no
        // tool_call fences (or the round cap hits).
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          // Prepend system prompt + tool protocol on first turn only (when
          // there's no thread to resume). Subsequent turns in the same
          // session carry context via the thread_id.
          const promptWithSystem = (round === 0 && !threadId)
            ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
            : nextPrompt;

          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            exitCode: 1, stderrTail: '', timedOut: false, inputTokens: 0, outputTokens: 0,
          };
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];

          for await (const ev of this.streamTurn(bin, promptWithSystem, threadId, args, outcome)) {
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
              // Liveness for codex's own tool activity (or the spawn-time
              // yield): session.ts never renders tool_use as chat — it only
              // feeds the StateDetector ('tool-call' state) and refreshes
              // last-activity.
              yield { type: 'tool_use', session_id: threadId, text: ev.toolName };
            }
          }
          if (outcome.threadId) threadId = outcome.threadId;

          if (outcome.exitCode !== 0 || outcome.error) {
            throw turnError(outcome, round, bin);
          }
          turnInputTokens += outcome.inputTokens;
          turnOutputTokens += outcome.outputTokens;

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) => malformed.push(
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

  /**
   * Run one `codex exec` invocation and stream its JSONL output
   * INCREMENTALLY: each parsed event is yielded as soon as its line arrives
   * on stdout (see the header's "Streaming / liveness" note for why
   * buffering until process exit was a bug, #204). End-of-turn facts (exit
   * code, stderr tail, thread id, usage, error, timeout flag) are written
   * into `outcome`, which the caller reads after this generator completes.
   */
  private async *streamTurn(
    bin: string,
    prompt: string,
    threadId: string | undefined,
    args: AgentRunArgs,
    outcome: TurnOutcome,
  ): AsyncGenerator<CodexStreamEvent> {
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

    // Arm the turn timeout BEFORE consuming stdout — a hung CLI must be
    // killed while we're still reading, not after it finishes.
    let timedOut = false;
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A wedged CLI that ignores SIGTERM must not leak a zombie per turn:
      // escalate to SIGKILL after a short grace period.
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
      killTimer.unref?.();
    }, TURN_TIMEOUT_MS);

    // Attach the exit promise BEFORE consuming stdout: on a spawn failure
    // (ENOENT, bad binary) the 'error' event fires almost immediately — if
    // no listener is attached yet it escapes as an unhandled 'error' event
    // and crashes the process instead of reaching our catch block.
    const exitPromise = new Promise<number>((res, rej) => {
      child.on('error', rej);
      child.on('close', (code) => res(code ?? 1));
    });
    // Prevent an unhandled-rejection crash if the stdout loop below throws
    // before we await exitPromise (the await still sees the rejection).
    exitPromise.catch(() => {});

    let lastThreadId: string | undefined = threadId;

    // Normalize one parsed wire event: capture the thread id from ANY event
    // that carries it (resume needs it on the next turn), record
    // error/usage state, and return the CodexStreamEvent to yield (or null).
    const handleEvent = (ev: CodexEvent): CodexStreamEvent | null => {
      if (
        (ev.type === 'session_configured' || ev.type === 'thread.started')
        && (ev.session_id || ev.thread_id)
      ) {
        // LEGACY: session_configured.session_id/.thread_id
        // CURRENT: thread.started.thread_id
        lastThreadId = ev.session_id ?? ev.thread_id;
        return null;
      }
      if (ev.type === 'agent_message' && ev.message) {
        // LEGACY: top-level agent_message.message — whole message, no delta
        // accumulation needed.
        const stripped = ev.message.replace(TOOL_CALL_RE, '').trim();
        return { kind: 'assistant', rawText: ev.message, text: stripped || undefined, threadId: lastThreadId };
      }
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) {
        // CURRENT: item.completed with item.type === 'agent_message' — same
        // whole-message shape as legacy, different envelope.
        const stripped = ev.item.text.replace(TOOL_CALL_RE, '').trim();
        return { kind: 'assistant', rawText: ev.item.text, text: stripped || undefined, threadId: lastThreadId };
      }
      if (ev.type === 'item.started' && ev.item?.type === 'command_execution') {
        // CURRENT: liveness for codex's own shell tool calls — mirrors
        // agy's 'tool' step_type forwarding (header's "Streaming / liveness"
        // note). Only item.started fires this (not item.completed too) to
        // avoid a duplicate liveness ping per command.
        return { kind: 'tool', toolName: (ev.item.command ?? 'shell').slice(0, 200), threadId: lastThreadId };
      }
      if (ev.type === 'token_count' && ev.info?.last_token_usage) {
        // LEGACY: last_token_usage is per-TURN; total_token_usage is
        // cumulative for the whole session — using the latter here would
        // over-report on every turn after the first.
        outcome.inputTokens = ev.info.last_token_usage.input_tokens ?? 0;
        outcome.outputTokens = ev.info.last_token_usage.output_tokens ?? 0;
        return null;
      }
      if (ev.type === 'turn.completed' && ev.usage) {
        // CURRENT: turn.completed.usage — observed to stay roughly flat
        // across resumed turns rather than accumulate, i.e. per-turn like
        // legacy's last_token_usage (see file header).
        outcome.inputTokens = ev.usage.input_tokens ?? 0;
        outcome.outputTokens = ev.usage.output_tokens ?? 0;
        return null;
      }
      if (ev.type === 'task_complete') {
        // LEGACY only — CURRENT has no observed equivalent completion event
        // carrying an error; see file header on error handling.
        if (ev.error) outcome.error = ev.error.message;
        // last_agent_message is a convenience summary already covered by the
        // agent_message events collected above — not surfaced again here to
        // avoid duplicating the same text.
        return null;
      }
      if (ev.type === 'error' && ev.message) {
        outcome.error = ev.message;
        return null;
      }
      return null;
    };

    try {
      // Immediate liveness yield: session.ts races the FIRST pull against a
      // 4-minute silent-stream watchdog, and codex's first event can itself
      // take minutes (long thinking chains, large file reads). Yielding at
      // spawn wins that race deterministically instead of depending on
      // codex's latency.
      yield { kind: 'tool', toolName: 'turn started', threadId };

      let buf = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('{')) continue;
          let ev: CodexEvent;
          try { ev = JSON.parse(trimmed) as CodexEvent; } catch { continue; }
          const out = handleEvent(ev);
          if (out) yield out;
        }
      }
      const tail = buf.trim();
      if (tail && tail.startsWith('{')) {
        try {
          const out = handleEvent(JSON.parse(tail) as CodexEvent);
          if (out) yield out;
        } catch { /* not JSON, skip */ }
      }
    } finally {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      // If the consumer abandons this stream mid-turn (session.ts's silent
      // abort calls iterator.return(), the mailbox closes, or an error is
      // thrown downstream), don't leak the CLI subprocess.
      if (child.exitCode === null && !child.killed) {
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }
    }

    const exitCode = await exitPromise;
    outcome.threadId = lastThreadId;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
  }
}

/** Build the actionable error for a failed codex turn. */
function turnError(outcome: TurnOutcome, round: number, bin: string): Error {
  if (outcome.timedOut) {
    return new Error(
      `CodexAgentRunner: codex turn (tool round ${round}) exceeded the ${Math.round(TURN_TIMEOUT_MS / 60000)}min ` +
      `turn timeout and was killed.${outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  // Fatal provider errors (auth/permission/quota — classified from the error
  // field AND stderr): report what actually happened, and tag the error so
  // the daemon does NOT restart into the same guaranteed failure (a restart
  // on quota exhaustion can only hang or fail again).
  const cls = classifyStderr(`${outcome.error ?? ''}\n${outcome.stderrTail}`);
  if (cls.fatal) {
    const err = new Error(
      `CodexAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
      (outcome.error ? ` error: ${outcome.error}` : '') +
      (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `CodexAgentRunner: codex exec failed (exit ${outcome.exitCode})` +
    (outcome.error ? `: ${outcome.error}` : '') +
    (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
