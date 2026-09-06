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
 *   accumulated until process exit. Unlike codex/agy, grok's guessed wire
 *   shapes (see below) carry no distinct "tool execution" event of their
 *   own — org tools only ever arrive via the ```tool_call fence protocol —
 *   so there is nothing else to forward as tool_use liveness besides the
 *   spawn-time yield. Fatal provider errors (auth/quota) are classified via
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
 *   - Invocation: `grok -p "<prompt>" --output-format json [--model X] [--cwd Y]
 *                 [--always-approve] [-r <sessionId> | -c]`
 *   - Session continuity: `-r/--resume [<id>]` resumes a specific session,
 *     `-c/--continue` resumes the most recent one. Session id is captured
 *     from any event carrying `session_id` / `sessionId` / `thread_id`.
 *   - stderr is human diagnostics; buffered and surfaced on non-zero exit.
 */
import { spawn } from 'node:child_process';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { classifyStderr } from './kimicode-runner.js';
import {
  buildToolProtocol,
  executeToolCall,
  formatToolResults,
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  TOOL_CALL_RE,
} from './tool-fence.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching the other subprocess runners
/** Distinct from TURN_TIMEOUT_MS: catches a hung first-run interactive prompt
 *  (trust/telemetry gate) fast instead of waiting out the full turn timeout.
 *  Fires only if the process has produced ZERO stdout by this point — any
 *  output at all disarms it, since a slow model response is not a hang. */
const STARTUP_GRACE_MS = 45_000;

interface TurnOutcome {
  sessionId?: string;
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  /** True when the process was killed by STARTUP_GRACE_MS with no output —
   *  likely stuck on a first-run interactive prompt headless mode can't answer. */
  hangSuspected: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

/** Pull a session/thread id out of a parsed event, tolerating the field-name
 *  variants different CLI versions/backends tend to use. */
function extractSessionId(ev: Record<string, unknown>): string | undefined {
  for (const key of ['session_id', 'sessionId', 'thread_id', 'threadId']) {
    const v = ev[key];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** Pull assistant-visible text out of a parsed event, tolerating the shape
 *  variants documented (or plausible) for `grok --output-format json`:
 *    - codex-style: { type: 'item.completed', item: { type: 'agent_message', text } }
 *    - flat role shape: { role: 'assistant', content: '...' | [{type:'text',text}] }
 *    - flat type shape: { type: 'assistant' | 'message', text: '...' } */
function extractText(ev: Record<string, unknown>): string | undefined {
  const item = ev.item as Record<string, unknown> | undefined;
  if (
    item &&
    (item.type === 'agent_message' || item.type === 'message') &&
    typeof item.text === 'string'
  ) {
    return item.text;
  }
  if (ev.role === 'assistant') {
    const content = ev.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (b): b is { type: string; text: string } =>
            !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text',
        )
        .map((b) => b.text)
        .join('\n');
    }
  }
  if ((ev.type === 'assistant' || ev.type === 'message') && typeof ev.text === 'string') {
    return ev.text;
  }
  return undefined;
}

/** Pull usage totals out of a parsed event, tolerating openai-ish
 *  (prompt_tokens/completion_tokens) and codex-ish (input_tokens/output_tokens)
 *  field names. */
function extractUsage(ev: Record<string, unknown>): { input: number; output: number } | undefined {
  const usage = ev.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  if (typeof input === 'number' || typeof output === 'number') {
    return {
      input: typeof input === 'number' ? input : 0,
      output: typeof output === 'number' ? output : 0,
    };
  }
  return undefined;
}

/** Pull a fatal error message out of a parsed event, tolerating an
 *  `error`/`turn.failed` event with either a nested `error.message` or a
 *  flat `message` field. */
function extractError(ev: Record<string, unknown>): string | undefined {
  if (ev.type !== 'error' && ev.type !== 'turn.failed') return undefined;
  const errMsg = (ev.error as Record<string, unknown> | undefined)?.message ?? ev.message;
  return typeof errMsg === 'string' ? errMsg : undefined;
}

/** Pure NDJSON parser — exported so it can be unit tested against fixture
 *  lines without spawning the real CLI (see grok-runner.test.ts). The
 *  streaming path below (GrokAgentRunner.streamTurn) parses one line at a
 *  time via the same extract* helpers, so both share the shape-tolerance
 *  logic. */
export function parseGrokEvents(lines: string[]): {
  texts: string[];
  rawTexts: string[];
  sessionId?: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
} {
  const rawTexts: string[] = [];
  let sessionId: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed?.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const sid = extractSessionId(ev);
    if (sid) sessionId = sid;

    const text = extractText(ev);
    if (text) rawTexts.push(text);

    const usage = extractUsage(ev);
    if (usage) {
      inputTokens = usage.input;
      outputTokens = usage.output;
    }

    const errMsg = extractError(ev);
    if (errMsg) error = errMsg;
  }

  const texts = rawTexts.map((t) => t.replace(TOOL_CALL_RE, '').trim());
  return { texts, rawTexts, sessionId, inputTokens, outputTokens, error };
}

/**
 * One parsed grok event, normalized for incremental streaming.
 *   - 'assistant': rawText is one whole assistant text (fences intact) for
 *     end-of-turn tool-call parsing; text is the fence-stripped prose,
 *     present only when non-empty.
 *   - 'tool':      liveness only — the spawn-time yield (see header: grok's
 *     guessed wire shapes carry no distinct tool-execution event to forward).
 */
export interface GrokStreamEvent {
  kind: 'assistant' | 'tool';
  text?: string;
  rawText?: string;
  toolName?: string;
  sessionId?: string;
}

export class GrokAgentRunner implements AgentRunner {
  constructor(private grokBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.grokBin || process.env.GROK_CLI_BIN || 'grok';
    let sessionId: string | undefined = args.resume;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
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

          for await (const ev of this.streamTurn(bin, promptWithSystem, sessionId, args, outcome)) {
            if (ev.sessionId) sessionId = ev.sessionId;
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per parsed line, not
              // after process exit): a grok turn can run many minutes, and
              // session.ts's watchdog must see messages DURING the turn.
              if (ev.text) yield { type: 'assistant', session_id: sessionId, text: ev.text };
            } else if (ev.kind === 'tool') {
              // Liveness only (see header) — session.ts never renders
              // tool_use as chat, it only feeds the StateDetector
              // ('tool-call' state) and refreshes last-activity.
              yield { type: 'tool_use', session_id: sessionId, text: ev.toolName };
            }
          }
          if (outcome.sessionId) sessionId = outcome.sessionId;

          if (outcome.hangSuspected || outcome.exitCode !== 0 || outcome.error) {
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

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant',
              session_id: sessionId,
              text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)`,
            };
            break;
          }

          const results: string[] = [];
          for (const call of calls)
            results.push(await executeToolCall(args.tools, call, args.canUseTool));
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
          'GrokAgentRunner requires the Grok Build CLI (grok) on PATH. ' +
            'Install it per https://docs.x.ai/build/cli, then log in. ' +
            'Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }

  /**
   * Run one `grok` invocation and stream its NDJSON output INCREMENTALLY:
   * each parsed event is yielded as soon as its line arrives on stdout (see
   * the header's "Streaming / liveness" note for why buffering until process
   * exit was a bug, #204). End-of-turn facts (exit code, stderr tail,
   * session id, usage, error, timeout/hang flags) are written into
   * `outcome`, which the caller reads after this generator completes.
   */
  private async *streamTurn(
    bin: string,
    prompt: string,
    sessionId: string | undefined,
    args: AgentRunArgs,
    outcome: TurnOutcome,
  ): AsyncGenerator<GrokStreamEvent> {
    // --output-format, not --format: confirmed against a live v1.0.5
    // install (`npm install -g @xai-official/grok`) — `--format` doesn't
    // exist ("unexpected argument '--format' found") and would have made
    // every single invocation fail before even reaching auth. Confirmed
    // the corrected flag is right: with it, the same invocation (no
    // XAI_API_KEY available to test past this point) gets to a "Not
    // signed in" auth error instead of a flag-parsing error, proving the
    // flag itself is now accepted. See #178.
    const cliArgs: string[] = ['-p', prompt, '--output-format', 'json', '--always-approve'];
    if (args.model) cliArgs.push('--model', args.model);
    cliArgs.push('--cwd', args.cwd);
    if (sessionId) cliArgs.push('--resume', sessionId);

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
    let hangSuspected = false;
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A wedged CLI that ignores SIGTERM must not leak a zombie per turn:
      // escalate to SIGKILL after a short grace period.
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    }, TURN_TIMEOUT_MS);

    // See STARTUP_GRACE_MS — disarmed by the first stdout chunk below.
    let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      hangSuspected = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    }, STARTUP_GRACE_MS);

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

    let lastSessionId: string | undefined = sessionId;

    // Normalize one parsed wire event: capture the session id from ANY event
    // that carries it (resume needs it on the next turn), record
    // error/usage state, and return the GrokStreamEvent to yield (or null).
    // Reuses the same shape-tolerant helpers as the batch parseGrokEvents.
    const handleEvent = (ev: Record<string, unknown>): GrokStreamEvent | null => {
      const sid = extractSessionId(ev);
      if (sid) lastSessionId = sid;

      const usage = extractUsage(ev);
      if (usage) {
        outcome.inputTokens = usage.input;
        outcome.outputTokens = usage.output;
      }

      const errMsg = extractError(ev);
      if (errMsg) outcome.error = errMsg;

      const text = extractText(ev);
      if (text) {
        const stripped = text.replace(TOOL_CALL_RE, '').trim();
        return {
          kind: 'assistant',
          rawText: text,
          text: stripped || undefined,
          sessionId: lastSessionId,
        };
      }
      return null;
    };

    try {
      // Immediate liveness yield: session.ts races the FIRST pull against a
      // 4-minute silent-stream watchdog, and grok's first event can itself
      // take minutes. Yielding at spawn wins that race deterministically
      // instead of depending on grok's latency.
      yield { kind: 'tool', toolName: 'turn started', sessionId };

      let sawOutput = false;
      let buf = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        if (!sawOutput) {
          sawOutput = true;
          if (hangTimer) {
            clearTimeout(hangTimer);
            hangTimer = undefined;
          }
        }
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed?.startsWith('{')) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(trimmed);
          } catch {
            continue;
          }
          const out = handleEvent(ev);
          if (out) yield out;
        }
      }
      const tail = buf.trim();
      if (tail?.startsWith('{')) {
        try {
          const out = handleEvent(JSON.parse(tail) as Record<string, unknown>);
          if (out) yield out;
        } catch {
          /* not JSON, skip */
        }
      }
    } finally {
      clearTimeout(timer);
      if (hangTimer) clearTimeout(hangTimer);
      if (killTimer) clearTimeout(killTimer);
      // If the consumer abandons this stream mid-turn (session.ts's silent
      // abort calls iterator.return(), the mailbox closes, or an error is
      // thrown downstream), don't leak the CLI subprocess.
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }

    const exitCode = await exitPromise;
    outcome.sessionId = lastSessionId;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
    outcome.hangSuspected = hangSuspected;
  }
}

/** Build the actionable error for a failed grok turn. */
function turnError(outcome: TurnOutcome, round: number): Error {
  if (outcome.hangSuspected) {
    return new Error(
      `GrokAgentRunner: grok produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
        'This usually means it is stuck on a first-run interactive prompt (trust/telemetry gate) ' +
        'that headless mode has no way to answer. Run `grok` once manually in a real terminal in ' +
        `this project to accept any prompts, then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  // Fatal provider errors (auth/permission/quota — classified from the error
  // field AND stderr): report what actually happened, and tag the error so
  // the daemon does NOT restart into the same guaranteed failure (a restart
  // on quota exhaustion can only hang or fail again).
  const cls = classifyStderr(`${outcome.error ?? ''}\n${outcome.stderrTail}`);
  if (cls.fatal) {
    const err = new Error(
      `GrokAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.error ? ` error: ${outcome.error}` : '') +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `GrokAgentRunner: grok failed (exit ${outcome.exitCode})` +
      (outcome.timedOut
        ? ` — killed after exceeding the ${TURN_TIMEOUT_MS / 3_600_000}h turn timeout`
        : '') +
      (outcome.error ? `: ${outcome.error}` : '') +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
