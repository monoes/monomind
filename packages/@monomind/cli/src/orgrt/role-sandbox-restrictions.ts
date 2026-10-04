// packages/@monomind/cli/src/orgrt/role-sandbox-restrictions.ts
import { accessSync, constants, existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { protectableDepsRoot } from '../utils/optional-deps.js';
import {
  authorityDirs,
  authorityFilePaths,
  CONTROL_FILES,
  DECISION_FILES,
  GIT_GUARD_DIR,
  ORG_STATE_FILES,
} from './authority-mask.js';
import { protectedClaudeBinary } from './claude-sdk.js';
import {
  DAEMON_SOCKETS,
  dashboardCredentialPaths,
  HOME_DENY_READ,
  HOME_DENY_WRITE,
  runtimeDir,
} from './file-roots.js';
import { type GitGuard, gitLocalRemotePaths } from './git-guard.js';
import { operatorMountPoints, operatorProtectedPaths } from './operator-protected-paths.js';
import { gitGuardDirs, orgsMountPoints } from './org-authority-files.js';
import { ORG_DISALLOWED_HARNESS_TOOLS } from './org-harness-tools.js';
import { expandDenyWrite, underAnyRoot } from './sandbox-deny-write.js';

export interface RoleSandboxPolicy {
  mode?: 'auto' | 'required' | 'off';
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowWrite?: string[];
  denyWrite?: string[];
  denyExec?: string[];
  denyRead?: string[];
  homeWriteAllow?: string[];
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

export const uniq = (xs: Array<string | undefined>): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
];
/** Deny entries for paths that don't exist are dropped: the sandbox masks a
 *  missing path so that access() fails with EACCES instead of ENOENT, and git
 *  treats an unreadable ~/.gitconfig as fatal — every git command in the role
 *  would fail (observed against the real SDK sandbox). */
const existing = (xs: Array<string | undefined>): string[] =>
  uniq(
    uniq(xs)
      .filter((p) => existsSync(p))
      .map(maskTarget),
  );
/** #526, macOS: seatbelt (sandbox-exec) denies by path rule, so a deny for
 *  a path that does not exist yet also denies creating it; nothing has to
 *  exist, unlike bwrap's binds. Kept only when the parent exists: the SDK
 *  also denies creating or unlinking every ancestor of a denied path, and a
 *  missing ancestor (~/.config for ~/.config/npm) would become uncreatable.
 *  The parent is resolved, as seatbelt matches resolved paths. */
const seatbeltDenyWrite = (xs: string[]): string[] =>
  uniq(
    uniq(xs).map((p) => {
      if (existsSync(p)) return p;
      try {
        return join(realpathSync(dirname(p)), basename(p));
      } catch {
        return undefined;
      }
    }),
  );
/** bwrap cannot bind over a path inside a directory it cannot list ("Can't
 *  mkdir parents … Permission denied" — /run/containerd is drwx--x--x on a
 *  stock docker host), and that failure kills every sandboxed Bash call. Mask
 *  the whole directory instead, which hides at least as much. */
function maskTarget(p: string): string {
  const parent = dirname(p);
  try {
    accessSync(parent, constants.R_OK);
    return p;
  } catch {
    return parent;
  }
}
/** Permission-rule form of an absolute path (`//abs/path`). */
const rule = (tool: string, abs: string) => `${tool}(/${abs})`;

export function buildClaudeRestrictions(
  guard: GitGuard,
  cfg: RoleSandboxPolicy | undefined,
  ctx: {
    cwd: string;
    orgRoot?: string;
    /** The org and run this role runs in: that run's event log is denied. */
    current?: { org: string; run?: string };
    home?: string;
    tmp?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    /** Directories this role may not read (GA row R3: other roles' mail digests). */
    denyReadDirs?: string[];
    /** Linux: holds the sandbox's mount-point stubs for these writable roots
     *  (sandbox-stubs.ts) and returns the stub paths still not in place. */
    holdStubs?: (writableRoots: string[]) => string[];
  },
  sandboxEnabled: boolean,
): ClaudeRestrictions {
  const home = ctx.home ?? homedir();
  const tmp = ctx.tmp ?? tmpdir();
  const env = ctx.env ?? process.env;
  const unixSockets = cfg?.allowUnixSockets ?? true;
  const gitDirs = guard.protectedGitDirs;
  const lockedRepo = guard.level === 'read' || guard.level === 'none';
  // Operator-declared read-only paths (e.g. a QA role must never write into
  // the checkout it tests from). Relative paths resolve against the org root.
  const roleDenyWrite = (cfg?.denyWrite ?? []).map((p) => resolve(ctx.orgRoot ?? ctx.cwd, p));
  // #502 review: what the operator's own processes run or trust
  // (operator-protected-paths.ts), unless a signed allowWrite opts in.
  const operatorPaths = operatorProtectedPaths({
    home,
    env,
    orgRoot: ctx.orgRoot,
    cwd: ctx.cwd,
    allowWrite: cfg?.allowWrite,
  });

  const disallowedTools = [
    ...ORG_DISALLOWED_HARNESS_TOOLS,
    rule('Edit', `${guard.dir}/**`),
    ...gitDirs.flatMap((d) =>
      lockedRepo
        ? [rule('Edit', `${d}/**`)]
        : [rule('Edit', join(d, 'config')), rule('Edit', `${join(d, 'hooks')}/**`)],
    ),
    ...(guard.level === 'none' ? gitDirs.map((d) => rule('Read', `${d}/**`)) : []),
    // Human-authority credentials: the dashboard token in the project's
    // .monomind/ and the operator credentials (file-roots.ts).
    ...uniq([ctx.cwd, ctx.orgRoot]).flatMap((r) => [
      rule('Read', join(r, '.monomind', 'dashboard-token*')),
      rule('Edit', join(r, '.monomind', 'dashboard-token*')),
    ]),
    ...authorityDirs(home, env).flatMap((d) => [rule('Read', `${d}/**`), rule('Edit', `${d}/**`)]),
    ...roleDenyWrite.flatMap((d) => [rule('Edit', d), rule('Edit', `${d}/**`)]),
    ...(ctx.denyReadDirs ?? []).flatMap((d) => [rule('Read', d), rule('Read', `${d}/**`)]),
    ...operatorPaths.flatMap((d) => [rule('Edit', d), rule('Edit', `${d}/**`)]),
    // Authority files: the org definitions, the decision files and the
    // daemon's state (authority-mask.ts, #498). policy.ts's isAuthorityFile
    // is the complete check; these name the known files for the SDK too.
    ...(ctx.orgRoot
      ? [
          ...['*.json', '*.jsonl', '*.yaml', '*.yml'],
          ...[...DECISION_FILES, ...ORG_STATE_FILES, ...CONTROL_FILES].map((f) => join('*', f)),
          `${join('*', GIT_GUARD_DIR)}/**`,
        ].map((f) => rule('Edit', join(ctx.orgRoot as string, '.monomind', 'orgs', f)))
      : []),
  ];
  if (!sandboxEnabled) return { disallowedTools };

  const allowWrite = uniq([ctx.cwd, ctx.orgRoot, home, tmp, ...(cfg?.allowWrite ?? [])]);
  // #518 review (B1): the deps dir must exist to be denied (only existing
  // paths are passed below on Linux), and its parent becomes a mount point so
  // the role cannot rename ~/.monomind aside and plant a new deps dir; the
  // directories above a custom MONOMIND_HOME are among #527's
  // operatorMountPoints. On macOS the SDK's seatbelt already denies
  // unlinking every ancestor of a denied path (#526).
  const deps = protectableDepsRoot(env, home);
  // #522: an operator-chosen Claude Code the daemons run: its file is in
  // operatorPaths; the directories above it become mount points (below).
  const claudeAnchors = protectedClaudeBinary(env, home)?.dirs ?? [];
  const platform = ctx.platform ?? process.platform;
  // Stubs first: with all of the cwd's in place, bwrap creates nothing there.
  const missingStubs = platform === 'linux' ? ctx.holdStubs?.(allowWrite) : undefined;
  const cwdClaude = join(ctx.cwd, '.claude');
  const cwdClaudeStubsHeld =
    !!missingStubs &&
    !missingStubs.some((s) => s === cwdClaude || s.startsWith(`${cwdClaude}${sep}`));
  // #323: a read-only directory holding the cwd or ~/.claude breaks the SDK's
  // own stub mounts — pass its children instead, unless it is the cwd and the
  // runtime holds every stub in it (sandbox-deny-write.ts).
  const expanded = expandDenyWrite(
    uniq([
      guard.dir,
      ...(lockedRepo ? gitDirs : gitDirs.flatMap((d) => [join(d, 'config'), join(d, 'hooks')])),
      ...gitDirs.flatMap(gitLocalRemotePaths),
      ...HOME_DENY_WRITE.map((p) => join(home, p)),
      ...(deps ? [deps] : []),
      ...authorityFilePaths(ctx.orgRoot, ctx.current),
      // Every role's guard dir, not only this one's (#498).
      ...gitGuardDirs(ctx.orgRoot),
      ...roleDenyWrite,
      // #502 review: the operator key and signatures must not be replaceable
      // either — where the SDK's read deny does not stop writes (macOS), a
      // role could otherwise plant a key it knows.
      ...authorityDirs(home, env),
      ...operatorPaths,
    ]),
    // The cwd's .claude holds some of the SDK's own stubs: unless the
    // runtime holds every one of them, it is expanded, not a plain deny.
    [ctx.cwd, join(home, '.claude'), ...(cwdClaudeStubsHeld ? [] : [cwdClaude])],
    ctx.platform,
    missingStubs && { cwd: ctx.cwd, writableRoots: allowWrite, missingStubs },
  );
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
      allowWrite: uniq([
        ...allowWrite,
        ...expanded.mountPoints.filter((d) => underAnyRoot(d, allowWrite)),
        // #498: mount points, so the orgs tree cannot be renamed aside.
        // The SDK binds denyWrite after allowWrite, so a writable dir below a
        // denied one would stay read-only: the orgs dir itself cannot be
        // denied here, and new files in it stay possible (authority-mask.ts).
        ...orgsMountPoints(ctx.orgRoot).filter((d) => underAnyRoot(d, allowWrite)),
        ...(deps ? [dirname(deps)] : []).filter((d) => underAnyRoot(d, allowWrite)),
        // #527: the directories on the way to the operator-protected paths
        // (`~/.local/share` above mise…), so none can be renamed aside.
        ...operatorMountPoints({
          home,
          env,
          orgRoot: ctx.orgRoot,
          cwd: ctx.cwd,
          allowWrite: cfg?.allowWrite,
        }).filter((d) => underAnyRoot(d, allowWrite)),
        ...claudeAnchors.filter((d) => underAnyRoot(d, allowWrite)),
      ]),
      denyWrite:
        platform === 'darwin'
          ? seatbeltDenyWrite(expanded.denyWrite)
          : existing(expanded.denyWrite),
      denyRead: existing([
        ...(guard.level === 'none' ? gitDirs : []),
        runtimeDir(env),
        ...(unixSockets ? agentSocketPaths(home, env, tmp) : []),
        ...dashboardCredentialPaths([ctx.cwd, ctx.orgRoot]),
        ...authorityDirs(home, env),
        ...(ctx.denyReadDirs ?? []),
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
