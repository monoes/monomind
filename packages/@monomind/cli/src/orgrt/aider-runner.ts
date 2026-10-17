// packages/@monomind/cli/src/orgrt/aider-runner.ts
/**
 * AiderAgentRunner — AgentRunner backed by Aider (`aider-chat`,
 * https://github.com/Aider-AI/aider), monoes/monomind#383.
 *
 * WHY A SHIM: the aider CLI prints plain text only, exits 0 on an auth
 * failure, and — decisively — never runs a model-suggested shell command
 * unattended (`--yes-always` answers "n" to every explicit_yes_required
 * confirmation, io.py). So this runner drives aider through its Python
 * scripting API instead: aider/monomind_aider_shim.py, run with aider's
 * OWN interpreter (aider-runner-resolve.ts), answers confirmations by
 * access mode (full: yes to everything, incl. shell commands; scoped: no to
 * shell commands) and emits a monomind-owned NDJSON stream — session, text
 * (streamed), matched tool_start/tool_end (edit/write/patch/shell with
 * exit_code, commit), usage (tokens + USD), error (auth/quota, non-zero
 * exit) and result (end_turn / max_turns).
 *
 * Sessions: the shim mints the id and keeps the conversation under the
 * state dir (defaultStateDir, never in the user's repo); `resume` loads it
 * back. Effort maps onto the model's reasoning_effort / thinking_tokens;
 * maxTurns caps aider's reflection loop. MCP is not supported (aider 0.86
 * has none) — the shim says so in a status event.
 *
 * FALLBACK: when aider's Python cannot be located (or cannot import aider)
 * the runner runs the plain CLI (`--message-file … --yes-always --no-pretty
 * --no-stream`) and scrapes its text: tool activity is start-only, and a
 * status notice says model-suggested shell commands will not run.
 *
 * Org tools — FENCE PROTOCOL, like the other subprocess runners: tool_call
 * fences in the reply run between invocations, and the next invocation
 * resumes the same session with the results.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentMessage, AgentRunArgs, AgentRunner } from './agent-runner.js';
import {
  defaultShimPath,
  defaultStateDir,
  insideGitRepo,
  resolveAiderPython,
} from './aider-runner-resolve.js';
import {
  type AiderEvent,
  type AiderInvocation,
  type AiderOutcome,
  streamAider,
} from './aider-runner-stream.js';
import { computeSafeChunk } from './antigravity-runner-stream.js';
import type { OrgEffortLevel } from './cost-tier.js';
import { realBinary } from './launcher-binary.js';
import { withVendorRetries } from './provider-limit.js';
import {
  buildToolProtocol,
  formatToolResults,
  parseToolCalls,
  runToolRound,
  TOOL_CALL_RE,
} from './tool-fence.js';

export interface AiderRunnerOptions {
  /** `aider` binary (default: AIDER_CLI_BIN, else `aider` on PATH). */
  aiderBin?: string;
  /** aider's interpreter; `null` forces the plain-CLI fallback. Default:
   *  resolved from the entry point (aider-runner-resolve.ts). */
  python?: string | null;
  shimPath?: string;
  stateDir?: string;
}

/** Shim exit code: aider could not be imported by that interpreter. */
const SHIM_EXIT_IMPORT = 4;

/** aider CLI `--reasoning-effort` (fallback only; the shim maps its own). */
const CLI_EFFORT: Partial<Record<OrgEffortLevel, string>> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
};

export const AIDER_FALLBACK_NOTICE =
  "aider: aider's Python interpreter was not found, so the plain aider CLI runs instead — " +
  'model-suggested shell commands will NOT run and tool activity is start-only. ' +
  'Install with `uv tool install --python 3.12 aider-chat` or set MONOMIND_AIDER_PYTHON.';

const stripFences = (s: string): string => s.replace(TOOL_CALL_RE, '');

export class AiderAgentRunner implements AgentRunner {
  constructor(private opts: AiderRunnerOptions = {}) {}

  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    const bin = realBinary(this.opts.aiderBin || process.env.AIDER_CLI_BIN || 'aider');
    // #502 review: an org role keeps its conversations under its private
    // TMPDIR, not in the shared ~/.monomind/aider-sessions.
    const stateDir =
      this.opts.stateDir ||
      (args.env?.MONOMIND_ORG_ROLE && args.env.TMPDIR && !process.env.MONOMIND_AIDER_STATE_DIR
        ? join(args.env.TMPDIR, 'aider-sessions')
        : defaultStateDir());
    const shimPath = this.opts.shimPath || defaultShimPath();
    let python =
      this.opts.python === null
        ? undefined
        : (this.opts.python ?? resolveAiderPython(bin, { ...process.env, ...args.env }));
    let mode: 'shim' | 'cli' = python && existsSync(shimPath) ? 'shim' : 'cli';
    let noticed = false;
    let sessionId: string | undefined = args.resume;
    // Per-token text only for agent exec (§3.2), and only fence-safely.
    const partials = args.extras?.includePartialMessages === true;
    let runCostUsd = 0;
    let costSeen = false;
    // Every shim process numbers its tool calls from aider-1: later spawns
    // in this run get a suffix so ids stay unique (cf. codex's idPrefix).
    let spawnSeq = 0;

    const invocation = (prompt: string): AiderInvocation => {
      if (mode === 'shim' && python) {
        const req = {
          prompt,
          cwd: args.cwd,
          state_dir: stateDir,
          access: args.access === 'full' ? 'full' : 'scoped',
          settings: (args.settingSources?.length ?? 0) > 0,
          model: args.model,
          effort: args.effort,
          max_turns: args.maxTurns,
          session_id: sessionId,
        };
        return { mode, command: python, argv: ['-u', shimPath], stdin: JSON.stringify(req) };
      }
      return this.cliInvocation(bin, stateDir, prompt, args, sessionId, (id) => {
        sessionId = id;
      });
    };

    try {
      for await (const p of args.prompt) {
        const text = typeof p === 'string' ? p : (p?.message?.content ?? String(p ?? ''));
        let nextPrompt = sessionId
          ? text
          : `${args.systemPrompt}${buildToolProtocol(args.tools)}\n\n---\n\n${text}`;
        let promptIn = 0;
        let promptOut = 0;
        let stopReason = 'end_turn';

        // runToolRound ends this loop past the round cap (#326).
        for (let round = 0; ; round++) {
          if (mode === 'cli' && !noticed) {
            noticed = true;
            yield { type: 'status', text: AIDER_FALLBACK_NOTICE };
          }
          const outcome: AiderOutcome = { exitCode: 1, stderrTail: '', timedOut: false };
          const inv = invocation(nextPrompt);
          const seq = ++spawnSeq;
          const open = new Map<string, { name: string; at: number }>();
          let full = '';
          let flushed = 0;
          let sawEvent = false;

          for await (const ev of streamAider(inv, args, outcome)) {
            sawEvent = true;
            // Scraped CLI text: no leading blank lines, and nothing after an
            // error line (its continuation lines are not the reply).
            if (
              ev.type === 'text' &&
              inv.mode === 'cli' &&
              (outcome.error !== undefined || (!full && !ev.text.trim()))
            ) {
              continue;
            }
            const out = this.toMessages(
              seq > 1 && (ev.type === 'tool_start' || ev.type === 'tool_end')
                ? { ...ev, id: `${ev.id}.${seq}` }
                : ev,
              sessionId,
              open,
            );
            if (ev.type === 'session') sessionId = ev.session_id;
            if (ev.type === 'text') {
              full += ev.text;
              if (partials && args.tools.length === 0) {
                yield { type: 'assistant', text: ev.text, session_id: sessionId };
                flushed = full.length;
              } else if (partials) {
                const { chunk, safeEnd } = computeSafeChunk(full, flushed);
                flushed = safeEnd;
                if (chunk) yield { type: 'assistant', text: chunk, session_id: sessionId };
              }
            }
            for (const m of out) yield m;
          }

          if (inv.mode === 'shim' && outcome.exitCode === SHIM_EXIT_IMPORT) {
            // aider's interpreter cannot import aider: the plain CLI instead.
            mode = 'cli';
            python = undefined;
            round--;
            continue;
          }
          // Close calls the process never ended (killed mid-command).
          for (const [id, call] of open) {
            yield this.endMessage(
              id,
              call,
              false,
              'aider exited before the call finished',
              sessionId,
            );
          }
          if (outcome.usage) {
            promptIn += outcome.usage.input;
            promptOut += outcome.usage.output;
            runCostUsd += outcome.usage.usd;
            costSeen = true;
          }
          if (outcome.error || outcome.exitCode !== 0) throw aiderError(outcome, sawEvent);
          if (outcome.stopReason === 'max_turns') stopReason = 'max_turns';

          // What was not streamed yet: the whole reply without partials, else
          // the tail computeSafeChunk held back (fences removed either way).
          const rest = stripFences(full.slice(flushed));
          if (rest.trim()) {
            yield { type: 'assistant', text: partials ? rest : rest.trim(), session_id: sessionId };
          }

          const malformed: string[] = [];
          const calls = parseToolCalls([full], (raw, err) =>
            malformed.push(
              `[monomind] ignored malformed tool_call fence (${err}): ${raw.slice(0, 200)}`,
            ),
          );
          for (const note of malformed) yield { type: 'assistant', text: note };
          if (calls.length === 0) break;
          const { results, note } = await runToolRound(args, calls, round);
          if (note) yield { type: 'assistant', text: note };
          if (!results) break;
          nextPrompt = formatToolResults(calls, results);
        }

        yield {
          type: 'result',
          session_id: sessionId,
          subtype: stopReason === 'max_turns' ? 'error_max_turns' : 'success',
          input_tokens: promptIn,
          output_tokens: promptOut,
          ...(costSeen ? { cost_usd: runCostUsd } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const e = new Error(
          'AiderAgentRunner requires Aider (aider) on PATH. Install it: ' +
            '`uv tool install --python 3.12 aider-chat` (aider does not install on Python 3.14), ' +
            'then set your provider API key (e.g. OPENAI_API_KEY). Or unset the runtime to use Claude.',
        );
        (e as NodeJS.ErrnoException).code = 'ENOENT';
        throw e;
      }
      throw err;
    }
  }

  /** Shim events → AgentMessages (text is handled by run()). */
  private toMessages(
    ev: AiderEvent,
    sessionId: string | undefined,
    open: Map<string, { name: string; at: number }>,
  ): AgentMessage[] {
    switch (ev.type) {
      case 'status':
        return [{ type: 'status', text: ev.message, session_id: sessionId }];
      case 'tool_start':
        open.set(ev.id, { name: ev.name, at: Date.now() });
        return [
          {
            type: 'tool_use',
            session_id: sessionId,
            text: ev.name,
            tool_use_id: ev.id,
            tool: ev.name,
            input: ev.input ?? {},
            kind: ev.kind,
            parent_tool_use_id: null,
          },
        ];
      case 'tool_end': {
        const call = open.get(ev.id);
        if (!call) return [];
        open.delete(ev.id);
        return [this.endMessage(ev.id, call, ev.ok, ev.output, sessionId, ev.exit_code)];
      }
      case 'cli_tool':
        // Start-only: no id to pair an end with (fidelity "start-only").
        return [{ type: 'tool_use', text: ev.name, session_id: sessionId }];
      default:
        return [];
    }
  }

  private endMessage(
    id: string,
    call: { name: string; at: number },
    ok: boolean,
    output: string,
    sessionId: string | undefined,
    exitCode?: number,
  ): AgentMessage {
    return {
      type: 'tool_result',
      session_id: sessionId,
      tool_use_id: id,
      tool: call.name,
      is_error: !ok,
      text: output ?? '',
      duration_ms: Date.now() - call.at,
      ...(typeof exitCode === 'number' ? { exit_code: exitCode } : {}),
    };
  }

  /** The plain-CLI fallback invocation. The message and aider's history
   *  files live in the state dir; `--restore-chat-history` resumes. */
  private cliInvocation(
    bin: string,
    stateDir: string,
    prompt: string,
    args: AgentRunArgs,
    sessionId: string | undefined,
    setSession: (id: string) => void,
  ): AiderInvocation {
    const resuming = !!sessionId;
    const sid = sessionId ?? randomUUID().replace(/-/g, '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sid))
      throw new Error(`AiderAgentRunner: invalid session id`);
    setSession(sid);
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const messageFile = join(stateDir, `${sid}.message.md`);
    // aider runs a message starting with `!`/`/` as its own command (`/run`
    // shells out with no confirmation); scoped mode keeps it a message, as
    // the shim does by replacing preproc_user_input.
    const message =
      args.access !== 'full' && /^[/!]/.test(prompt.trimStart()) ? `Request: ${prompt}` : prompt;
    writeFileSync(messageFile, message, { mode: 0o600 });
    const argv = [
      '--message-file',
      messageFile,
      '--yes-always',
      '--no-pretty',
      '--no-stream',
      '--no-check-update',
      '--analytics-disable',
      '--no-fancy-input',
      '--no-show-model-warnings',
      '--no-gitignore',
      '--chat-history-file',
      join(stateDir, `${sid}.chat.history.md`),
      '--input-history-file',
      join(stateDir, `${sid}.input.history`),
    ];
    if ((args.settingSources?.length ?? 0) === 0) argv.push('--no-auto-commits');
    // The CLI answers its own "create a git repo?" yes under --yes-always.
    if (!insideGitRepo(args.cwd)) argv.push('--no-git');
    if (resuming) argv.push('--restore-chat-history');
    if (args.model) argv.push('--model', args.model);
    const effort = args.effort ? CLI_EFFORT[args.effort] : undefined;
    if (effort) argv.push('--reasoning-effort', effort);
    return { mode: 'cli', command: bin, argv, stdin: '' };
  }
}

/** The error a failed invocation throws. Auth/quota/rate-limit carry the
 *  markers agent-exec's classifyStderr maps to `auth` / `quota` /
 *  `rate-limited` (fatal); aider already retried a rate limit itself. */
export function aiderError(outcome: AiderOutcome, sawEvent: boolean): Error {
  const tail = outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : '';
  const e = outcome.error;
  if (e && (e.code === 'auth' || e.code === 'quota')) {
    const label = e.code === 'auth' ? 'auth_error' : 'quota exhausted';
    const err = new Error(
      `AiderAgentRunner: FATAL provider error (${label}) — not retrying. ${e.message}`,
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  if (e?.code === 'rate-limited') {
    const err = new Error(
      `AiderAgentRunner: FATAL provider error (provider rate limit (429)) — aider already retried it. ${e.message}`,
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return withVendorRetries(err, 'unknown');
  }
  if (e?.code === 'session') {
    // Resuming another folder's conversation: retrying cannot help.
    const err = new Error(`AiderAgentRunner: ${e.message}`);
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  if (e) return new Error(`AiderAgentRunner: aider failed (${e.code}): ${e.message}${tail}`);
  return new Error(
    `AiderAgentRunner: aider failed (exit ${outcome.exitCode})` +
      (outcome.timedOut ? ' — killed after exceeding the 2h turn timeout' : '') +
      (sawEvent ? '' : ' before producing any output') +
      tail,
  );
}
