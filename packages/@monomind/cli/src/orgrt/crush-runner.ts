// packages/@monomind/cli/src/orgrt/crush-runner.ts
/**
 * CrushAgentRunner — AgentRunner impl backed by the Crush CLI
 * (`crush`, https://github.com/charmbracelet/crush).
 *
 * Architectural difference from the other subprocess runners: `crush run
 * "<prompt>"` (per its public CLI docs) is a plain one-shot invocation —
 * text response to stdout, no documented JSON output mode. On the FIRST turn
 * this runner sends the system prompt + tool protocol; subsequent turns add
 * `--continue` (resume the most-recently-used session — confirmed by
 * cross-checking a second, independent public agentic-CLI wrapper's provider
 * table, which lists `--session <id>` / `--continue` as crush's resume
 * mechanism) instead of re-sending the full system prompt, so conversational
 * context is NOT re-derived from scratch every turn the way the original
 * (pre-cross-check) revision of this runner did.
 *
 * RESOLVED against a live v0.89.0 install (issue #180): crush's session
 * store is a per-project SQLite DB at `<cwd>/.crush/crush.db` (created
 * fresh per working directory unless `--data-dir` is overridden), so `crush
 * session list` and `--continue`'s "most recently used session" are
 * inherently scoped PER CWD, not global. Verified concretely: seeded two
 * concurrent sessions from two different cwds with distinct secret words,
 * then ran `crush run --continue` in each cwd — each one correctly recalled
 * only its own secret, with zero cross-contamination. This runner never
 * passes `--data-dir`, so the safe-by-default behavior applies as long as
 * that stays true. The `--session <id>` capture-and-pass-explicitly
 * alternative is therefore unnecessary.
 *
 * Also caught and fixed while validating live: this runner used to pass
 * `--yolo` to `crush run`, which crush v0.89.0 REJECTS outright ("Unknown
 * flag: --yolo") — `--yolo`/`-y` is a root-only flag for the interactive
 * TUI and is not accepted by the `run` subcommand in any position. That
 * made every single invocation fail with a non-zero exit. Confirmed live
 * that it's also unnecessary: non-interactive `run` mode auto-approves tool
 * calls without it (a file-write tool call completed with zero prompting).
 *
 * Usage accounting — crush's plain-text output carries no token counts, so
 * this runner optionally routes crush's LLM traffic through a
 * UsageProxyServer (usage-proxy.ts) by setting a base-URL env var before
 * spawning and reading totals() after the turn. CONFIRMED BROKEN against a
 * live install: crush ignores `OPENAI_BASE_URL` entirely (pointed it at an
 * unreachable port with a real custom provider configured — crush still
 * reached the real upstream, proving the env var is never read). crush's
 * provider base_url is only configurable via a JSON config file
 * (`~/.config/crush/crush.json`, `providers.<id>.base_url`, confirmed
 * working live) — there is no runtime env-var override. `baseUrlEnvVar` as
 * currently implemented does nothing for crush; it fails closed (usage
 * stays at 0, turns aren't broken) but never actually collects usage. Real
 * fix: write/merge a temp provider entry into crush's JSON config (or a
 * `--data-dir`-scoped copy of it) pointed at the proxy before spawn, instead
 * of setting an env var — not implemented here, since that requires
 * deciding how to safely merge into a user's existing crush.json rather
 * than just confirming a fact.
 *
 * Streaming / liveness — WHY INCREMENTAL (#204):
 *   This runner originally buffered ALL of crush's stdout in a local
 *   variable until the subprocess closed, so any turn longer than
 *   session.ts's 4-minute silent-stream watchdog (SILENT_SESSION_MS)
 *   yielded zero messages in time — abort, retry, kill, circuit breaker.
 *   Same bug class the codex/kimi/antigravity runners had. Unlike those,
 *   crush's `run` subcommand has no documented JSON event stream — it's
 *   plain text, so there's no structured envelope to segment "messages" by.
 *   This runner now parses stdout LINE BY LINE as it arrives: a liveness
 *   `tool_use` message is yielded the moment the subprocess spawns
 *   (deterministically winning the first-pull race regardless of
 *   model-thinking latency), and every non-fence line is yielded as an
 *   `assistant` message as soon as it lands rather than after the process
 *   exits. Lines inside a ```tool_call fence are withheld from the visible
 *   stream (same as the old end-of-turn fence stripping) but still
 *   accumulated into the turn's raw text for end-of-turn fence parsing —
 *   fence parsing needs the complete, un-split fence body. The fence's
 *   OPENING line is forwarded as a `tool_use` liveness message (crush has no
 *   tool-execution events of its own to forward, so the org tool-call fence
 *   itself is the closest available "tool starting" boundary).
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn } from 'node:child_process';
import {
  type AgentMessage,
  type AgentRunArgs,
  type AgentRunner,
  killOnAbort,
} from './agent-runner.js';
import { classifyStderr } from './kimicode-runner.js';
import {
  buildToolProtocol,
  executeToolCall,
  formatToolResults,
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  TOOL_CALL_RE,
} from './tool-fence.js';
import { UsageProxyServer } from './usage-proxy.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Distinct from TURN_TIMEOUT_MS: catches a hung first-run interactive prompt
 *  (trust/telemetry gate) fast instead of waiting out the full turn timeout.
 *  Fires only if the process has produced ZERO stdout by this point — any
 *  output at all disarms it, since a slow model response is not a hang. */
const STARTUP_GRACE_MS = 45_000;

/** Strip tool_call fences and normalize whitespace on crush's plain-text
 *  stdout. Exported for unit testing (crush-runner.test.ts). */
export function parseCrushOutput(stdout: string): { text: string; rawText: string } {
  const rawText = stdout.trim();
  const text = rawText.replace(TOOL_CALL_RE, '').trim();
  return { text, rawText };
}

/**
 * One incremental chunk of a streamed crush turn.
 *   - 'assistant': one line of plain-text output, outside any tool_call
 *     fence — yielded by run() as an assistant AgentMessage as it lands.
 *   - 'tool': liveness — either the spawn-time "turn started" yield, or a
 *     ```tool_call fence's opening line (the closest thing crush's plain-text
 *     output has to a tool-execution start boundary).
 */
export interface CrushStreamEvent {
  kind: 'assistant' | 'tool';
  text?: string;
}

interface TurnOutcome {
  /** Full raw stdout (fences intact, trimmed) — used for end-of-turn fence
   *  parsing once the turn completes. */
  rawText: string;
  exitCode: number;
  stderrTail: string;
  timedOut: boolean;
  /** True when the process was killed by STARTUP_GRACE_MS with no output —
   *  likely stuck on a first-run interactive prompt headless mode can't answer. */
  hangSuspected: boolean;
}

export interface CrushAgentRunnerOptions {
  crushBin?: string;
  /** Enable usage-proxy accounting. Off by default since the base-URL env
   *  var it relies on is CONFIRMED not read by crush at all (see file
   *  header) — turning this on fails closed (usage stays 0) rather than
   *  breaking turns, but collects nothing until the JSON-config-based fix
   *  described in the file header is implemented. */
  usageProxy?: { upstreamBaseUrl: string; baseUrlEnvVar?: string };
}

export class CrushAgentRunner implements AgentRunner {
  private crushBin?: string;
  private usageProxyOpts?: { upstreamBaseUrl: string; baseUrlEnvVar: string };

  constructor(opts: CrushAgentRunnerOptions = {}) {
    this.crushBin = opts.crushBin;
    if (opts.usageProxy) {
      this.usageProxyOpts = {
        upstreamBaseUrl: opts.usageProxy.upstreamBaseUrl,
        baseUrlEnvVar: opts.usageProxy.baseUrlEnvVar ?? 'OPENAI_BASE_URL',
      };
    }
  }

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = this.crushBin || process.env.CRUSH_CLI_BIN || 'crush';

    let proxy: UsageProxyServer | undefined;
    if (this.usageProxyOpts) {
      proxy = new UsageProxyServer({
        upstreamBaseUrl: this.usageProxyOpts.upstreamBaseUrl,
        apiStyle: 'openai',
      });
      await proxy.start();
    }

    // Set once the first crush invocation completes — subsequent calls pass
    // --continue (resume the most-recently-used session) instead of
    // re-sending the full system prompt from scratch every turn.
    let sessionStarted = false;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = sessionStarted
          ? text
          : `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;

        // Reset ONCE per mailbox prompt, not per tool-call round — totals()
        // is read after the LAST round below, so resetting inside the round
        // loop was discarding every round's usage except the final one.
        proxy?.reset();

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          // Filled in by streamTurn as the subprocess runs and when it exits.
          const outcome: TurnOutcome = {
            rawText: '',
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            hangSuspected: false,
          };

          for await (const ev of this.streamTurn(
            bin,
            nextPrompt,
            args,
            proxy,
            sessionStarted,
            outcome,
          )) {
            if (ev.kind === 'assistant' && ev.text) {
              // Yield each line of prose AS IT ARRIVES (not after process
              // exit) — a crush turn can run many minutes, and session.ts's
              // watchdog must see messages DURING the turn.
              yield { type: 'assistant', text: ev.text };
            } else if (ev.kind === 'tool') {
              // Liveness only: session.ts never renders tool_use as chat —
              // it feeds the StateDetector and refreshes last-activity.
              yield { type: 'tool_use', text: ev.text };
            }
          }
          sessionStarted = true;

          if (outcome.hangSuspected) {
            throw new Error(
              `CrushAgentRunner: crush produced no output within ${STARTUP_GRACE_MS / 1000}s and was killed. ` +
                'This usually means it is stuck on a first-run interactive prompt (trust/telemetry gate) ' +
                'that headless mode has no way to answer. Run `crush` once manually in a real terminal in ' +
                `this project to accept any prompts, then retry.${outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
            );
          }
          if (outcome.exitCode !== 0) {
            throw turnError(outcome, round);
          }

          const malformed: string[] = [];
          const calls = parseToolCalls([outcome.rawText], (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) {
            const totals = proxy?.totals();
            yield {
              type: 'result',
              subtype: 'success',
              input_tokens: totals?.inputTokens ?? 0,
              output_tokens: totals?.outputTokens ?? 0,
            };
            break;
          }

          if (round === MAX_TOOL_ROUNDS) {
            yield {
              type: 'assistant',
              text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)`,
            };
            const totals = proxy?.totals();
            yield {
              type: 'result',
              subtype: 'success',
              input_tokens: totals?.inputTokens ?? 0,
              output_tokens: totals?.outputTokens ?? 0,
            };
            break;
          }

          // sessionStarted is true by now (set right after the first
          // streamTurn call above) — the retry continues the same crush
          // session via --continue instead of re-sending the system prompt.
          const results: string[] = [];
          for (const call of calls)
            results.push(await executeToolCall(args.tools, call, args.canUseTool));
          nextPrompt = formatToolResults(calls, results);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'CrushAgentRunner requires the Crush CLI (crush) on PATH. ' +
            'Install it per https://github.com/charmbracelet/crush, then configure a provider. ' +
            'Or unset the runtime to use Claude.',
        );
      }
      throw err;
    } finally {
      await proxy?.stop();
    }
  }

  /**
   * Run one `crush run` invocation and stream its plain-text stdout
   * INCREMENTALLY: each line is yielded as soon as it arrives (see the
   * header's "Streaming / liveness" note for why buffering until process
   * close was a bug, #204). End-of-turn facts (exit code, stderr tail, raw
   * text, hang/timeout flags) are written into `outcome`, which the caller
   * reads after this generator completes.
   */
  private async *streamTurn(
    bin: string,
    prompt: string,
    args: AgentRunArgs,
    proxy: UsageProxyServer | undefined,
    continueSession: boolean,
    outcome: TurnOutcome,
  ): AsyncGenerator<CrushStreamEvent> {
    // No --yolo here: confirmed against a live v0.89.0 install that `crush
    // run` rejects it outright ("Unknown flag: --yolo") — --yolo/-y is a
    // root-only flag for the interactive TUI, not propagated to `run`.
    // Non-interactive `run` mode auto-approves tool calls without it
    // (confirmed live: a file-write tool call completed with no prompt),
    // so this isn't a missing-permission gap either — passing it just
    // made every single invocation fail with a non-zero exit. See #180.
    const cliArgs: string[] = ['run', prompt];
    if (args.model) cliArgs.push('--model', args.model);
    if (continueSession) cliArgs.push('--continue');

    // CRUSH_DISABLE_PROVIDER_AUTO_UPDATE: confirmed via crush's own docs —
    // suppresses a first-run/periodic provider-list update check that would
    // otherwise add an unpredictable network round-trip to a headless turn.
    const env: Record<string, string | undefined> = {
      ...process.env,
      CRUSH_DISABLE_PROVIDER_AUTO_UPDATE: '1',
      ...args.env,
    };
    if (proxy && this.usageProxyOpts) env[this.usageProxyOpts.baseUrlEnvVar] = proxy.url();

    const child = spawn(bin, cliArgs, { cwd: args.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrTail = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });

    let sawOutput = false;
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

    let fullRaw = '';
    // Whether we're currently inside a ```tool_call ... ``` fence — lines in
    // between are withheld from the visible assistant stream (same content
    // TOOL_CALL_RE strips at the end) but still folded into fullRaw so
    // end-of-turn fence parsing sees the complete, un-split fence body.
    let fenceOpen = false;

    // Normalize one complete line of crush's plain-text stdout into the
    // CrushStreamEvent to yield (or null for a blank/fence-interior line).
    const handleLine = (line: string): CrushStreamEvent | null => {
      const trimmed = line.trim();
      if (!fenceOpen) {
        if (trimmed.startsWith('```tool_call')) {
          // The model just started emitting a tool_call fence — forward as
          // tool_use liveness at this start boundary (crush has no tool
          // execution events of its own; this fence IS the closest analog).
          fenceOpen = true;
          return { kind: 'tool', text: 'tool_call' };
        }
        return trimmed ? { kind: 'assistant', text: line } : null;
      }
      if (trimmed === '```') fenceOpen = false;
      return null;
    };

    try {
      // Immediate liveness yield: session.ts races the FIRST pull against a
      // 4-minute silent-stream watchdog, and crush's first byte of output
      // can itself take minutes. Yielding at spawn wins that race
      // deterministically instead of depending on crush's latency.
      yield { kind: 'tool', text: 'turn started' };

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
          fullRaw += `${line}\n`;
          const out = handleLine(line);
          if (out) yield out;
        }
      }
      if (buf) {
        fullRaw += buf;
        const out = handleLine(buf);
        if (out) yield out;
      }
    } finally {
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
    outcome.rawText = parseCrushOutput(fullRaw).rawText;
    outcome.exitCode = exitCode;
    outcome.stderrTail = stderrTail;
    outcome.timedOut = timedOut;
    outcome.hangSuspected = hangSuspected;
  }
}

/** Build the actionable error for a failed crush turn. */
function turnError(outcome: TurnOutcome, round: number): Error {
  if (outcome.timedOut) {
    return new Error(
      `CrushAgentRunner: crush run failed (exit ${outcome.exitCode}) — killed after exceeding the ${TURN_TIMEOUT_MS / 3_600_000}h turn timeout` +
        (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
  }
  // Fatal provider errors (auth/permission/quota — classified from stderr):
  // report what actually happened, and tag the error so the daemon does NOT
  // restart into the same guaranteed failure (a restart on quota exhaustion
  // can only hang or fail again).
  const cls = classifyStderr(outcome.stderrTail);
  if (cls.fatal) {
    const err = new Error(
      `CrushAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `CrushAgentRunner: crush run failed (exit ${outcome.exitCode})` +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
