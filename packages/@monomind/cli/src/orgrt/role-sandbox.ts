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
 *     local-path remotes, and git/shell/Claude config that would undo the guard;
 *   - network: every host allowed (`policy.sandbox.allowedDomains`, default
 *     ['*']) except the hosts the repository's remotes point at (plus
 *     `policy.sandbox.deniedDomains`), deterministically, with local binding
 *     kept for dev servers and tests;
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

import { accessSync, constants, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { OrgBus } from './bus.js';
import {
  type GitGuard,
  type GitLevel,
  gitCommonDir,
  gitRemoteTargets,
  prepareGitGuard,
} from './git-guard.js';
import type { OrgDef, OrgRole } from './types.js';

export interface RoleSandboxPolicy {
  mode?: 'auto' | 'required' | 'off';
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowWrite?: string[];
}

/** What ClaudeAgentRunner merges into the SDK's query() options. */
export interface ClaudeRestrictions {
  sandbox?: Record<string, unknown>;
  disallowedTools: string[];
}

export interface SandboxAvailability {
  available: boolean;
  reason?: string;
}

function onPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      /* not here */
    }
  }
  return false;
}

/** Whether the SDK sandbox can start for a CLI spawned with `env`. Mirrors the
 *  SDK's own dependency check, so 'auto' can decide before query() fails. */
export function sandboxAvailability(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): SandboxAvailability {
  if (platform === 'linux') {
    const missing = ['bwrap', 'socat'].filter((b) => !onPath(b, env));
    return missing.length
      ? {
          available: false,
          reason: `${missing.join(' and ')} not found on PATH (install bubblewrap and socat)`,
        }
      : { available: true };
  }
  if (platform === 'darwin') {
    try {
      accessSync('/usr/bin/sandbox-exec', constants.X_OK);
      return { available: true };
    } catch {
      return { available: false, reason: '/usr/bin/sandbox-exec not found' };
    }
  }
  return { available: false, reason: `the SDK sandbox is not supported on ${platform}` };
}

/** Files under $HOME that would undo the guard (git/shell/Claude config) —
 *  writable $HOME must not include them. */
const HOME_DENY_WRITE = [
  '.gitconfig',
  '.config/git',
  '.ssh',
  '.config/gh',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.zlogin',
  '.claude',
  '.claude.json',
];
/** Credential stores sandboxed commands may not read. */
const HOME_DENY_READ = [
  '.ssh',
  '.git-credentials',
  '.config/git/credentials',
  '.config/gh',
  '.netrc',
];

const uniq = (xs: Array<string | undefined>): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
];
/** Deny entries for paths that don't exist are dropped: the sandbox masks a
 *  missing path so that access() fails with EACCES instead of ENOENT, and git
 *  treats an unreadable ~/.gitconfig as fatal — every git command in the role
 *  would fail (observed against the real SDK sandbox). */
const existing = (xs: Array<string | undefined>): string[] => uniq(xs).filter((p) => existsSync(p));
/** Permission-rule form of an absolute path (`//abs/path`). */
const rule = (tool: string, abs: string) => `${tool}(/${abs})`;

export function buildClaudeRestrictions(
  guard: GitGuard,
  cfg: RoleSandboxPolicy | undefined,
  ctx: { cwd: string; orgRoot?: string; home?: string; tmp?: string },
  sandboxEnabled: boolean,
): ClaudeRestrictions {
  const home = ctx.home ?? homedir();
  const gitDirs = guard.protectedGitDirs;
  const remotes = gitDirs.map(gitRemoteTargets);
  const lockedRepo = guard.level === 'read' || guard.level === 'none';

  const disallowedTools = [
    rule('Edit', `${guard.dir}/**`),
    ...gitDirs.flatMap((d) =>
      lockedRepo
        ? [rule('Edit', `${d}/**`)]
        : [rule('Edit', join(d, 'config')), rule('Edit', `${join(d, 'hooks')}/**`)],
    ),
    ...(guard.level === 'none' ? gitDirs.map((d) => rule('Read', `${d}/**`)) : []),
  ];
  if (!sandboxEnabled) return { disallowedTools };

  const sandbox = {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    network: {
      allowedDomains: cfg?.allowedDomains ?? ['*'],
      deniedDomains: uniq([...remotes.flatMap((r) => r.hosts), ...(cfg?.deniedDomains ?? [])]),
      strictAllowlist: true,
      allowLocalBinding: true,
    },
    filesystem: {
      allowWrite: uniq([
        ctx.cwd,
        ctx.orgRoot,
        home,
        ctx.tmp ?? tmpdir(),
        ...(cfg?.allowWrite ?? []),
      ]),
      denyWrite: existing([
        guard.dir,
        ...(lockedRepo ? gitDirs : gitDirs.flatMap((d) => [join(d, 'config'), join(d, 'hooks')])),
        ...remotes.flatMap((r) => r.localPaths),
        ...HOME_DENY_WRITE.map((p) => join(home, p)),
      ]),
      denyRead: guard.level === 'none' ? existing(gitDirs) : [],
    },
    credentials: {
      files: existing(HOME_DENY_READ.map((p) => join(home, p))).map((path) => ({
        path,
        mode: 'deny',
      })),
    },
  };
  return { sandbox, disallowedTools };
}

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
  bus: OrgBus;
  claudeRuntime: boolean;
  runtime?: string;
  availability?: SandboxAvailability;
}): { env: Record<string, string>; claudeRestrictions?: ClaudeRestrictions } {
  const { role, bus } = args;
  const level = (role.policy?.git ?? 'read') as GitLevel;
  const stateDir = args.orgDir
    ? join(args.orgDir, 'git-guard', safeSegment(role.id))
    : join(tmpdir(), 'monomind-git-guard', safeSegment(args.org), safeSegment(role.id));
  const guard = prepareGitGuard({
    level,
    stateDir,
    protectedGitDirs: uniq([
      gitCommonDir(args.cwd),
      args.orgRoot ? gitCommonDir(args.orgRoot) : undefined,
    ]),
  });
  if (!guard) return { env: {} };
  const data = { level, protectedGitDirs: guard.protectedGitDirs };

  if (!args.claudeRuntime) {
    auditOnce(
      bus,
      role.id,
      'git-sandbox-unsupported-runtime',
      `policy.git '${level}' on runtime ${args.runtime ?? 'non-claude'} is enforced only by git hooks and withheld credentials — no OS sandbox; a same-user role can bypass them`,
      data,
    );
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
  return {
    env: guard.env,
    claudeRestrictions: buildClaudeRestrictions(
      guard,
      cfg,
      { cwd: args.cwd, orgRoot: args.orgRoot },
      sandboxEnabled,
    ),
  };
}

const PROVIDER_RUNTIME: Record<string, string> = {
  'vercel-api-key': 'vercel',
  codex: 'codex',
  antigravity: 'antigravity',
};

/** `monomind org validate` findings: roles whose policy.git will not have the
 *  OS sandbox behind it on this host. */
export function gitEnforcementFindings(
  def: OrgDef,
  availability: SandboxAvailability = sandboxAvailability(),
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const unsupported: string[] = [];
  const unsandboxed: string[] = [];
  const off: string[] = [];
  for (const role of def.roles) {
    if ((role as { kind?: string }).kind === 'endpoint') continue;
    const level = role.policy?.git ?? 'read';
    if (level === 'push') continue;
    const runtime =
      role.runtime ??
      def.runtime ??
      PROVIDER_RUNTIME[role.provider?.kind ?? ''] ??
      process.env.MONOMIND_RUNTIME ??
      'claude';
    const mode = (role.policy?.sandbox as RoleSandboxPolicy | undefined)?.mode ?? 'auto';
    if (runtime !== 'claude') unsupported.push(`${role.id} (${runtime})`);
    else if (mode === 'off') off.push(role.id);
    else if (!availability.available && mode === 'required')
      errors.push(
        `role ${role.id}: policy.sandbox.mode 'required' but the OS sandbox is unavailable (${availability.reason}) — the role will refuse to start`,
      );
    else if (!availability.available) unsandboxed.push(role.id);
  }
  if (unsupported.length)
    warnings.push(
      `policy.git below 'push' has no OS sandbox on non-claude runtimes — enforced only by git hooks and withheld credentials: ${unsupported.join(', ')}`,
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
