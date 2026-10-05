// packages/@monomind/cli/src/orgrt/runner-sandbox.ts
/**
 * `agent exec --sandbox` (#396, rev 23; more modes and `--sandbox-fallback`
 * #482, rev 26) and the truthful `native_sandbox` / `approvals` report on the
 * `start` event and in `agent scan --json`.
 *
 * Vocabulary (doc/agent-exec-protocol.md §3.2):
 *   native_sandbox
 *     read-only        the vendor CLI refuses every file write and every
 *                      shell command (its own sandbox, or its own deny rules)
 *     workspace-write  the vendor CLI confines writes to the cwd (and the
 *                      CLI's temp/state dirs)
 *     restricted       #482: the CLI's own approval rules apply and anything
 *                      they would ask about is refused (headless). What that
 *                      covers is the CLI's rule set, incl. the user's own
 *                      allow rules — not a file-system boundary
 *     full             the runtime has a native sandbox and it is OFF this
 *                      turn (e.g. codex danger-full-access, grok `off`)
 *     none             the runtime has no native sandbox monomind drives;
 *                      the CLI runs with the user's own file-system rights
 *     monomind         claude only: no vendor sandbox, monomind enforces
 *                      the access mode itself (canUseTool + PreToolUse)
 *   approvals
 *     off   native tool calls run without asking (yolo/always-approve)
 *     on    the CLI's own approval rules apply; a call that would ask is
 *           refused, since a headless turn has nobody to answer
 *     n/a   no native approval step (claude: monomind decides each call;
 *           vercel: no native tools)
 *
 * Strictness, tightest first: read-only > restricted > workspace-write > full
 * (SANDBOX_RANK). `restricted` sits above workspace-write because every CLI
 * that has it refuses shell commands and file edits under its default rules
 * (antigravity still writes its own temp dir), but below read-only because
 * the user's own allow rules (and, for opencode, an agent's own permission
 * block) can widen it.
 *
 * `--sandbox full` is always accepted and means "today's default": monomind
 * adds no native sandbox. It never loosens a runtime whose own default is
 * tighter (dsh stays workspace-write). The other modes are listed only where
 * the vendor CLI really has them and they were checked:
 *   codex    — `--sandbox read-only|workspace-write` (codex-cli 0.156 --help;
 *              behaviour verified with `codex sandbox`, see cli-sandbox.ts).
 *   grok     — `--sandbox read-only|workspace` profiles (grok 1.0.13: both
 *              resolve and start the Landlock/bwrap sandbox, an unknown
 *              profile is rejected — see cli-sandbox.ts).
 *   dsh      — DSH_PERMISSION_MODE `read-only|workspace-write` (dsh-runner-
 *              stream.ts, captured live when the runner was built).
 *   copilot  — #482, copilot 1.0.89, live: without --allow-all-tools a tool
 *              call that needs approval is refused ("Permission denied and
 *              could not request permission from user"): `restricted`.
 *              `--deny-tool=write --deny-tool=shell` (deny beats every allow
 *              rule, `copilot help permissions`): `read-only`.
 *              `--allow-tool=write --deny-tool=shell` without
 *              --allow-all-paths: edits only under the cwd, --add-dir and
 *              the temp dir (an absolute path outside and a symlink out of
 *              the cwd were both refused), no shell: `workspace-write`.
 *   antigravity — #482, agy 1.2.13, live: without
 *              --dangerously-skip-permissions shell commands and file writes
 *              are auto-denied, in the cwd too (only the temp dir is
 *              writable by agy's default rules), and the turn then ends
 *              with no reply: `restricted`. Its `--sandbox`
 *              switch failed here ("connecting to sandbox server") and the
 *              model retried with the sandbox bypassed, so it is not used.
 *   opencode — #482, opencode 1.18.32, live: OPENCODE_PERMISSION set to
 *              `ask` for edit/bash/task/external_directory, every ask
 *              rejected: `restricted` (not read-only: an agent's own
 *              `permission` block in the user's or project's opencode.json
 *              overrides it — verified).
 *   pi       — #482: `--tools read,grep,find,ls` (pi's documented read-only
 *              mode, already `--access read`, #388): `read-only`.
 *   claude   — #482: scoped/read access only. monomind's canUseTool +
 *              PreToolUse gate runs no native tool that is not allow-listed,
 *              so no native Write/Edit/NotebookEdit ever runs and Bash runs
 *              only the caller's --allow-bash-prefix commands: `read-only`
 *              and `workspace-write` (native_sandbox "monomind").
 * Not the others: qwen/kimicode/cline/aider are not installed here
 * (unverified), crush and hermes have no mode monomind can drive headless.
 */

import { roleGitLevel } from './cli-sandbox.js';
import type { RuntimeKind } from './daemon.js';
import type { GitLevel } from './git-guard.js';

export type SandboxMode = 'read-only' | 'restricted' | 'workspace-write' | 'full';
export const SANDBOX_MODES: readonly SandboxMode[] = [
  'read-only',
  'restricted',
  'workspace-write',
  'full',
];
export type NativeSandbox = SandboxMode | 'none' | 'monomind';
export type Approvals = 'off' | 'on' | 'n/a';
export interface SandboxReport {
  native_sandbox: NativeSandbox;
  approvals: Approvals;
}

/** #482: what to do when the runtime lacks the requested `--sandbox` mode. */
export type SandboxFallback = 'fail' | 'strictest' | 'run';
export const SANDBOX_FALLBACKS: readonly SandboxFallback[] = ['fail', 'strictest', 'run'];

const FS: readonly SandboxMode[] = ['read-only', 'workspace-write', 'full'];
const FULL: readonly SandboxMode[] = ['full'];
const RESTRICTED: readonly SandboxMode[] = ['restricted', 'full'];
const READ_ONLY: readonly SandboxMode[] = ['read-only', 'full'];

/** The `--sandbox` values each runtime accepts (`agent scan --json` sandbox_modes). */
export const RUNNER_SANDBOX_MODES: Record<RuntimeKind, readonly SandboxMode[]> = {
  freebuff: [],
  kilo: FULL,
  claude: FS, // scoped/read access only — see sandboxModes()
  codex: FS,
  grok: FS,
  dsh: FS,
  opencode: RESTRICTED,
  vercel: FULL,
  antigravity: RESTRICTED,
  kimicode: FULL,
  qwen: FULL,
  'qwen-rpc': FULL,
  crush: FULL,
  copilot: SANDBOX_MODES,
  pi: READ_ONLY,
  'pi-rpc': READ_ONLY,
  hermes: FULL,
  cline: FULL,
  aider: FULL,
};

/** The accepted modes; claude with `--access full` has only `full` (the
 *  allow-list is off and the SDK sandbox is not wired into agent exec). */
export function sandboxModes(
  runtime: string,
  access: 'scoped' | 'read' | 'full' = 'scoped',
): readonly SandboxMode[] {
  if (runtime === 'claude' && access === 'full') return FULL;
  return RUNNER_SANDBOX_MODES[runtime as RuntimeKind] ?? FULL;
}

/** Tightest first (see the module doc). */
export const SANDBOX_RANK: Record<SandboxMode, number> = {
  'read-only': 0,
  restricted: 1,
  'workspace-write': 2,
  full: 3,
};

/**
 * #482 `--sandbox-fallback strictest`: the requested mode when the runtime
 * has it; else the loosest supported mode that is still at least as strict
 * (so nothing is loosened and as much of the request as possible is kept);
 * else — every supported mode is looser — the tightest one there is.
 */
export function strictestFallback(
  requested: SandboxMode,
  modes: readonly SandboxMode[],
): SandboxMode {
  const byRank = [...modes].sort((a, b) => SANDBOX_RANK[a] - SANDBOX_RANK[b]);
  const atLeast = byRank.filter((m) => SANDBOX_RANK[m] <= SANDBOX_RANK[requested]);
  return atLeast.length ? atLeast[atLeast.length - 1] : byRank[0];
}

const GIT_LEVEL_CAPPED = new Set(['codex', 'grok', 'dsh']);

export interface ResolvedSandbox {
  /** The mode handed to the runner, reported as `sandbox_applied`
   *  (undefined = no `--sandbox`). */
  mode?: SandboxMode;
  error?: string;
  /** Why `mode` differs from the request (a `status` notice), if it does. */
  notice?: string;
}

/**
 * The mode a turn really runs in for `--sandbox <requested>`. A mode the
 * runtime lacks is an error under `fallback: 'fail'` (the default), else
 * replaced (`strictest`, or `full` = the runtime default for `run`) with a
 * notice. An org role below 'push' (MONOMIND_GIT_LEVEL in `--env` or in
 * monomind's own env) then runs codex/grok in workspace-write
 * (cli-sandbox.ts); the flag may tighten that but never loosen it.
 */
export function resolveSandbox(
  runtime: string,
  requested: SandboxMode | undefined,
  envs: Array<Record<string, string | undefined> | undefined>,
  opts: { fallback?: SandboxFallback; access?: 'scoped' | 'read' | 'full' } = {},
): ResolvedSandbox {
  if (requested === undefined) return {};
  const modes = sandboxModes(runtime, opts.access);
  let applied = requested;
  let why = '';
  if (!modes.includes(requested)) {
    const fallback = opts.fallback ?? 'fail';
    const where = runtime === 'claude' && opts.access === 'full' ? ' with --access full' : '';
    const listed = where
      ? `modes with --access full: ${modes.join(', ')}`
      : `agent scan --json sandbox_modes: ${modes.join(', ')}`;
    if (fallback === 'fail') {
      return {
        error: `--sandbox ${requested} is not supported by runtime "${runtime}"${where} (${listed})`,
      };
    }
    applied = fallback === 'strictest' ? strictestFallback(requested, modes) : 'full';
    why = `--sandbox ${requested} is not supported${where} (${listed}); --sandbox-fallback ${fallback}`;
  }
  const gitRestricted = envs.some(
    (e) => roleGitLevel(e as Record<string, string> | undefined) !== 'push',
  );
  // Only the runtimes whose runner follows the git level itself (rev 23).
  const capped = gitRestricted && GIT_LEVEL_CAPPED.has(runtime);
  if (capped && SANDBOX_RANK[applied] > SANDBOX_RANK['workspace-write']) {
    applied = 'workspace-write';
    why += `${why ? ', then ' : `--sandbox ${requested}: `}the org role's git level (MONOMIND_GIT_LEVEL below push) keeps ${runtime} at workspace-write`;
  }
  if (applied === requested) return { mode: applied };
  const how =
    applied === 'full'
      ? 'running with the runtime default (no sandbox mode applied)'
      : `running with --sandbox ${applied}`;
  return { mode: applied, notice: `${runtime}: ${why}; ${how}` };
}

/**
 * What the vendor CLI really runs with this turn. `sandbox` is the mode
 * handed to the runner (undefined = no `--sandbox`); `env` is the runner's
 * env (MONOMIND_GIT_LEVEL / DSH_PERMISSION_MODE are read from it, as the
 * runners do).
 */
export function sandboxReport(
  runtime: string,
  opts: {
    access: 'scoped' | 'read' | 'full';
    sandbox?: SandboxMode;
    env?: Record<string, string>;
  },
): SandboxReport {
  const { access, sandbox } = opts;
  const narrowed = sandbox && sandbox !== 'full' ? sandbox : undefined;
  const level: GitLevel = roleGitLevel(opts.env);
  switch (runtime) {
    case 'claude':
      return access === 'full'
        ? { native_sandbox: 'full', approvals: 'off' }
        : { native_sandbox: 'monomind', approvals: 'n/a' };
    case 'codex':
    case 'grok': {
      // codex exec never asks (approval "never"); grok runs --always-approve.
      if (runtime === 'codex' && access === 'read')
        return { native_sandbox: 'read-only', approvals: 'off' };
      if (narrowed) return { native_sandbox: narrowed, approvals: 'off' };
      if (access === 'full') return { native_sandbox: 'full', approvals: 'off' };
      return {
        native_sandbox: level === 'push' ? 'full' : 'workspace-write',
        approvals: 'off',
      };
    }
    case 'dsh': {
      // DSH_PERMISSION_MODE sets both dsh's sandbox and its approval policy:
      // danger-full-access = approval never; the others = ask (fails closed).
      if (narrowed) return { native_sandbox: narrowed, approvals: 'on' };
      if (access === 'full') return { native_sandbox: 'full', approvals: 'off' };
      return {
        native_sandbox:
          opts.env?.DSH_PERMISSION_MODE === 'read-only' ? 'read-only' : 'workspace-write',
        approvals: 'on',
      };
    }
    case 'copilot':
    case 'antigravity':
      // #482: no --allow-all-tools / --dangerously-skip-permissions; copilot
      // adds deny (and for workspace-write, allow) rules — copilot-runner-stream.ts.
      if (narrowed) return { native_sandbox: narrowed, approvals: 'on' };
      return { native_sandbox: 'none', approvals: 'off' };
    case 'pi':
    case 'pi-rpc':
      // #482: --tools read,grep,find,ls (pi never asks).
      if (narrowed || access === 'read') return { native_sandbox: 'read-only', approvals: 'off' };
      return { native_sandbox: 'none', approvals: 'off' };
    case 'opencode':
      // #482: restricted = edit/bash/task/external_directory ask, asks rejected.
      if (narrowed) return { native_sandbox: narrowed, approvals: 'on' };
      return { native_sandbox: 'none', approvals: access === 'full' ? 'off' : 'on' };
    case 'cline':
      // Scoped: the CLI's own permission rules, and what asks is refused.
      return { native_sandbox: 'none', approvals: access === 'full' ? 'off' : 'on' };
    case 'hermes':
      // No --yolo: hermes's dangerous-command approval stays on.
      return { native_sandbox: 'none', approvals: 'on' };
    case 'freebuff':
      return { native_sandbox: 'none', approvals: 'n/a' };
    case 'kilo':
      return { native_sandbox: 'none', approvals: access === 'full' ? 'off' : 'n/a' };
    case 'vercel':
      return { native_sandbox: 'none', approvals: 'n/a' };
    default:
      // qwen --yolo, kimicode/crush (never ask), aider --yes-always.
      return { native_sandbox: 'none', approvals: 'off' };
  }
}

/** #482 scan field: what each accepted mode reports on a scoped turn. */
export function sandboxModeReports(runtime: string): Partial<Record<SandboxMode, SandboxReport>> {
  return Object.fromEntries(
    sandboxModes(runtime).map((m) => [
      m,
      sandboxReport(runtime, { access: runtime === 'kilo' ? 'full' : 'scoped', sandbox: m }),
    ]),
  );
}
