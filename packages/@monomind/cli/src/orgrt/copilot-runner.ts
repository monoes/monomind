// packages/@monomind/cli/src/orgrt/copilot-runner.ts
/**
 * CopilotAgentRunner — AgentRunner impl backed by the GitHub Copilot CLI
 * (`copilot`, https://docs.github.com/en/copilot/reference/copilot-cli-reference).
 *
 * Architectural pattern: SAME as the other subprocess runners — spawn the
 * CLI, parse its output, normalize to AgentMessage.
 *
 * Auth: GitHub's own device/browser login flow (`copilot` handles this
 * itself on first run). No env vars set here.
 *
 * Streaming / liveness — WHY INCREMENTAL (#204):
 *   This runner originally buffered ALL of copilot's stdout until the
 *   subprocess exited before parsing anything, so any turn longer than
 *   session.ts's 4-minute silent-stream watchdog (SILENT_SESSION_MS) yielded
 *   zero messages in time — abort, retry, kill, circuit breaker. Same bug
 *   class the kimi/antigravity/codex runners had (#204 audit). This runner
 *   now parses stdout LINE BY LINE as data arrives: a liveness `tool_use`
 *   message is yielded the moment the subprocess spawns (deterministically
 *   winning the watchdog's first-pull race regardless of copilot's latency),
 *   and each assistant-shaped NDJSON event is yielded as it lands rather
 *   than accumulated until process close. Any tool-activity-shaped event
 *   (see handleLine's `kind.startsWith('tool')` check) is forwarded as a
 *   `tool_use` liveness message too — a wrong guess there only costs a
 *   missed heartbeat, unlike assistant text, which still fails closed (no
 *   text extracted) on an unrecognized shape per the note below.
 *
 * Subprocess protocol — per public docs, NOT byte-verified against a running
 * binary:
 *   - Invocation: `copilot -p "<prompt>" --output-format json -s
 *                 --allow-all-tools --no-ask-user [--model=<model>]`. `-s`
 *     (silent) suppresses the stats/decoration footer that otherwise mixes
 *     into stdout (documented GitHub issue: without `-s`, response text can
 *     be absent from plain stdout entirely — `--output-format json` + `-s`
 *     is the documented workaround). `--no-ask-user` disables the CLI's
 *     ask_user tool so a headless run can never block waiting on a question
 *     with no human to answer it — confirmed by cross-checking a second,
 *     independent public agentic-CLI wrapper's provider table, which lists
 *     the identical `-s --allow-all-tools --no-ask-user` combination for
 *     Copilot's non-interactive mode; this runner was missing `--no-ask-user`
 *     until that cross-check.
 *   - Output: NDJSON; assistant text arrives on `assistant.message`-shaped
 *     events. The exact full field list isn't published, so handleLine
 *     tolerates a couple of plausible shapes (an explicit `type`/`kind` of
 *     'assistant.message' or 'assistant' carrying `content`/`text`) and
 *     fails closed (no text extracted) on anything else, rather than
 *     guessing wrong and emitting garbage.
 *   - Session/resume: Copilot documents a `--resume=<id>` flag, but nothing
 *     in this runner's output parsing surfaces a session id to pass back in
 *     (the same gap the cross-check source above notes about its own
 *     integration), so resume can't be wired up yet — every mailbox prompt
 *     is a fresh `copilot -p` invocation, same disclosed limitation as
 *     CrushAgentRunner. Revisit if a session-id-bearing event/field is found.
 *   - Token usage: NOT documented for `--output-format json`, and Copilot
 *     CLI has no documented custom-base-URL override (it talks to GitHub's
 *     own Copilot backend, not a passthrough-able OpenAI/Anthropic
 *     endpoint), so this runner does not attempt usage-proxy accounting —
 *     it always reports 0 tokens (issue #181, out of scope here). UPDATE
 *     (issue #181 research): Copilot CLI does expose token counts via
 *     OpenTelemetry file export (`COPILOT_OTEL_ENABLED=true`,
 *     `COPILOT_OTEL_EXPORTER_TYPE=file`, `COPILOT_OTEL_FILE_EXPORTER_PATH=<path>`,
 *     writing to `~/.copilot/otel/*.jsonl` by default), but this is opt-in
 *     (not emitted on `--output-format json` stdout) and no source with
 *     literal, quotable JSON field names for the OTel span schema was found —
 *     only prose descriptions ("chat spans ... cache read/creation ...
 *     reasoning output tokens"). Implementing a parser against a guessed
 *     schema risks the exact wrong-guess failure mode `pi-rpc-runner.ts`'s
 *     header warns against. Still needs a live `copilot` install with OTel
 *     file export enabled to capture a real JSONL sample before this can be
 *     wired up.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
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

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Distinct from TURN_TIMEOUT_MS: catches a hung first-run interactive prompt
 *  fast instead of waiting out the full turn timeout. Any output at all
 *  disarms it. Copilot CLI has a DOCUMENTED bug where its directory-trust
 *  and path-access prompts can hang indefinitely in CI/headless invocations
 *  with no way to answer them — this is the primary mitigation for copilot
 *  specifically, not just a defensive backstop. */
const STARTUP_GRACE_MS = 45_000;

interface CopilotEvent {
  type?: string;
  kind?: string;
  role?: string;
  content?: unknown;
  text?: string;
  message?: { content?: unknown; text?: string };
}

function coerceText(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text',
      )
      .map((b) => b.text)
      .join('\n');
  }
  return undefined;
}

/**
 * One parsed copilot NDJSON line, normalized for incremental streaming.
 *   - 'assistant': rawText is the event's whole text (fences intact) for
 *     end-of-turn tool-call parsing; text is the fence-stripped prose,
 *     present only when non-empty.
 *   - 'tool':      an event whose type/kind looks like tool activity —
 *     forwarded by run() as a `tool_use` liveness AgentMessage (see header).
 */
export interface CopilotStreamEvent {
  kind: 'assistant' | 'tool';
  text?: string;
  rawText?: string;
  toolName?: string;
}

/** Parse ONE NDJSON line into a normalized stream event (or null if it
 *  carries nothing to yield). Shared by the incremental streaming path and
 *  the batch parseCopilotEvents helper below (kept for unit testing against
 *  fixture lines — copilot-runner.test.ts). */
function handleLine(line: string): CopilotStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed?.startsWith('{')) return null;
  let ev: CopilotEvent;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const kind = ev.type ?? ev.kind;
  if (kind === 'assistant.message' || kind === 'assistant') {
    const text =
      coerceText(ev.content) ?? ev.text ?? coerceText(ev.message?.content) ?? ev.message?.text;
    if (!text) return null;
    return { kind: 'assistant', rawText: text, text: text.replace(TOOL_CALL_RE, '').trim() || undefined };
  }
  if (ev.role === 'assistant') {
    const text = coerceText(ev.content) ?? ev.text;
    if (!text) return null;
    return { kind: 'assistant', rawText: text, text: text.replace(TOOL_CALL_RE, '').trim() || undefined };
  }
  if (typeof kind === 'string' && kind.startsWith('tool')) {
    const label = coerceText(ev.content) ?? ev.text ?? kind;
    return { kind: 'tool', toolName: label.slice(0, 200) };
  }
  return null;
}

/** Pure NDJSON parser — exported for unit testing against fixture lines
 *  (copilot-runner.test.ts). */
export function parseCopilotEvents(lines: string[]): { texts: string[]; rawTexts: string[] } {
  const rawTexts: string[] = [];
  for (const line of lines) {
    const out = handleLine(line);
    if (out?.kind === 'assistant' && out.rawText !== undefined) rawTexts.push(out.rawText);
  }
  const texts = rawTexts.map((t) => t.replace(TOOL_CALL_RE, '').trim());
  return { texts, rawTexts };
}

interface TurnOutcome {
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  /** True when the process was killed by STARTUP_GRACE_MS with no output —
   *  likely stuck on copilot's documented directory-trust/path-access hang. */
  hangSuspected: boolean;
}

export class CopilotAgentRunner implements AgentRunner {
  constructor(private copilotBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.copilotBin || process.env.COPILOT_CLI_BIN || 'copilot';

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            exitCode: 1, stderrTail: '', timedOut: false, hangSuspected: false,
          };
          // Raw assistant texts (fences intact) for end-of-turn tool-call
          // parsing — fence parsing needs the complete text, so fences are
          // collected here while the stripped prose streams out live below.
          const rawTexts: string[] = [];

          for await (const ev of this.streamTurn(bin, nextPrompt, args, outcome)) {
            if (ev.kind === 'assistant' && ev.rawText !== undefined) {
              rawTexts.push(ev.rawText);
              // Yield assistant prose AS IT ARRIVES (per NDJSON line, not
              // after process exit): a copilot turn can run many minutes,
              // and session.ts's watchdog must see messages DURING the turn.
              if (ev.text) yield { type: 'assistant', text: ev.text };
            } else if (ev.kind === 'tool') {
              // Liveness for copilot's own tool activity (or the spawn-time
              // yield): session.ts never renders tool_use as chat — it only
              // feeds the StateDetector ('tool-call' state) and refreshes
              // last-activity.
              yield { type: 'tool_use', text: ev.toolName };
            }
          }

          if (outcome.hangSuspected) {
            throw new Error(
              `CopilotAgentRunner: copilot produced no output within ${STARTUP_GRACE_MS / 1000}s and was ` +
                'killed. This is a documented copilot CLI issue: its directory-trust/path-access prompts can ' +
                'hang indefinitely in headless invocations with no way to answer them. Run `copilot` once ' +
                'manually in a real terminal in this project to accept any prompts (and confirm --add-dir ' +
                `covers every path it needs), then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          if (outcome.exitCode !== 0) {
            throw turnError(outcome);
          }

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) {
            yield { type: 'result', subtype: 'success', input_tokens: 0, output_tokens: 0 };
            break;
          }

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant',
              text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)`,
            };
            yield { type: 'result', subtype: 'success', input_tokens: 0, output_tokens: 0 };
            break;
          }

          const results: string[] = [];
          for (const call of calls)
            results.push(await executeToolCall(args.tools, call, args.canUseTool));
          nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${formatToolResults(calls, results)}`;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'CopilotAgentRunner requires the GitHub Copilot CLI (copilot) on PATH. ' +
            'Install it: npm install -g @github/copilot, then run `copilot` once to ' +
            'authenticate. Or unset the runtime to use Claude.',
        );
      }
      throw err;
    }
  }

  /**
   * Run one `copilot` invocation and stream its NDJSON output
   * INCREMENTALLY: each parsed line is yielded as soon as it arrives on
   * stdout (see the header's "Streaming / liveness" note for why buffering
   * until process exit was a bug, #204). End-of-turn facts (exit code,
   * stderr tail, timeout/hang flags) are written into `outcome`, which the
   * caller reads after this generator completes.
   */
  private async *streamTurn(
    bin: string,
    prompt: string,
    args: AgentRunArgs,
    outcome: TurnOutcome,
  ): AsyncGenerator<CopilotStreamEvent> {
    const cliArgs: string[] = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '-s',
      '--allow-all-tools',
      '--no-ask-user',
    ];
    if (args.model) cliArgs.push(`--model=${args.model}`);
    cliArgs.push('--add-dir', args.cwd);

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
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
      killTimer.unref?.();
    }, TURN_TIMEOUT_MS);

    // See STARTUP_GRACE_MS — disarmed by the first stdout chunk below.
    let sawOutput = false;
    let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      hangSuspected = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
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

    try {
      // Immediate liveness yield: session.ts races the FIRST pull from this
      // runner against a 4-minute silent-stream watchdog, and copilot's
      // first line can itself take minutes. Yielding at spawn wins that
      // race deterministically instead of depending on copilot's latency.
      yield { kind: 'tool', toolName: 'turn started' };

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
          const out = handleLine(line);
          if (out) yield out;
        }
      }
      if (buf.trim()) {
        const out = handleLine(buf);
        if (out) yield out;
      }
    } finally {
      clearTimeout(timer);
      if (hangTimer) clearTimeout(hangTimer);
      if (killTimer) clearTimeout(killTimer);
      // If the consumer abandons this stream mid-turn (session.ts's silent
      // abort calls iterator.return(), the mailbox closes, or an error is
      // thrown downstream), don't leak the CLI subprocess.
      if (child.exitCode === null && !child.killed) {
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }
    }

    const exitCode = await exitPromise;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
    outcome.hangSuspected = hangSuspected;
  }
}

/** Build the actionable error for a failed copilot turn (hangSuspected is
 *  handled separately by the caller — it has its own, more specific message). */
function turnError(outcome: TurnOutcome): Error {
  // Fatal provider errors (auth/permission/quota — classified from stderr):
  // report what actually happened, and tag the error so the daemon does NOT
  // restart into the same guaranteed failure (a restart on quota exhaustion
  // can only hang or fail again).
  const cls = classifyStderr(outcome.stderrTail);
  if (cls.fatal) {
    const err = new Error(
      `CopilotAgentRunner: FATAL provider error (${cls.label}) — not retrying.` +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `CopilotAgentRunner: copilot failed (exit ${outcome.exitCode})` +
      (outcome.timedOut
        ? ` — killed after exceeding the ${TURN_TIMEOUT_MS / 3_600_000}h turn timeout`
        : '') +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
