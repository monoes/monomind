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
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn } from 'node:child_process';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
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

interface TurnOutcome {
  text: string;
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
          const outcome = await this.runTurn(bin, nextPrompt, args, proxy, sessionStarted);
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
            throw new Error(
              `CrushAgentRunner: crush run failed (exit ${outcome.exitCode})` +
                (outcome.timedOut
                  ? ` — killed after exceeding the ${TURN_TIMEOUT_MS / 3_600_000}h turn timeout`
                  : '') +
                (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
            );
          }

          if (outcome.text) yield { type: 'assistant', text: outcome.text };

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
          // runTurn call above) — the retry continues the same crush
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

  private runTurn(
    bin: string,
    prompt: string,
    args: AgentRunArgs,
    proxy: UsageProxyServer | undefined,
    continueSession: boolean,
  ): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve, reject) => {
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
      const KILL_GRACE_MS = 5000;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
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

      const exitPromise = new Promise<number>((res, rej) => {
        child.on('error', rej);
        child.on('close', (code) => res(code ?? 1));
      });
      exitPromise.catch(() => {});

      const readStdout = (async () => {
        let stdout = '';
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          if (!sawOutput) {
            sawOutput = true;
            if (hangTimer) {
              clearTimeout(hangTimer);
              hangTimer = undefined;
            }
          }
          stdout += chunk.toString();
        }
        return stdout;
      })();

      // Timer cleanup lives in a top-level .finally() (not nested inside a
      // success-path .then()) so it runs on EITHER path — a stdout stream
      // error would otherwise skip straight to reject() and leave the
      // TURN_TIMEOUT_MS/hangTimer/killTimer timers running past the
      // process's actual lifetime.
      Promise.all([readStdout, exitPromise])
        .then(
          ([stdout, exitCode]) => {
            const parsed = parseCrushOutput(stdout);
            resolve({
              text: parsed.text,
              rawText: parsed.rawText,
              exitCode,
              stderrTail,
              timedOut,
              hangSuspected,
            });
          },
          (err) => {
            // A stdout stream error (the reject path) means the process is
            // still ALIVE and unmanaged — none of the timeout/hang timers
            // would have fired to kill it. Without this, that error would
            // orphan the child. child.kill() on an already-dead process is a
            // documented no-op, so this is safe on every path.
            try {
              child.kill('SIGTERM');
            } catch {
              /* already gone */
            }
            reject(err);
          },
        )
        .finally(() => {
          clearTimeout(timer);
          if (hangTimer) clearTimeout(hangTimer);
          if (killTimer) clearTimeout(killTimer);
        });
    });
  }
}
