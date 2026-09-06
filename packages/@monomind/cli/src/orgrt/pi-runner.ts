// packages/@monomind/cli/src/orgrt/pi-runner.ts
/**
 * PiAgentRunner — AgentRunner impl backed by the Pi coding agent CLI
 * (`pi`, https://github.com/badlogic/pi-mono, package @mariozechner/pi-coding-agent).
 *
 * Architectural pattern: SAME as the other subprocess runners — spawn the
 * CLI, parse its output, normalize to AgentMessage.
 *
 * Auth: pi's own provider login (per-provider API key or subscription,
 * configured via `pi` itself). No env vars set here.
 *
 * Streaming / liveness — WHY INCREMENTAL (#204):
 *   This runner originally buffered ALL of pi's stdout until the subprocess
 *   exited, then parsed the whole batch. session.ts races the FIRST pull
 *   from this runner against a 4-minute silent-stream watchdog
 *   (SILENT_SESSION_MS), so any turn longer than 4 minutes yielded zero
 *   messages in time — abort, retry, kill, circuit breaker, stalled org.
 *   Same bug class the kimi/antigravity/codex runners had (#204 audit,
 *   fixed for codex in the commit this one mirrors). This runner now parses
 *   stdout LINE BY LINE as data arrives: a liveness `tool_use` message is
 *   yielded the moment the subprocess spawns (deterministically winning the
 *   first-pull race regardless of model-thinking latency), assistant text is
 *   yielded as each `message_end` event lands (pi sends whole messages, not
 *   per-token deltas — no accumulation needed, unlike agy), and pi's own
 *   `tool_execution_start` events are forwarded as `tool_use` liveness
 *   messages at their start boundary. Tool_call fences are still collected
 *   from the raw texts and parsed at end of turn (fence parsing needs the
 *   complete text). Fatal provider errors (auth/quota) are classified via
 *   the shared classifyStderr helper and tagged non-retryable, same as
 *   kimi/antigravity/codex.
 *
 * Subprocess protocol — byte-verified against a running `pi` 0.73.1 binary
 * (2026-08-25, see doc/agent-exec-protocol testing).
 *   - Invocation: `pi --mode json --session-dir <dir> "<prompt>"`. The
 *     prompt is POSITIONAL (matching pi's own interactive-mode CLI shape and
 *     the same convention codex uses) — an earlier revision of this runner
 *     passed it via a `-p` flag, which a second-source cross-check against
 *     another public agentic-CLI wrapper's tool table indicated was wrong;
 *     corrected here. An even earlier revision also passed `--approve`
 *     (meant to accept the cwd as trusted so pi doesn't stop to ask) — that
 *     flag does not exist in 0.73.1's `--help` output at all and made every
 *     turn fail immediately with "Unknown option: --approve"; removed.
 *     `--mode json` alone was confirmed NOT to block on an interactive
 *     trust prompt, so no replacement flag is needed (pi has no single
 *     "yolo" flag; tool auto-approval for individual actions is a separate,
 *     not-yet-wired concern for this runner — org tool calls go through
 *     canUseTool regardless, since they use the tool-fence protocol, not
 *     pi's native tool surface).
 *     (`--session-dir` also gives turn-to-turn continuity: pi persists
 *     sessions in that directory and resumes the latest one by default —
 *     there is no confirmed explicit `--resume <id>` flag for headless use,
 *     so this runner points every turn at the SAME per-run session dir
 *     rather than tracking a session id, and disclaims true cross-process
 *     resume as best-effort).
 *   - Event types seen: `agent_start` (ignored), `message_update` (partial;
 *     carries a cumulative `usage` object — kept as running totals but
 *     superseded by `message_end`), `message_end` (final `content` array
 *     with `{type:'text', text}` / `{type:'toolCall', ...}` items — only
 *     `text` items are surfaced to the bus), `tool_execution_start` /
 *     `tool_execution_end` (org tool calls use the shared tool-fence
 *     protocol, not pi's native tool-call surface, but `tool_execution_start`
 *     is forwarded as `tool_use` liveness — see header note above — while
 *     `tool_execution_end` is still ignored to avoid a duplicate liveness
 *     ping per command).
 *   - Usage field names differ from the other CLIs: `usage.input` /
 *     `usage.output` (not `input_tokens`/`output_tokens`).
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
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

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Distinct from TURN_TIMEOUT_MS: catches a hung first-run interactive prompt
 *  fast instead of waiting out the full turn timeout. Any output at all
 *  disarms it. Per pi's own docs, `-p`/`--mode json`/`--mode rpc` do NOT show
 *  a trust prompt (see this file's --approve comment above), so this is a
 *  defensive backstop rather than a known risk the way it is for copilot. */
const STARTUP_GRACE_MS = 45_000;

interface PiContentBlock {
  type?: string;
  text?: string;
}
interface PiUsage {
  input?: number;
  output?: number;
}
interface PiEvent {
  type?: string;
  message?: { content?: PiContentBlock[]; usage?: PiUsage };
  usage?: PiUsage;
  toolName?: string;
}

/**
 * One parsed pi stdout line, normalized for incremental consumption.
 *   - assistantText: the raw (fences intact) text joined from a
 *     message_end event's text content blocks, present only when non-empty.
 *   - toolName: pi's own tool activity (a tool_execution_start event).
 *   - inputTokens/outputTokens: the latest usage figures carried by this
 *     line, if any (a message_end event can carry BOTH assistant text and
 *     usage at once, so this is a plain object rather than a tagged union).
 */
interface PiParsedLine {
  assistantText?: string;
  toolName?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Pure per-line parser — shared by parsePiEvents (batch, used by tests
 *  against fixture lines) and streamTurn (incremental, used at runtime). */
function parsePiLine(line: string): PiParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed?.startsWith('{')) return null;
  let ev: PiEvent;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const result: PiParsedLine = {};

  if (ev.type === 'message_end' && ev.message?.content) {
    const text = ev.message.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');
    if (text) result.assistantText = text;
  } else if (ev.type === 'tool_execution_start') {
    // Liveness for pi's own tool activity — only the start event fires
    // this (not tool_execution_end too) to avoid a duplicate liveness ping
    // per command, mirroring codex's item.started-only forwarding.
    result.toolName = typeof ev.toolName === 'string' ? ev.toolName : 'tool';
  }

  const usage = ev.message?.usage ?? ev.usage;
  if (usage && (typeof usage.input === 'number' || typeof usage.output === 'number')) {
    if (typeof usage.input === 'number') result.inputTokens = usage.input;
    if (typeof usage.output === 'number') result.outputTokens = usage.output;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** Pure JSON-event parser — exported for unit testing against fixture lines
 *  (pi-runner.test.ts). */
export function parsePiEvents(lines: string[]): {
  texts: string[];
  rawTexts: string[];
  inputTokens: number;
  outputTokens: number;
} {
  const rawTexts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const line of lines) {
    const parsed = parsePiLine(line);
    if (!parsed) continue;
    if (parsed.assistantText) rawTexts.push(parsed.assistantText);
    if (typeof parsed.inputTokens === 'number') inputTokens = parsed.inputTokens;
    if (typeof parsed.outputTokens === 'number') outputTokens = parsed.outputTokens;
  }

  const texts = rawTexts.map((t) => t.replace(TOOL_CALL_RE, '').trim());
  return { texts, rawTexts, inputTokens, outputTokens };
}

/**
 * One parsed pi stream event, normalized for incremental streaming.
 *   - 'assistant': rawText is one whole message_end text (fences intact) for
 *     end-of-turn tool-call parsing; text is the fence-stripped prose,
 *     present only when non-empty.
 *   - 'tool':      pi's own tool activity (tool_execution_start), or the
 *     spawn-time liveness yield — forwarded by run() as a `tool_use`
 *     liveness AgentMessage (see header).
 */
export interface PiStreamEvent {
  kind: 'assistant' | 'tool';
  text?: string;
  rawText?: string;
  toolName?: string;
}

interface TurnOutcome {
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  /** True when the process was killed by STARTUP_GRACE_MS with no output —
   *  likely stuck on a first-run interactive prompt headless mode can't answer. */
  hangSuspected: boolean;
  inputTokens: number;
  outputTokens: number;
}

export class PiAgentRunner implements AgentRunner {
  constructor(private piBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.piBin || process.env.PI_CLI_BIN || 'pi';
    // Stable per-run session directory — see file header on why this
    // substitutes for an explicit resume-by-id flag.
    const sessionDir = join(args.cwd, '.monomind-pi-session');

    try {
      let first = true;
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = first
          ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`
          : text;
        first = false;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
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

          for await (const ev of this.streamTurn(bin, nextPrompt, sessionDir, args, outcome)) {
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per message_end event,
              // not after process exit): a pi turn can run many minutes, and
              // session.ts's watchdog must see messages DURING the turn.
              // Note this means partial output may already be yielded when a
              // turn later exits non-zero — preferable to losing it entirely.
              if (ev.text) yield { type: 'assistant', text: ev.text };
            } else if (ev.kind === 'tool') {
              // Liveness for pi's own tool activity (or the spawn-time
              // yield): session.ts never renders tool_use as chat — it only
              // feeds the StateDetector ('tool-call' state) and refreshes
              // last-activity.
              yield { type: 'tool_use', text: ev.toolName };
            }
          }

          if (outcome.hangSuspected) {
            throw new Error(
              `PiAgentRunner: pi produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
                "This usually means it is stuck on a prompt headless mode has no way to answer — pi's own " +
                'docs say --mode json should not show a trust prompt, so this is unexpected. Run `pi` once ' +
                `manually in a real terminal in this project to check, then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          if (outcome.exitCode !== 0) {
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
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) break;

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant',
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
          subtype: 'success',
          input_tokens: turnInputTokens,
          output_tokens: turnOutputTokens,
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'PiAgentRunner requires the Pi coding agent CLI (pi) on PATH. ' +
            'Install it: npm install -g @mariozechner/pi-coding-agent, then configure a ' +
            'provider. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }

  /**
   * Run one `pi` invocation and stream its `--mode json` output
   * INCREMENTALLY: each parsed event is yielded as soon as its line arrives
   * on stdout (see the header's "Streaming / liveness" note for why
   * buffering until process exit was a bug, #204). End-of-turn facts (exit
   * code, stderr tail, usage, timeout/hang flags) are written into
   * `outcome`, which the caller reads after this generator completes.
   */
  private async *streamTurn(
    bin: string,
    prompt: string,
    sessionDir: string,
    args: AgentRunArgs,
    outcome: TurnOutcome,
  ): AsyncGenerator<PiStreamEvent> {
    // Prompt is positional (see file header) — always LAST so no later flag
    // is mistaken for part of it. NOTE ⓥ: `--approve` does not exist in the
    // installed pi CLI (0.73.1) — confirmed live via `pi --help`, which
    // lists no approve/trust/yolo flag at all; passing it made every turn
    // fail immediately with "Unknown option: --approve" before pi ever ran.
    // `--mode json` alone (no `--print`) was verified NOT to block on an
    // interactive trust prompt, matching this file's original assumption —
    // removing `--approve` was the only fix needed.
    const cliArgs: string[] = ['--mode', 'json', '--session-dir', sessionDir];
    if (args.model) cliArgs.push('--model', args.model);
    cliArgs.push(prompt);

    const child = spawn(bin, cliArgs, {
      cwd: args.cwd,
      // PI_TELEMETRY/PI_SKIP_VERSION_CHECK: confirmed via pi's own docs —
      // suppresses install/update telemetry and version-check network calls
      // that otherwise add latency/flakiness to every headless turn.
      env: { ...process.env, PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', ...args.env },
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
    // (ENOENT, bad binary) the 'error' event fires almost immediately —
    // if no listener is attached yet it escapes as an unhandled 'error'
    // event and crashes the process instead of reaching our catch block.
    const exitPromise = new Promise<number>((res, rej) => {
      child.on('error', rej);
      child.on('close', (code) => res(code ?? 1));
    });
    // Prevent an unhandled-rejection crash if the stdout loop below throws
    // before we await exitPromise (the await still sees the rejection).
    exitPromise.catch(() => {});

    // Emit one parsed line as a PiStreamEvent (if any) and fold its usage
    // figures into `outcome` as a side effect — shared by the main stdout
    // loop and the final partial-line flush below.
    function* emit(line: string): Generator<PiStreamEvent> {
      const parsed = parsePiLine(line);
      if (!parsed) return;
      if (typeof parsed.inputTokens === 'number') outcome.inputTokens = parsed.inputTokens;
      if (typeof parsed.outputTokens === 'number') outcome.outputTokens = parsed.outputTokens;
      if (parsed.assistantText) {
        const stripped = parsed.assistantText.replace(TOOL_CALL_RE, '').trim();
        yield { kind: 'assistant', rawText: parsed.assistantText, text: stripped || undefined };
      } else if (parsed.toolName) {
        yield { kind: 'tool', toolName: parsed.toolName };
      }
    }

    try {
      // Immediate liveness yield: session.ts races the FIRST pull against a
      // 4-minute silent-stream watchdog, and pi's first event can itself
      // take minutes (long thinking chains, large file reads). Yielding at
      // spawn wins that race deterministically instead of depending on
      // pi's latency.
      yield { kind: 'tool', toolName: 'turn started' };

      let buf = '';
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        if (hangTimer) {
          clearTimeout(hangTimer);
          hangTimer = undefined;
        }
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          yield* emit(line);
        }
      }
      if (buf.trim()) yield* emit(buf);
    } finally {
      clearTimeout(timer);
      if (hangTimer) clearTimeout(hangTimer);
      if (killTimer) clearTimeout(killTimer);
      // If the consumer abandons this stream mid-turn (session.ts's
      // silent-abort calls iterator.return(), the mailbox closes, or an
      // error is thrown downstream), don't leak the CLI subprocess.
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }

    const exitCode = await exitPromise;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
    outcome.hangSuspected = hangSuspected;
  }
}

/** Build the actionable error for a failed pi turn. */
function turnError(outcome: TurnOutcome, round: number): Error {
  if (outcome.timedOut) {
    return new Error(
      `PiAgentRunner: pi turn (tool round ${round}) exceeded the ${TURN_TIMEOUT_MS / 3_600_000}h turn timeout ` +
        `and was killed.${outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  // Fatal provider errors (auth/permission/quota — classified from stderr):
  // report what actually happened, and tag the error so the daemon does NOT
  // restart into the same guaranteed failure (a restart on quota exhaustion
  // can only hang or fail again).
  const cls = classifyStderr(outcome.stderrTail);
  if (cls.fatal) {
    const err = new Error(
      `PiAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `PiAgentRunner: pi failed (exit ${outcome.exitCode})` +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
