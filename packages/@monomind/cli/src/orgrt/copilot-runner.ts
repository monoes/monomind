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
 *     guessing wrong and emitting garbage. UPDATE (#181, byte-verified
 *     against copilot 1.0.83): the REAL shape nests the payload one level
 *     down — `{"type":"assistant.message","data":{"content":"...", ...}}` —
 *     which none of the guessed shapes above matched, so this runner
 *     previously extracted NO assistant text at all. handleLine now reads
 *     `data.content`/`data.text` first; the guessed shapes are kept as
 *     fallbacks rather than removed (they cost nothing and other copilot
 *     versions may differ).
 *   - Session/resume: Copilot documents a `--resume=<id>` flag, but nothing
 *     in this runner's output parsing surfaces a session id to pass back in
 *     (the same gap the cross-check source above notes about its own
 *     integration), so resume can't be wired up yet — every mailbox prompt
 *     is a fresh `copilot -p` invocation, same disclosed limitation as
 *     CrushAgentRunner. Revisit if a session-id-bearing event/field is found.
 *   - Token usage (#181) — RESOLVED, byte-verified against copilot 1.0.83 on
 *     2026-09-18. Copilot CLI has a first-class `--usage-output-file <file>`
 *     flag ("Write final usage statistics as JSON to the specified file").
 *     This runner passes a per-turn temp path and reads it back after the
 *     subprocess exits (see parseCopilotUsage). Captured shape:
 *       { "modelMetrics": { "<model>": { "usage": {
 *           "inputTokens": 30522, "outputTokens": 47,
 *           "cacheReadTokens": 15224, "cacheWriteTokens": 15292,
 *           "reasoningTokens": 9 } } }, ... }
 *     `inputTokens` is TOTAL prompt tokens for the whole invocation (the
 *     identity inputTokens === tokenDetails.input + cache_read + cache_write
 *     held exactly on both samples) and the counts are cumulative across
 *     every model call, not last-call-only. Deliberately NOT reported,
 *     because copilot does not report them: `cost_usd` (copilot meters in AI
 *     credits / premium requests, and the credit→USD rate is plan-dependent
 *     — inventing one would poison policy.overBudgetUsd) and
 *     `reasoningTokens` (present, but nothing states whether outputTokens
 *     already includes it, so adding it risks double-counting).
 *     Rejected alternatives, both inspected: stdout's final `result` event
 *     has no token counts and its `session.usage_checkpoint` events carry
 *     prompt/cache but no output tokens; the OTel file export
 *     (`COPILOT_OTEL_FILE_EXPORTER_PATH`) would work but needs a histogram
 *     parser for what this flag hands over as plain JSON. Older copilot
 *     builds reject the flag at argv-parse time (before any spend) —
 *     turnError makes that an explicit "update copilot" failure rather than
 *     falling back to 0, which is the silent free lunch this issue is about.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentMessage,
  type AgentRunArgs,
  type AgentRunner,
  killOnAbort,
} from './agent-runner.js';
import { maskedCommand } from './authority-mask.js';
import { classifyStderr } from './kimicode-runner.js';
import { omitAnthropicManagedKeys } from './provider.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
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
  /** The real 1.0.83 envelope: every event's payload lives here. */
  data?: { content?: unknown; text?: string };
  content?: unknown;
  text?: string;
  message?: { content?: unknown; text?: string };
}

/** Token counts for ONE `copilot -p` invocation, read back from the JSON
 *  copilot writes to `--usage-output-file`. */
export interface CopilotUsage {
  /** Total prompt tokens (fresh + cache read + cache write). */
  inputTokens: number;
  outputTokens: number;
}

/**
 * Sum the per-model token counts out of a `--usage-output-file` payload.
 * Returns undefined — never a zeroed object — when the file has no model
 * metrics to read, so a caller can tell "copilot made no model call" (the
 * file is still written, with `modelMetrics: {}`) apart from a number it
 * actually measured. Summing across models covers a session that switched
 * model mid-run. Exported for unit testing against the captured fixture in
 * copilot-runner.test.ts.
 */
export function parseCopilotUsage(raw: string): CopilotUsage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const metrics = (parsed as { modelMetrics?: unknown } | null)?.modelMetrics;
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawAny = false;
  for (const entry of Object.values(metrics as Record<string, unknown>)) {
    const usage = (entry as { usage?: Record<string, unknown> } | null)?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const i = Number(usage.inputTokens);
    const o = Number(usage.outputTokens);
    if (!Number.isFinite(i) || !Number.isFinite(o)) continue;
    inputTokens += i;
    outputTokens += o;
    sawAny = true;
  }
  return sawAny ? { inputTokens, outputTokens } : undefined;
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
    // `data.content` first — that is the real 1.0.83 shape (#181); the rest
    // are the previously-guessed shapes, kept as fallbacks.
    const text =
      coerceText(ev.data?.content) ??
      ev.data?.text ??
      coerceText(ev.content) ??
      ev.text ??
      coerceText(ev.message?.content) ??
      ev.message?.text;
    if (!text) return null;
    return {
      kind: 'assistant',
      rawText: text,
      text: text.replace(TOOL_CALL_RE, '').trim() || undefined,
    };
  }
  if (ev.role === 'assistant') {
    const text = coerceText(ev.content) ?? ev.text;
    if (!text) return null;
    return {
      kind: 'assistant',
      rawText: text,
      text: text.replace(TOOL_CALL_RE, '').trim() || undefined,
    };
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
  /** This invocation's real token usage (#181), or undefined when copilot
   *  made no model call at all. */
  usage?: CopilotUsage;
}

export class CopilotAgentRunner implements AgentRunner {
  constructor(private copilotBin?: string) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.copilotBin || process.env.COPILOT_CLI_BIN || 'copilot';

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;
        // #181: every tool-fence round is its own `copilot -p` invocation with
        // its own usage file, so the counts reported on this prompt's single
        // 'result' message must be the sum over all of them.
        let promptInputTokens = 0;
        let promptOutputTokens = 0;

        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            hangSuspected: false,
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

          if (outcome.usage) {
            promptInputTokens += outcome.usage.inputTokens;
            promptOutputTokens += outcome.usage.outputTokens;
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
            yield {
              type: 'result',
              subtype: 'success',
              input_tokens: promptInputTokens,
              output_tokens: promptOutputTokens,
            };
            break;
          }

          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', text: note };
          if (!results) {
            yield {
              type: 'result',
              subtype: 'success',
              input_tokens: promptInputTokens,
              output_tokens: promptOutputTokens,
            };
            break;
          }
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
    // #181: copilot writes this invocation's real token counts here on exit.
    // Per-turn unique path so concurrent roles can't clobber each other's.
    const usageFile = join(tmpdir(), `monomind-copilot-usage-${randomUUID()}.json`);
    const cliArgs: string[] = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '-s',
      '--allow-all-tools',
      '--no-ask-user',
      '--usage-output-file',
      usageFile,
    ];
    if (args.model) cliArgs.push(`--model=${args.model}`);
    cliArgs.push('--add-dir', args.cwd);

    const child = spawn(...maskedCommand(args.authorityMask, bin, cliArgs), {
      cwd: args.cwd,
      // o-18: ambient ANTHROPIC_* creds never belong to a non-Anthropic
      // vendor CLI; an explicit value in args.env still wins below.
      env: { ...omitAnthropicManagedKeys(process.env), ...args.env },
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
    // SIGTERM→SIGKILL escalation, shared by the turn timeout, the startup
    // hang check, the abort signal, and the abandoned-stream path in
    // `finally` — a CLI that ignores SIGTERM must not leak a zombie per turn.
    const KILL_GRACE_MS = 5000;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const killChild = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, TURN_TIMEOUT_MS);

    // See STARTUP_GRACE_MS — disarmed by the first stdout chunk below.
    let sawOutput = false;
    let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      hangSuspected = true;
      killChild();
    }, STARTUP_GRACE_MS);
    // Abort hook (see AgentRunArgs.signal): kill the child so the stdout
    // loop below unblocks instead of orphaning it on iterator.return().
    const unsubscribeAbort = killOnAbort(args.signal, child, KILL_GRACE_MS);

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

    let stdoutDrained = false;
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
      stdoutDrained = true;
    } finally {
      // #181: on the normal path the usage file is read and removed after
      // the exit-code await below. If the consumer abandoned this stream
      // mid-turn (iterator.return()), nothing past this block runs — drop
      // the temp file here so it can't leak.
      if (!stdoutDrained) rmSync(usageFile, { force: true });
      clearTimeout(timer);
      if (hangTimer) clearTimeout(hangTimer);
      unsubscribeAbort();
      if (child.exitCode === null && child.signalCode === null) {
        // NOT confirmed dead. Either the consumer abandoned this stream
        // mid-turn (session.ts's silent abort calls iterator.return(), the
        // mailbox closes, or an error is thrown downstream) — kill it, WITH
        // the SIGKILL escalation — or a SIGTERM from the timeout/hang/abort
        // is still inside its grace period: leave that escalation armed,
        // since clearing it here would orphan a CLI that ignores SIGTERM and
        // then wait on `exitPromise` forever (same fix as codex/kimi/pi-rpc).
        if (!child.killed) killChild();
      } else if (killTimer) {
        clearTimeout(killTimer);
      }
    }

    const exitCode = await exitPromise;
    if (killTimer) clearTimeout(killTimer);
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
    outcome.hangSuspected = hangSuspected;
    // #181: copilot writes the usage file as it shuts down, so read it only
    // now that the process has actually exited. A missing/unreadable file
    // leaves outcome.usage undefined — the caller adds nothing rather than
    // adding a fabricated 0.
    try {
      outcome.usage = parseCopilotUsage(readFileSync(usageFile, 'utf8'));
    } catch {
      /* copilot wrote no usage file for this turn */
    } finally {
      rmSync(usageFile, { force: true });
    }
  }
}

/** Build the actionable error for a failed copilot turn (hangSuspected is
 *  handled separately by the caller — it has its own, more specific message). */
function turnError(outcome: TurnOutcome): Error {
  // #181: a copilot build predating `--usage-output-file` rejects it at
  // argv-parse time, before any model call — so nothing was spent and the
  // fix is a one-liner for the operator. Say so instead of letting the
  // generic "exit 1" message bury it, and do NOT silently retry without the
  // flag: a copilot role that reports 0 tokens forever is precisely the
  // silently-disabled budget cap this failure mode exists to prevent.
  if (outcome.stderrTail.includes("unknown option '--usage-output-file'")) {
    return new Error(
      'CopilotAgentRunner: this copilot CLI is too old — it does not support ' +
        '--usage-output-file, which this runner requires to report real token usage ' +
        '(without it a copilot role would report 0 tokens and its budget cap would never ' +
        'engage). Run `copilot update` (or npm install -g @github/copilot) and retry.',
    );
  }
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
