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
 * Usage accounting — crush's plain-text output carries no token counts, so
 * this runner optionally routes crush's LLM traffic through a
 * UsageProxyServer (usage-proxy.ts): crush supports pointing its provider at
 * a custom OpenAI-compatible base URL for BYOK/self-hosted setups, so the
 * runner sets that env var to the local proxy before spawning and reads
 * totals() after the turn. The exact env var crush reads for a runtime
 * base-URL override was not confirmed against a live install (its provider
 * config is normally a JSON file, `~/.config/crush/crush.json`), so the var
 * name is an OVERRIDABLE BEST GUESS (`OPENAI_BASE_URL`, constructor param
 * `baseUrlEnvVar`) — if it doesn't match your crush config, usage simply
 * stays at 0 (fails closed, never breaks the turn itself). A second,
 * independent source's own integration notes state more confidently that
 * crush has NO base-URL env override at all and instead reads a runtime
 * `provider.base_url` from a generated JSON config file pointed to by an
 * env var — if true, this env-var guess does nothing (which the fails-closed
 * design already tolerates) and the real fix is writing that config file
 * before spawn, not renaming the env var. Left as a known follow-up rather
 * than implemented here, since that source's own claim isn't independently
 * confirmed either. Fix the org's provider config or pass the right var
 * name via `baseUrlEnvVar` once confirmed against a live install.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
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
   *  var it relies on is an unconfirmed guess (see file header). */
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
      proxy = new UsageProxyServer({ upstreamBaseUrl: this.usageProxyOpts.upstreamBaseUrl, apiStyle: 'openai' });
      await proxy.start();
    }

    // Set once the first crush invocation completes — subsequent calls pass
    // --continue (resume the most-recently-used session) instead of
    // re-sending the full system prompt from scratch every turn.
    let sessionStarted = false;

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = sessionStarted ? text : `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          proxy?.reset();
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
              (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
            );
          }

          if (outcome.text) yield { type: 'assistant', text: outcome.text };

          const malformed: string[] = [];
          const calls = parseToolCalls([outcome.rawText], (raw, err) => malformed.push(
            `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
          ));
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
            yield { type: 'assistant', text: `[monomind] tool-call round cap (${MAX_TOOL_ROUNDS}) reached — dropping ${calls.length} pending tool call(s)` };
            const totals = proxy?.totals();
            yield { type: 'result', subtype: 'success', input_tokens: totals?.inputTokens ?? 0, output_tokens: totals?.outputTokens ?? 0 };
            break;
          }

          // sessionStarted is true by now (set right after the first
          // runTurn call above) — the retry continues the same crush
          // session via --continue instead of re-sending the system prompt.
          const results: string[] = [];
          for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
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
      const cliArgs: string[] = ['run', prompt, '--yolo'];
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
      child.stderr?.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-4000); });

      let sawOutput = false;
      let timedOut = false;
      let hangSuspected = false;
      const KILL_GRACE_MS = 5000;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
        killTimer.unref?.();
      }, TURN_TIMEOUT_MS);

      // See STARTUP_GRACE_MS — disarmed by the first stdout chunk below.
      let hangTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        hangSuspected = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
        killTimer.unref?.();
      }, STARTUP_GRACE_MS);

      const exitPromise = new Promise<number>((res, rej) => {
        child.on('error', rej);
        child.on('close', (code) => res(code ?? 1));
      });
      exitPromise.catch(() => {});

      (async () => {
        let stdout = '';
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          if (!sawOutput) { sawOutput = true; if (hangTimer) { clearTimeout(hangTimer); hangTimer = undefined; } }
          stdout += chunk.toString();
        }
        return stdout;
      })()
        .then((stdout) => exitPromise.finally(() => {
          clearTimeout(timer);
          if (hangTimer) clearTimeout(hangTimer);
          if (killTimer) clearTimeout(killTimer);
        }).then((exitCode) => ({ stdout, exitCode })))
        .then(({ stdout, exitCode }) => {
          const parsed = parseCrushOutput(stdout);
          resolve({ text: parsed.text, rawText: parsed.rawText, exitCode, stderrTail, timedOut, hangSuspected });
        }, reject);
    });
  }
}
