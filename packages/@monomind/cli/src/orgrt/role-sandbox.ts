// packages/@monomind/cli/src/orgrt/role-sandbox.ts
/**
 * OS-level enforcement of `policy.git` for claude-runtime roles (#258).
 *
 * The Claude Agent SDK can run the Bash tool inside an OS sandbox (bubblewrap
 * + socat on Linux, seatbelt on macOS). For roles below 'push' this module
 * builds that sandbox so the level holds even against a role that bypasses
 * the git guard env (git-guard.ts):
 *   - writes: the role's cwd, the org root, $HOME and the temp dir stay
 *     writable (installs, caches, test fixtures), minus the protected git dir
 *     ('read'/'none') or its config + hooks ('commit'), the guard's hooks,
 *     local-path remotes, and git/shell/Claude config that would undo the guard
 *     (a denied directory holding the cwd or ~/.claude goes in as its existing
 *     children, #323, unless it is the cwd and the runtime holds every stub
 *     in it — sandbox-deny-write.ts);
 *   - network: every host allowed (`policy.sandbox.allowedDomains`, default
 *     ['*']) minus the opt-in `policy.sandbox.deniedDomains`, deterministically,
 *     with local binding kept for dev servers and tests. Git remote hosts are
 *     not denied: read roles fetch, ls-remote and clone, and a forge's API
 *     would stay reachable anyway — the push barrier is withheld credentials;
 *   - reads of credential files (ssh keys, git-credentials, gh login, netrc).
 * Bash stays gated by canUseTool (autoAllowBashIfSandboxed: false) and
 * dangerouslyDisableSandbox is ignored (allowUnsandboxedCommands: false).
 * Write/Edit/Read run in-process, outside the sandbox, so matching permission
 * deny rules (`disallowedTools`) cover them — those need no sandbox at all.
 *
 * Availability (`policy.sandbox.mode`):
 *   'auto' (default) — sandbox when bwrap/socat (or seatbelt) are present;
 *                      otherwise run without it and emit a
 *                      `git-sandbox-unavailable` audit event (fail open, loud).
 *   'required'       — fail closed: the session refuses to start.
 *   'off'            — no sandbox; `git-sandbox-off` audit event.
 * `monomind org validate` reports the same findings before a run.
 */

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorityMaskArgs, authorityMaskAvailability } from './authority-mask.js';
import type { OrgBus } from './bus.js';
import { CLI_SANDBOX_MODES } from './cli-sandbox.js';
import { type GitLevel, gitCommonDir, prepareGitGuard } from './git-guard.js';
import { ORG_DISALLOWED_HARNESS_TOOLS } from './org-harness-tools.js';
import {
  buildClaudeRestrictions,
  type ClaudeRestrictions,
  type RoleSandboxPolicy,
  type SandboxAvailability,
  sandboxAvailability,
  uniq,
} from './role-sandbox-restrictions.js';
import { effectiveRoleRuntime } from './runner-specs.js';
import type { OrgDef, OrgRole } from './types.js';

export type {
  ClaudeRestrictions,
  RoleSandboxPolicy,
  SandboxAvailability,
} from './role-sandbox-restrictions.js';
export {
  buildClaudeRestrictions,
  sandboxAvailability,
} from './role-sandbox-restrictions.js';

const audited = new WeakMap<OrgBus, Set<string>>();
function auditOnce(
  bus: OrgBus,
  from: string,
  reason: string,
  msg: string,
  data: Record<string, unknown>,
) {
  const seen = audited.get(bus) ?? new Set<string>();
  audited.set(bus, seen);
  if (seen.has(`${from}:${reason}`)) return;
  seen.add(`${from}:${reason}`);
  bus.emit({ type: 'audit', from, reason, msg, data });
}

const safeSegment = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');

/**
 * The authority mask (authority-mask.ts) for a role the SDK sandbox does not
 * cover: a `push` role, a role whose sandbox is off or unavailable, or any
 * non-Claude CLI runtime. Undefined when the SDK sandbox already applies it,
 * for an in-process runtime (no shell), or when bubblewrap cannot run here —
 * the last one audited once, like `git-sandbox-unavailable` (fail open).
 */
export function roleAuthorityMask(args: {
  bus: OrgBus;
  roleId: string;
  inSdkSandbox: boolean;
  inProcess: boolean;
  cwd: string;
  orgRoot?: string;
  /** The role's `policy.fileWrite`: dirs it names under an org dir are created. */
  fileWrite?: string[];
  /** The role's signed `policy.sandbox.allowWrite`. */
  allowWrite?: string[];
  home?: string;
  env?: NodeJS.ProcessEnv;
  availability?: { available: boolean; reason?: string };
}): string[] | undefined {
  if (args.inSdkSandbox || args.inProcess) return undefined;
  const availability = args.availability ?? authorityMaskAvailability();
  if (!availability.available) {
    auditOnce(
      args.bus,
      args.roleId,
      'authority-mask-unavailable',
      `cannot hide human authority from role ${args.roleId} (${availability.reason}): it can read the operator credentials and the dashboard's human-auth secret. Decision gates and inbox entries stay protected by the daemon.`,
      { reason: availability.reason },
    );
    return undefined;
  }
  return authorityMaskArgs({
    home: args.home ?? homedir(),
    env: args.env ?? process.env,
    roots: [args.cwd, args.orgRoot],
    orgRoot: args.orgRoot,
    cwd: args.cwd,
    fileWrite: args.fileWrite,
    allowWrite: args.allowWrite,
  });
}

/**
 * Per-session enforcement for one role: the git guard env (every runtime) and,
 * for the Claude runtime, the SDK restrictions. Throws when
 * policy.sandbox.mode is 'required' and the sandbox cannot start.
 */
export function resolveRoleGitEnforcement(args: {
  org: string;
  role: OrgRole;
  cwd: string;
  orgRoot?: string;
  orgDir?: string;
  /** The current run, whose event log the SDK sandbox makes read-only. */
  run?: string;
  bus: OrgBus;
  claudeRuntime: boolean;
  runtime?: string;
  availability?: SandboxAvailability;
  /** Defaults to process.env; injectable for tests. */
  env?: NodeJS.ProcessEnv;
  /** Directories the role may not read (see buildClaudeRestrictions). */
  denyReadDirs?: string[];
  /** Directories the role may not write (see buildClaudeRestrictions). */
  denyWriteDirs?: string[];
  /** See buildClaudeRestrictions: called only when the sandbox is built. */
  holdStubs?: (writableRoots: string[]) => string[];
}): { env: Record<string, string>; claudeRestrictions?: ClaudeRestrictions } {
  const { role, bus } = args;
  const level = (role.policy?.git ?? 'read') as GitLevel;
  const stateDir = args.orgDir
    ? join(args.orgDir, 'git-guard', safeSegment(role.id))
    : join(tmpdir(), 'monomind-git-guard', safeSegment(args.org), safeSegment(role.id));
  const build = (excludeSandboxPlaceholders: boolean) =>
    prepareGitGuard({
      level,
      stateDir,
      excludeSandboxPlaceholders,
      protectedGitDirs: uniq([
        gitCommonDir(args.cwd),
        args.orgRoot ? gitCommonDir(args.orgRoot) : undefined,
      ]),
    });
  let guard = build(false);
  if (!guard)
    return args.claudeRuntime
      ? { env: {}, claudeRestrictions: { disallowedTools: [...ORG_DISALLOWED_HARNESS_TOOLS] } }
      : { env: {} };
  const data = { level, protectedGitDirs: guard.protectedGitDirs };

  if (!args.claudeRuntime) {
    const runtime = args.runtime ?? 'non-claude';
    // #263: codex and grok run their own OS sandbox at the role's level.
    const cliMode = CLI_SANDBOX_MODES[runtime];
    if (cliMode) {
      auditOnce(
        bus,
        role.id,
        'git-sandbox-cli',
        `policy.git '${level}' on runtime ${runtime} runs the CLI's own sandbox ('${cliMode}'): writes confined to the role's cwd and temp dir, $HOME and the rest of the filesystem read-only. It has no per-tool gate and no .git deny rules, so git itself still rests on the guard hooks and withheld credentials.`,
        data,
      );
    } else {
      auditOnce(
        bus,
        role.id,
        'git-sandbox-unsupported-runtime',
        `policy.git '${level}' on runtime ${runtime} is enforced only by git hooks and withheld credentials — no OS sandbox; a same-user role can bypass them`,
        data,
      );
    }
    // #262: an opencode role that ATTACHES to an already-running server
    // (OPENCODE_URL) loses the guard env too — that server is the operator's
    // own process, started before the session and outside its control. Only
    // the ephemeral server the runner spawns itself receives the env.
    if (args.runtime === 'opencode' && (args.env ?? process.env).OPENCODE_URL) {
      auditOnce(
        bus,
        role.id,
        'git-guard-unapplied',
        `policy.git '${level}' has NO enforcement for this role: it attaches to the opencode server at OPENCODE_URL, which cannot be given the guard env. Unset OPENCODE_URL so the role spawns its own server.`,
        data,
      );
    }
    return { env: guard.env };
  }

  const cfg = role.policy?.sandbox as RoleSandboxPolicy | undefined;
  const mode = cfg?.mode ?? 'auto';
  let sandboxEnabled = mode !== 'off';
  if (mode === 'off') {
    auditOnce(
      bus,
      role.id,
      'git-sandbox-off',
      `policy.sandbox.mode 'off': policy.git '${level}' runs without the OS sandbox — git hooks, withheld credentials and file-tool deny rules only`,
      data,
    );
  } else {
    const availability = args.availability ?? sandboxAvailability();
    if (!availability.available) {
      if (mode === 'required') {
        const msg = `policy.sandbox.mode 'required' but the OS sandbox is unavailable (${availability.reason}) — refusing to start role ${role.id}`;
        auditOnce(bus, role.id, 'git-sandbox-required', msg, data);
        throw new Error(msg);
      }
      auditOnce(
        bus,
        role.id,
        'git-sandbox-unavailable',
        `OS sandbox unavailable (${availability.reason}): policy.git '${level}' is enforced only by git hooks, withheld credentials and file-tool deny rules, which a same-user role can bypass. Set policy.sandbox.mode 'required' to refuse to run unsandboxed.`,
        data,
      );
      sandboxEnabled = false;
    }
  }
  // The sandbox drops zero-byte placeholder files into the role's cwd; hide
  // them from git so `git add -A` can't stage them (git-guard.ts).
  if (sandboxEnabled) guard = build(true) ?? guard;
  return {
    // Inside the sandbox all egress goes through the runtime's HTTP proxy,
    // which node's global fetch() ignores unless this is set — without it
    // `fetch('https://registry.npmjs.org/…')` in a role's `node -e` fails with
    // EAI_AGAIN (verified against the real sandbox). Curl, npm and git read the
    // proxy variables on their own. An operator value always wins.
    env: {
      ...guard.env,
      ...(sandboxEnabled && process.env.NODE_USE_ENV_PROXY === undefined
        ? { NODE_USE_ENV_PROXY: '1' }
        : {}),
    },
    claudeRestrictions: buildClaudeRestrictions(
      guard,
      cfg,
      {
        cwd: args.cwd,
        orgRoot: args.orgRoot,
        current: { org: args.org, run: args.run },
        holdStubs: args.holdStubs,
        denyReadDirs: args.denyReadDirs,
        denyWriteDirs: args.denyWriteDirs,
      },
      sandboxEnabled,
    ),
  };
}

/** `monomind org validate` findings: roles whose policy.git will not have the
 *  OS sandbox behind it on this host. */
export function gitEnforcementFindings(
  def: OrgDef,
  availability: SandboxAvailability = sandboxAvailability(),
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const unsupported: string[] = [];
  const cliSandboxed: string[] = [];
  const unsandboxed: string[] = [];
  const off: string[] = [];
  for (const role of def.roles) {
    if ((role as { kind?: string }).kind === 'endpoint') continue;
    const level = role.policy?.git ?? 'read';
    if (level === 'push') continue;
    const runtime = effectiveRoleRuntime(role.runtime, def.runtime, role.provider?.kind);
    const mode = (role.policy?.sandbox as RoleSandboxPolicy | undefined)?.mode ?? 'auto';
    if (CLI_SANDBOX_MODES[runtime])
      cliSandboxed.push(`${role.id} (${runtime}: ${CLI_SANDBOX_MODES[runtime]})`);
    else if (runtime !== 'claude') unsupported.push(`${role.id} (${runtime})`);
    else if (mode === 'off') off.push(role.id);
    else if (!availability.available && mode === 'required')
      errors.push(
        `role ${role.id}: policy.sandbox.mode 'required' but the OS sandbox is unavailable (${availability.reason}) — the role will refuse to start`,
      );
    else if (!availability.available) unsandboxed.push(role.id);
  }
  if (unsupported.length)
    warnings.push(
      `policy.git below 'push' has no OS sandbox on these runtimes — enforced only by git hooks and withheld credentials: ${unsupported.join(', ')}`,
    );
  if (cliSandboxed.length)
    warnings.push(
      `policy.git below 'push' runs the CLI's own sandbox on these roles — writes confined, but no per-tool gate and no .git deny rules: ${cliSandboxed.join(', ')}`,
    );
  if (unsandboxed.length)
    warnings.push(
      `OS sandbox unavailable on this host (${availability.reason}) — policy.git for ${unsandboxed.join(', ')} will run without it (set policy.sandbox.mode 'required' to refuse)`,
    );
  if (off.length)
    warnings.push(
      `policy.sandbox.mode 'off' for ${off.join(', ')} — policy.git runs without the OS sandbox`,
    );
  return { warnings, errors };
}
