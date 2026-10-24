// packages/@monomind/cli/src/orgrt/codex-runner-stream.ts
import {
  chmodSync,
  closeSync,
  fchmodSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentRunArgs } from './agent-runner.js';
import { killOnAbort } from './agent-runner.js';
import { maskedCommand } from './authority-mask.js';
import { codexSandboxArgs, codexSandboxModeArgs, roleGitLevel } from './cli-sandbox.js';
import { CodexToolItems, codexEffortArgs } from './codex-runner-tools.js';
import type {
  CodexEvent,
  CodexStreamEvent,
  CodexTokenUsage,
  TurnOutcome,
} from './codex-runner-types.js';
import { classifyStderr } from './kimicode-runner.js';
import { spawnRunnerProcess } from './process-group-spawn.js';
import { omitAnthropicManagedKeys } from './provider.js';
import { TOOL_CALL_RE } from './tool-fence.js';

export const TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours, matching kimi/antigravity runners

/**
 * Security (#535): codex's `shell_snapshot` feature is enabled by default
 * (stable) in codex 0.156.1, and `codex exec` — what this runner runs —
 * creates `$CODEX_HOME/shell_snapshots/`. A snapshot holds the user's shell
 * environment, every exported API key and token included, and codex creates
 * it with the process umask, so 0644 under the usual 022.
 *  - `-c features.shell_snapshot=false` (and `_v2`): codex's own feature
 *    flags (`codex features list`) — the fix; no snapshot is written. A codex
 *    that lacks a key only logs "unknown feature key in config".
 *  - `restrictCodexHome` makes `$CODEX_HOME` and its `sessions/` and
 *    `shell_snapshots/` 0700 before each spawn, when the current user owns
 *    them: a 0700 dir hides its files whatever their own modes, so rollouts
 *    and any snapshot an older codex wrote are not readable by other users.
 *    The process umask is left alone, so workspace files keep their modes.
 * CODEX_HOME is never redirected: codex's auth lives in the user's own
 * `~/.codex/auth.json`, which this runner has never copied.
 */
export const CODEX_SNAPSHOT_OFF_ARGS = [
  '-c',
  'features.shell_snapshot=false',
  '-c',
  'features.shell_snapshot_v2=false',
] as const;

/** `$CODEX_HOME` for a child env: codex's own default is `~/.codex`. */
export function codexHomeDir(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME || join(env.HOME || homedir(), '.codex');
}

/**
 * chmod 0700 `dir` when it is a real directory (not a symlink) owned by `uid`
 * and not already 0700. Opens it with O_NOFOLLOW | O_DIRECTORY and uses
 * fstat + fchmod on that fd, so a symlink swapped in between the check and
 * the chmod is refused (ELOOP/ENOTDIR) instead of followed. Where Node lacks
 * those flags (Windows) it falls back to lstat + chmod. Throws when missing.
 */
function tightenDir(dir: string, uid: number): boolean {
  const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = fsConstants;
  if (O_DIRECTORY === undefined || O_NOFOLLOW === undefined) {
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o777) === 0o700) return false;
    chmodSync(dir, 0o700);
    return true;
  }
  const fd = openSync(dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (st.uid !== uid || (st.mode & 0o777) === 0o700) return false;
    fchmodSync(fd, 0o700);
    return true;
  } finally {
    closeSync(fd);
  }
}

/**
 * chmod 0700 `codexHome` and its `sessions/` and `shell_snapshots/`, each
 * only when it is a real directory owned by the current user. A symlinked
 * `codexHome` (dotfile managers) is resolved with realpath and its target
 * tightened under the same checks (#540); symlinked subdirs are left alone.
 * Missing dirs are left for codex to create; errors are ignored (best effort,
 * never blocks a turn). Returns the paths it tightened. No-op on win32.
 */
export function restrictCodexHome(codexHome: string): string[] {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') return [];
  const uid = process.getuid();
  let home = codexHome;
  try {
    if (lstatSync(codexHome).isSymbolicLink()) home = realpathSync(codexHome);
  } catch {
    return []; // missing or dangling: codex creates it
  }
  const changed: string[] = [];
  for (const dir of [home, join(home, 'sessions'), join(home, 'shell_snapshots')]) {
    try {
      if (tightenDir(dir, uid)) changed.push(dir);
    } catch {
      /* missing, a symlink, or not ours to change */
    }
  }
  return changed;
}

/**
 * `codex exec` argv for one turn. ARG ORDER — see file header for the
 * live-verified citation:
 *   codex exec --json [--model X] [-c model_reasoning_effort=L]
 *              -c features.shell_snapshot=false -c features.shell_snapshot_v2=false [--cd Y]
 *              [--skip-git-repo-check] [--sandbox <mode> | --dangerously-…]
 *              [resume <threadId>] [--image <file>]… -- -
 * The prompt goes over STDIN, not argv: a single argv element is capped
 * at 128 KiB on Linux (E2BIG), and a system prompt + tool protocol +
 * tool results routinely exceeds that. `-` is codex's documented "read
 * instructions from stdin" marker on both `exec` and `exec resume`
 * (confirmed live, v0.153.2); `--` ends option parsing so nothing
 * positional is ever mistaken for a flag.
 *
 * Coder mode (`access: 'full'`, rev 19): `--dangerously-bypass-approvals-
 * and-sandbox` (no approvals, no codex sandbox — codex-cli 0.156.1 `exec`
 * and `exec resume` both accept it) replaces the role's `--sandbox`. The
 * user's codex config (`$CODEX_HOME/config.toml`, its MCP servers, project
 * AGENTS.md) is never isolated by this runner in any mode — no CODEX_HOME
 * override, no `--ignore-user-config` — so `settingSources` needs nothing
 * here; agent-exec names what codex loads in a `status` notice.
 * `access: 'read'` (#388) passes `--sandbox read-only`: the whole filesystem
 * read-only and no network for model-generated shell commands.
 * An explicit `sandbox` (#396, `agent exec --sandbox`) of read-only or
 * workspace-write replaces both the role's default and the full-access
 * bypass flag; `full` or unset keeps the behaviour above.
 * `images` (rev 32, `agent exec --attach`) come after `resume <id>`, so a
 * resumed turn uses `exec resume`'s own `--image` (codex-cli 0.159.3 has
 * `-i, --image` on both `exec` and `exec resume`).
 */
export function codexExecArgs(
  args: AgentRunArgs,
  threadId: string | undefined,
  images: string[] = [],
): string[] {
  const cliArgs: string[] = ['exec', '--json'];
  if (args.model) cliArgs.push('--model', args.model);
  cliArgs.push(...codexEffortArgs(args.effort));
  cliArgs.push(...CODEX_SNAPSHOT_OFF_ARGS); // security: no env dump on disk (see above)
  cliArgs.push('--cd', args.cwd);
  cliArgs.push('--skip-git-repo-check');
  if (args.access === 'read') {
    // #388: codex's own read-only sandbox, whatever the role's git level —
    // a read turn is never danger-full-access.
    cliArgs.push('--sandbox', 'read-only');
  } else if (args.sandbox === 'read-only' || args.sandbox === 'workspace-write') {
    // #396: an explicit `agent exec --sandbox`, with full access too.
    cliArgs.push(...codexSandboxModeArgs(args.sandbox));
  } else if (args.access === 'full') {
    cliArgs.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    // #263: codex's own sandbox follows the role's policy.git level — only a
    // 'push' role still gets danger-full-access. See cli-sandbox.ts.
    cliArgs.push(...codexSandboxArgs(roleGitLevel(args.env), args.writableRoots));
  }
  if (threadId) {
    cliArgs.push('resume', threadId);
  }
  for (const image of images) cliArgs.push('--image', image);
  cliArgs.push('--', '-');
  return cliArgs;
}

/**
 * Run one `codex exec` invocation and stream its JSONL output
 * INCREMENTALLY: each parsed event is yielded as soon as its line arrives
 * on stdout (see the header's "Streaming / liveness" note for why
 * buffering until process exit was a bug, #204). End-of-turn facts (exit
 * code, stderr tail, thread id, usage, error, timeout flag) are written
 * into `outcome`, which the caller reads after this generator completes.
 * `idPrefix` keeps tool-call ids unique across spawns (codex restarts its
 * item numbering per process — codex-runner-tools.ts). `images` go to
 * `--image` (rev 32).
 */
export async function* streamTurn(
  bin: string,
  prompt: string,
  threadId: string | undefined,
  args: AgentRunArgs,
  outcome: TurnOutcome,
  idPrefix = '',
  images: string[] = [],
): AsyncGenerator<CodexStreamEvent> {
  const cliArgs = codexExecArgs(args, threadId, images);

  // Full access: own process group + tree tracking (process-group-spawn.ts),
  // so cancel reaches every descendant and agent-exec can report
  // background_pids. Any other access: a plain spawn, as before.
  // o-18: ambient ANTHROPIC_* creds never belong to a non-Anthropic vendor
  // CLI; an explicit value in args.env still wins below.
  const env = { ...omitAnthropicManagedKeys(process.env), ...args.env };
  restrictCodexHome(codexHomeDir(env)); // #535: rollouts/snapshots owner-only
  const proc = spawnRunnerProcess(
    ...maskedCommand(args.authorityMask, bin, cliArgs),
    { cwd: args.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] },
    args,
  );
  const child = proc.child;
  const toolItems = new CodexToolItems(idPrefix);
  // A CLI that exits before reading stdin (bad args, auth failure) makes
  // this write EPIPE — surfaced via the exit code/stderr below, not as an
  // unhandled stream error.
  child.stdin?.on('error', () => {});
  child.stdin?.end(prompt);

  let stderrTail = '';
  child.stderr?.on('data', (c: Buffer) => {
    stderrTail = (stderrTail + c.toString()).slice(-4000);
  });

  // SIGTERM→SIGKILL escalation, shared by the turn timeout, the abort
  // signal, and the abandoned-stream path in `finally` — a CLI that
  // ignores SIGTERM must not leak a zombie per turn.
  const KILL_GRACE_MS = 5000;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const killChild = (): void => {
    proc.target.kill('SIGTERM');
    killTimer = setTimeout(() => proc.target.kill('SIGKILL'), KILL_GRACE_MS);
    killTimer.unref?.();
  };

  // Arm the turn timeout BEFORE consuming stdout — a hung CLI must be
  // killed while we're still reading, not after it finishes.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killChild();
  }, TURN_TIMEOUT_MS);
  const unsubscribeAbort = killOnAbort(args.signal, proc.target, KILL_GRACE_MS);

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

  let lastThreadId: string | undefined = threadId;

  // Normalize one parsed wire event: capture the thread id from ANY event
  // that carries it (resume needs it on the next turn), record
  // error/usage state, and return the CodexStreamEvents to yield.
  const handleEvent = (ev: CodexEvent): CodexStreamEvent[] => {
    if ((ev.type === 'item.started' || ev.type === 'item.completed') && ev.item) {
      const tools = toolItems.onItem(
        ev.type === 'item.started' ? 'started' : 'completed',
        ev.item,
        lastThreadId,
      );
      if (tools.length > 0) {
        // Codex's own tool activity: matched start/end with canonical
        // inputs (codex-runner-tools.ts); an extra tree sample brackets
        // each call, as the claude runner does (#359).
        proc.sampleNow();
        return tools;
      }
    }
    const one = handleOne(ev);
    return one ? [one] : [];
  };
  // #550: input_tokens INCLUDES the cached part here; the runner splits it.
  const recordUsage = (u: CodexTokenUsage): void => {
    outcome.inputTokens = u.input_tokens ?? 0;
    outcome.outputTokens = u.output_tokens ?? 0;
    outcome.cachedInputTokens = u.cached_input_tokens ?? 0;
    outcome.cacheWriteInputTokens = u.cache_write_input_tokens ?? 0;
  };
  const handleOne = (ev: CodexEvent): CodexStreamEvent | null => {
    if (
      (ev.type === 'session_configured' || ev.type === 'thread.started') &&
      (ev.session_id || ev.thread_id)
    ) {
      // LEGACY: session_configured.session_id/.thread_id
      // CURRENT: thread.started.thread_id
      lastThreadId = ev.session_id ?? ev.thread_id;
      return null;
    }
    if (ev.type === 'agent_message' && ev.message) {
      // LEGACY: top-level agent_message.message — whole message, no delta
      // accumulation needed.
      const stripped = ev.message.replace(TOOL_CALL_RE, '').trim();
      return {
        kind: 'assistant',
        rawText: ev.message,
        text: stripped || undefined,
        threadId: lastThreadId,
      };
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) {
      // CURRENT: item.completed with item.type === 'agent_message' — same
      // whole-message shape as legacy, different envelope.
      const stripped = ev.item.text.replace(TOOL_CALL_RE, '').trim();
      return {
        kind: 'assistant',
        rawText: ev.item.text,
        text: stripped || undefined,
        threadId: lastThreadId,
      };
    }
    if (ev.type === 'token_count' && ev.info?.last_token_usage) {
      // LEGACY: last_token_usage is per-TURN; total_token_usage is
      // cumulative for the whole session — using the latter here would
      // over-report on every turn after the first.
      recordUsage(ev.info.last_token_usage);
      return null;
    }
    if (ev.type === 'turn.completed' && ev.usage) {
      // CURRENT: turn.completed.usage — observed to stay roughly flat
      // across resumed turns rather than accumulate, i.e. per-turn like
      // legacy's last_token_usage (see file header).
      recordUsage(ev.usage);
      return null;
    }
    if (ev.type === 'task_complete') {
      // LEGACY only — CURRENT has no observed equivalent completion event
      // carrying an error; see file header on error handling.
      if (ev.error) outcome.error = ev.error.message;
      // last_agent_message is a convenience summary already covered by the
      // agent_message events collected above — not surfaced again here to
      // avoid duplicating the same text.
      return null;
    }
    if (ev.type === 'turn.failed' && ev.error?.message) {
      // CURRENT: a failed turn (e.g. the API rejecting a request) — seen
      // live with codex-cli 0.156.1 right after a top-level `error` event.
      outcome.error = ev.error.message;
      return null;
    }
    if (ev.type === 'error' && ev.message) {
      outcome.error = ev.message;
      return null;
    }
    return null;
  };

  try {
    // Immediate liveness yield: session.ts races the FIRST pull against a
    // 4-minute silent-stream watchdog, and codex's first event can itself
    // take minutes (long thinking chains, large file reads). Yielding at
    // spawn wins that race deterministically instead of depending on
    // codex's latency.
    yield { kind: 'tool', toolName: 'turn started', threadId };

    let buf = '';
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      buf += chunk.toString();
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed?.startsWith('{')) continue;
        let ev: CodexEvent;
        try {
          ev = JSON.parse(trimmed) as CodexEvent;
        } catch {
          continue;
        }
        yield* handleEvent(ev);
      }
    }
    const tail = buf.trim();
    if (tail?.startsWith('{')) {
      let ev: CodexEvent | undefined;
      try {
        ev = JSON.parse(tail) as CodexEvent;
      } catch {
        /* not JSON, skip */
      }
      if (ev) yield* handleEvent(ev);
    }
    // Calls codex never completed before exiting get a failed end, so
    // every start has an end — unless this turn was aborted or timed out,
    // where the caller's own close (ToolActivityTracker.closeInFlight)
    // reports them as cancelled.
    if (!timedOut && !args.signal?.aborted) yield* toolItems.flush(lastThreadId);
  } finally {
    clearTimeout(timer);
    unsubscribeAbort();
    proc.stop();
    if (child.exitCode === null && child.signalCode === null) {
      // NOT confirmed dead. Either the consumer abandoned this stream
      // mid-turn (session.ts's silent abort calls iterator.return(), the
      // mailbox closes, or an error is thrown downstream) — kill it, WITH
      // the SIGKILL escalation — or a SIGTERM from the timeout/abort is
      // still inside its grace period: leave that escalation armed, since
      // clearing it here would orphan a CLI that ignores SIGTERM and then
      // wait on `exitPromise` forever (same fix as pi-rpc-runner.ts).
      // (`child.killed` stays false after a full-access group kill — the
      // signal goes to the tree, not this handle — hence the extra checks.)
      if (!child.killed && !killTimer && !args.signal?.aborted) killChild();
    } else if (killTimer) {
      clearTimeout(killTimer);
    }
  }

  const exitCode = await exitPromise;
  if (killTimer) clearTimeout(killTimer);
  outcome.threadId = lastThreadId;
  outcome.exitCode = exitCode;
  outcome.stderrTail = stderrTail;
  outcome.timedOut = timedOut;
}

/** Build the actionable error for a failed codex turn. */
export function turnError(outcome: TurnOutcome, round: number, _bin: string): Error {
  if (outcome.timedOut) {
    return new Error(
      `CodexAgentRunner: codex turn (tool round ${round}) exceeded the ${Math.round(TURN_TIMEOUT_MS / 60000)}min ` +
        `turn timeout and was killed.${outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''}`,
    );
  }
  // Fatal provider errors (auth/permission/quota — classified from the error
  // field AND stderr): report what actually happened, and tag the error so
  // the daemon does NOT restart into the same guaranteed failure (a restart
  // on quota exhaustion can only hang or fail again).
  const cls = classifyStderr(`${outcome.error ?? ''}\n${outcome.stderrTail}`);
  if (cls.fatal) {
    const err = new Error(
      `CodexAgentRunner: FATAL provider error (${cls.label}) on turn ${round} — not retrying.` +
        (outcome.error ? ` error: ${outcome.error}` : '') +
        (outcome.stderrTail ? ` stderr: ${outcome.stderrTail.slice(-500)}` : ''),
    );
    (err as Error & { fatal?: boolean }).fatal = true;
    return err;
  }
  return new Error(
    `CodexAgentRunner: codex exec failed (exit ${outcome.exitCode})` +
      (outcome.error ? `: ${outcome.error}` : '') +
      (outcome.stderrTail ? `\nstderr: ${outcome.stderrTail.slice(-500)}` : ''),
  );
}
