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

import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { OrgBus } from './bus.js';
import {
  type GitGuard,
  type GitLevel,
  gitCommonDir,
  gitLocalRemotePaths,
  prepareGitGuard,
} from './git-guard.js';
import type { OrgDef, OrgRole } from './types.js';

export interface RoleSandboxPolicy {
  mode?: 'auto' | 'required' | 'off';
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowWrite?: string[];
  allowUnixSockets?: boolean;
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

/** Sockets and runtime dirs a role must not reach. The XDG runtime dir is the
 *  important one: it carries the session D-Bus, and through it the login
 *  keyring — `gh auth token` returns the operator's GitHub token from there,
 *  which is a push credential (verified inside the real sandbox). It is denied
 *  whether or not unix sockets are allowed, because it holds credential files
 *  too, and the SDK's own default deny of /run/user does not survive passing
 *  our own `filesystem` block. */
const DAEMON_SOCKETS = [
  '/run/dbus',
  '/run/docker.sock',
  '/var/run/docker.sock',
  '/run/podman/podman.sock',
  '/run/containerd/containerd.sock',
];

/** Agent sockets that would hand a role push credentials, plus the X11 socket
 *  dir (desktop input injection). Only relevant while unix sockets are
 *  reachable — see `policy.sandbox.allowUnixSockets`, which is true by default
 *  because Chrome's process singleton needs a socket ("socket() failed:
 *  Operation not permitted" kills `monomind browse` otherwise). */
function agentSocketPaths(home: string, env: NodeJS.ProcessEnv, tmp: string): string[] {
  const paths = [
    env.SSH_AUTH_SOCK && isAbsolute(env.SSH_AUTH_SOCK) ? env.SSH_AUTH_SOCK : undefined,
    join(home, '.1password'),
    '/tmp/.X11-unix',
    ...DAEMON_SOCKETS,
  ];
  for (const dir of [tmp, '/tmp']) {
    try {
      for (const e of readdirSync(dir)) if (e.startsWith('ssh-')) paths.push(join(dir, e));
    } catch {
      /* unreadable temp dir — nothing to mask there */
    }
  }
  return paths.filter((p): p is string => !!p);
}

/** $XDG_RUNTIME_DIR, or the conventional /run/user/<uid> when it is unset. */
function runtimeDir(env: NodeJS.ProcessEnv): string | undefined {
  if (env.XDG_RUNTIME_DIR && isAbsolute(env.XDG_RUNTIME_DIR)) return env.XDG_RUNTIME_DIR;
  const uid = process.getuid?.();
  return uid === undefined ? undefined : `/run/user/${uid}`;
}

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
  ctx: { cwd: string; orgRoot?: string; home?: string; tmp?: string; env?: NodeJS.ProcessEnv },
  sandboxEnabled: boolean,
): ClaudeRestrictions {
  const home = ctx.home ?? homedir();
  const tmp = ctx.tmp ?? tmpdir();
  const unixSockets = cfg?.allowUnixSockets ?? true;
  const gitDirs = guard.protectedGitDirs;
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
      deniedDomains: uniq(cfg?.deniedDomains ?? []),
      strictAllowlist: true,
      allowLocalBinding: true,
      allowAllUnixSockets: unixSockets,
    },
    filesystem: {
      allowWrite: uniq([ctx.cwd, ctx.orgRoot, home, tmp, ...(cfg?.allowWrite ?? [])]),
      denyWrite: existing([
        guard.dir,
        ...(lockedRepo ? gitDirs : gitDirs.flatMap((d) => [join(d, 'config'), join(d, 'hooks')])),
        ...gitDirs.flatMap(gitLocalRemotePaths),
        ...HOME_DENY_WRITE.map((p) => join(home, p)),
      ]),
      denyRead: existing([
        ...(guard.level === 'none' ? gitDirs : []),
        runtimeDir(ctx.env ?? process.env),
        ...(unixSockets ? agentSocketPaths(home, ctx.env ?? process.env, tmp) : []),
      ]),
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
