// packages/@monomind/cli/src/orgrt/crush-runner.ts
/**
 * CrushAgentRunner — AgentRunner impl backed by the Crush CLI
 * (`crush`, https://github.com/charmbracelet/crush).
 *
 * Architectural difference from the other subprocess runners: `crush run
 * "<prompt>"` (per its public CLI docs) is a plain one-shot invocation —
 * text response to stdout, no documented JSON output mode and no documented
 * session-resume flag for headless use. Every mailbox prompt is therefore
 * a FRESH crush invocation with no continuity between turns; conversational
 * memory across turns is lost for roles on this runtime (session.ts's
 * mailbox/history context still gives the model recent context on each
 * fresh turn, same as any runner's very first turn). If a future crush
 * release adds documented headless session resume, wire it in here the same
 * way codex/qwen/grok do (capture + pass a --resume-style flag).
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
 * stays at 0 (fails closed, never breaks the turn itself). Fix the org's
 * provider config or pass the right var name once confirmed.
 *
 * Org tools — FENCE PROTOCOL: same approach as the other subprocess runners.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { AgentRunner, AgentRunArgs, AgentMessage } from './agent-runner.js';
import { buildToolProtocol, parseToolCalls, executeToolCall, formatToolResults, MAX_TOOL_ROUNDS, TOOL_CALL_RE } from './tool-fence.js';
import type { SpawnProcess, SpawnedProcess } from './grok-runner.js';
import { UsageProxyServer } from './usage-proxy.js';

export type { SpawnProcess } from './grok-runner.js';

const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const defaultSpawnProcess: SpawnProcess = (bin, args, opts): SpawnedProcess =>
  nodeSpawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });

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
}

export interface CrushAgentRunnerOptions {
  crushBin?: string;
  spawnProcess?: SpawnProcess;
  /** Enable usage-proxy accounting. Off by default since the base-URL env
   *  var it relies on is an unconfirmed guess (see file header). */
  usageProxy?: { upstreamBaseUrl: string; baseUrlEnvVar?: string };
}

export class CrushAgentRunner implements AgentRunner {
  private crushBin?: string;
  private spawnProcess: SpawnProcess;
  private usageProxyOpts?: { upstreamBaseUrl: string; baseUrlEnvVar: string };

  constructor(opts: CrushAgentRunnerOptions = {}) {
    this.crushBin = opts.crushBin;
    this.spawnProcess = opts.spawnProcess ?? defaultSpawnProcess;
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

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          proxy?.reset();
          const outcome = await this.runTurn(bin, nextPrompt, args, proxy);

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

          // No native session to resume: each retry re-sends system prompt +
          // tool protocol + accumulated tool results as a fresh crush call.
          const results: string[] = [];
          for (const call of calls) results.push(await executeToolCall(args.tools, call, args.canUseTool));
          nextPrompt = `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${formatToolResults(calls, results)}`;
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
  ): Promise<TurnOutcome> {
    return new Promise<TurnOutcome>((resolve, reject) => {
      const cliArgs: string[] = ['run', prompt, '--yolo'];

      const env: Record<string, string | undefined> = { ...process.env, ...args.env };
      if (proxy && this.usageProxyOpts) env[this.usageProxyOpts.baseUrlEnvVar] = proxy.url();

      const child = this.spawnProcess(bin, cliArgs, { cwd: args.cwd, env });

      let stderrTail = '';
      child.stderr?.on('data', (c: Buffer) => { stderrTail = (stderrTail + c.toString()).slice(-4000); });

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
        let stdout = '';
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) stdout += chunk.toString();
        return stdout;
      })()
        .then((stdout) => exitPromise.finally(() => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); }).then((exitCode) => ({ stdout, exitCode })))
        .then(({ stdout, exitCode }) => {
          const parsed = parseCrushOutput(stdout);
          resolve({ text: parsed.text, rawText: parsed.rawText, exitCode, stderrTail, timedOut });
        }, reject);
    });
  }
}
