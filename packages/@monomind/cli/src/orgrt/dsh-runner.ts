// packages/@monomind/cli/src/orgrt/dsh-runner.ts
/**
 * DshAgentRunner — AgentRunner backed by DeepSeek Harness (`dsh`, npm
 * `@deepseek-ai/dsh`, a developer preview). Same shape as the other CLI
 * runners: spawn the CLI per turn, parse its JSONL, normalize to
 * AgentMessage; org tools ride the fence protocol (tool-fence.ts).
 *
 * Invocation (one task per process, cwd = args.cwd, task on stdin):
 *   DSH_PERMISSION_MODE=<mode> dsh --profile headless [--patch <yaml>]
 *       --json [--session-id <id>] -
 *   - Full access: `danger-full-access` (dsh-base: sandbox off, approval
 *     `never`). Scoped: `workspace-write` (approval `ask`; headless has no
 *     answerer, so an escalation fails closed with "requires approval, but
 *     no approval channel is available" — captured live).
 *   - `--patch` is a launcher flag and must precede `--json` (the launcher
 *     hands the first unknown token onward; `--json --patch` is rejected).
 *
 * Model + effort: headless has no flags for either, so a generated patch
 * overrides the `agent-default-model` row (dsh-base), whose Config is
 * {provider, model, reasoningEffort}. A patch replaces the row's whole
 * config, so the current provider/model are first read with
 * `dsh --profile headless --dump-config` (no mount, no model call). Checked
 * against a local mock of DeepSeek's Messages endpoint: the patch made dsh
 * send `model: deepseek-v4-pro` and `output_config: {effort: "max"}`. The
 * ACP profile (`dsh --profile acp`) also exposes both, but would mean a
 * second protocol for the same turn; the patch keeps one code path.
 * `<route>/<model>` picks another route, including free models over the
 * bundled pi-ai adapter (openrouter `:free`, nvidia) — the patch then also
 * turns that route on (dsh-runner-models.ts).
 *
 * Events (dsh-headless json-stream): session{sessionId,cwd};
 * status{turn_start|step_start|step_end(+usage)|turn_end(reason)};
 * thinking/text per committed step (not per token); tool_call{callId,tool,
 * input}/tool_result{callId,status,result} (paired by callId → fidelity
 * full); final{text}; error{message} (failures outside a turn). Exit 0 only
 * when the final turn_end was `completed`. No cost field: tokens are summed
 * from step_end.usage and cost is not reported.
 *
 * Resume: `--session-id <id>`; dsh refuses an unknown id, one recorded under
 * another cwd, and a subagent/forked session — each surfaces as a fatal,
 * named error (dsh-runner-parse.ts dshFailure).
 *
 * Max turns: no native cap. Each `step_start` (one model step) counts toward
 * AgentRunArgs.maxTurns across a message's tool rounds; the step past the
 * cap kills the process tree and the result is `error_max_turns`. The kill
 * lands while that step runs, so a fast step can still commit (seen live
 * against the mock) — the cap is cap + at most one step.
 *
 * Bash: dsh's foreground wait is 60 s (`bash-sandbox.timeoutMs`); a longer
 * command is moved to a background job, not killed, and the agent reads it
 * with job_output — so no patch raises it.
 *
 * Version: gated on `dsh --version` (writes no file; checked in an empty
 * HOME) — DSH_SUPPORTED_RANGE.
 *
 * Evidence: dsh 0.1.7-rc.2 installed in a scratch HOME. The no-credential,
 * unknown-session and cwd-refusal lines are live captures; the success,
 * tool and scoped-denial lines were captured from the real dsh talking to a
 * local mock of the DeepSeek Messages API (DEEPSEEK_BASE_URL), since no
 * DeepSeek key was available. See __tests__/orgrt/dsh-runner*.test.ts.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import { dshEffortFor, dshPiAiRow, dshSplitModel } from './dsh-runner-models.js';
import {
  DSH_DEFAULT_SELECTION,
  DSH_INSTALL_HINT,
  DSH_SUPPORTED_RANGE,
  dshFailure,
  dshModelPatchYaml,
  dshVersionSupported,
  parseDumpedSelection,
} from './dsh-runner-parse.js';
import { type DshTurnOutcome, type StepBudget, streamTurn } from './dsh-runner-stream.js';
import { classifyStderr } from './kimicode-runner.js';
import { realBinary } from './launcher-binary.js';
import { omitAnthropicManagedKeys } from './provider.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
} from './tool-fence.js';

const PROBE_TIMEOUT_MS = 30_000;

function run(
  bin: string,
  argv: string[],
  opts: { cwd?: string; env: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { ...opts, timeout: PROBE_TIMEOUT_MS }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });
}

function missingBinary(): Error {
  return new Error(
    `DshAgentRunner requires DeepSeek Harness (dsh) on PATH. Install it: ${DSH_INSTALL_HINT}, ` +
      'then export DEEPSEEK_API_KEY. Or unset the runtime to use Claude.',
  );
}

function fatal(message: string): Error {
  const err = new Error(message);
  (err as Error & { fatal?: boolean }).fatal = true;
  return err;
}

export class DshAgentRunner implements AgentRunner {
  private versionCheck: Promise<void> | undefined;

  constructor(private dshBin?: string) {}

  /** Fails once per runner with an actionable error outside the range. */
  private checkVersion(bin: string, env: NodeJS.ProcessEnv): Promise<void> {
    this.versionCheck ??= run(bin, ['--version'], { env }).then(
      (out) => {
        const v = dshVersionSupported(out);
        if (!v.ok) {
          throw fatal(
            `DshAgentRunner supports dsh ${DSH_SUPPORTED_RANGE} (developer preview); found ` +
              `${v.version ?? JSON.stringify(out.trim().slice(0, 80))}. Install a supported ` +
              `version: ${DSH_INSTALL_HINT}@0.1.7-rc.2`,
          );
        }
      },
      (err: NodeJS.ErrnoException) => {
        this.versionCheck = undefined; // not a version verdict: try again next run
        throw err.code === 'ENOENT' ? missingBinary() : err;
      },
    );
    return this.versionCheck;
  }

  /** Write the model/effort patch for this run, or undefined when neither
   *  is set (dsh then uses the user's own selection untouched). */
  private async writePatch(
    bin: string,
    args: AgentRunArgs,
    env: NodeJS.ProcessEnv,
  ): Promise<{ path: string; dir: string } | undefined> {
    if (!args.model && !args.effort) return undefined;
    let dump = '';
    try {
      dump = await run(bin, ['--profile', 'headless', '--dump-config'], { cwd: args.cwd, env });
    } catch {
      /* fall back to dsh's shipped default route below */
    }
    const current = parseDumpedSelection(dump);
    const picked = args.model ? dshSplitModel(args.model) : undefined;
    const provider = picked?.provider ?? current.provider ?? DSH_DEFAULT_SELECTION.provider;
    const model = picked?.model || current.model || DSH_DEFAULT_SELECTION.model;
    const yaml = dshModelPatchYaml(
      {
        provider,
        model,
        // A new route drops the old route's effort (its levels may not apply).
        reasoningEffort: args.effort
          ? dshEffortFor(provider, model, args.effort)
          : provider === current.provider
            ? current.reasoningEffort
            : undefined,
      },
      dshPiAiRow(provider, dump),
    );
    const dir = fs.mkdtempSync(join(tmpdir(), 'monomind-dsh-'));
    const path = join(dir, 'model.patch.yml');
    fs.writeFileSync(path, yaml, { mode: 0o600 });
    return { path, dir };
  }

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.dshBin || process.env.DSH_CLI_BIN || 'dsh');
    const env = { ...omitAnthropicManagedKeys(process.env), ...args.env };
    let sessionId: string | undefined = args.resume;
    await this.checkVersion(bin, env);
    const patch = await this.writePatch(bin, args, env);

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = text;
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const budget: StepBudget = { steps: 0, max: args.maxTurns > 0 ? args.maxTurns : 0 };
        let maxTurnsHit = false;

        for (let round = 0; ; round++) {
          // Until dsh has handed back a session id, every invocation is a
          // fresh session and needs the system prompt + tool protocol.
          const prompt = !sessionId
            ? `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${nextPrompt}`
            : nextPrompt;
          const outcome: DshTurnOutcome = {
            exitCode: 1,
            stderrTail: '',
            timedOut: false,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            maxTurnsHit: false,
          };
          const resumed = sessionId;
          const rawTexts: string[] = [];
          for await (const ev of streamTurn(
            bin,
            prompt,
            sessionId,
            patch?.path,
            args,
            outcome,
            budget,
          )) {
            if (ev.kind === 'assistant') {
              rawTexts.push(ev.rawText);
              if (ev.text)
                yield {
                  type: 'assistant',
                  session_id: outcome.sessionId ?? sessionId,
                  text: ev.text,
                };
            } else {
              if (ev.message.session_id) sessionId = ev.message.session_id;
              yield ev.message;
            }
          }
          if (outcome.sessionId) sessionId = outcome.sessionId;
          usage.input += outcome.inputTokens;
          usage.output += outcome.outputTokens;
          usage.cacheRead += outcome.cacheReadTokens;
          usage.cacheWrite += outcome.cacheWriteTokens;
          if (outcome.maxTurnsHit) {
            maxTurnsHit = true;
            break;
          }
          if (outcome.timedOut) {
            throw new Error(
              `DshAgentRunner: dsh turn (tool round ${round}) exceeded the turn timeout and was killed.`,
            );
          }
          const failure = dshFailure(outcome.errorEvent, outcome.turnEnd, resumed);
          if (failure || outcome.exitCode !== 0) {
            const detail = failure?.message ?? `dsh exited ${outcome.exitCode}`;
            const cls = classifyStderr(`${detail}\n${outcome.stderrTail}`);
            const message =
              `DshAgentRunner: ${detail}` +
              (!failure && outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : '');
            throw failure?.fatal || cls.fatal ? fatal(message) : new Error(message);
          }

          const malformed: string[] = [];
          const calls = parseToolCalls(rawTexts, (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed)
            yield { type: 'assistant', session_id: sessionId, text: note };
          if (calls.length === 0) break;
          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', session_id: sessionId, text: note };
          if (!results) break;
          nextPrompt = formatToolResults(calls, results);
        }

        yield {
          type: 'result',
          session_id: sessionId,
          subtype: maxTurnsHit ? 'error_max_turns' : 'success',
          input_tokens: usage.input,
          output_tokens: usage.output,
          ...(usage.cacheRead ? { cache_read_input_tokens: usage.cacheRead } : {}),
          ...(usage.cacheWrite ? { cache_creation_input_tokens: usage.cacheWrite } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw missingBinary();
      throw err;
    } finally {
      if (patch) fs.rmSync(patch.dir, { recursive: true, force: true });
    }
  }
}
