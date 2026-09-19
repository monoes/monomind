// packages/@monomind/cli/src/orgrt/file-roots.ts
/**
 * Single source of truth for what an in-process file tool (Read/Write/Edit/
 * Glob/Grep) may touch, shared between the OS-level Bash sandbox
 * (role-sandbox.ts) and the in-process PolicyEngine (policy.ts) so the two
 * boundaries cannot drift apart the way they did before #303: the sandbox
 * already made `$TMPDIR`, the org root and `policy.sandbox.allowWrite`
 * writable for Bash while the file tools stayed confined to `cwd` alone —
 * so a role could create a scratch file with Bash but not Read or Edit it.
 *
 * `$HOME` is deliberately NOT a file-tool root, even though the Bash sandbox
 * makes it writable (`role-sandbox.ts`'s `filesystem.allowWrite`): Bash needs
 * a writable `$HOME` for package-manager caches and installs; the file tools
 * do not, and every reproduction of the underlying issue happened under
 * `$TMPDIR`. Adding `$HOME` here would make the operator's entire home
 * directory — every other checkout, every note, everything outside the
 * HOME_DENY_* lists below — readable and editable by an autonomous role.
 * That is a far larger widening than the issue needed. If a future item
 * wants it, it needs its own justification; this module must not grow it
 * silently.
 */

import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** Files under $HOME that would undo the guard (git/shell/Claude config) —
 *  writable $HOME must not include them. Moved verbatim from
 *  role-sandbox.ts so the Bash sandbox and the file tools share one list. */
export const HOME_DENY_WRITE = [
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
/** Credential stores sandboxed commands (and the file tools) may not read. */
export const HOME_DENY_READ = [
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
export const DAEMON_SOCKETS = [
  '/run/dbus',
  '/run/docker.sock',
  '/var/run/docker.sock',
  '/run/podman/podman.sock',
  '/run/containerd/containerd.sock',
];

/** $XDG_RUNTIME_DIR, or the conventional /run/user/<uid> when it is unset. */
export function runtimeDir(env: NodeJS.ProcessEnv): string | undefined {
  if (env.XDG_RUNTIME_DIR && isAbsolute(env.XDG_RUNTIME_DIR)) return env.XDG_RUNTIME_DIR;
  const uid = process.getuid?.();
  return uid === undefined ? undefined : `/run/user/${uid}`;
}

const uniq = (xs: Array<string | undefined>): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
];

/** Roots the in-process file tools (Read/Write/Edit/Glob/Grep) may touch,
 *  beyond the role's own cwd (#303): the process temp dir, the org root, and
 *  any operator-granted `policy.sandbox.allowWrite` entries — the same
 *  extras the Bash sandbox already treats as writable. Deliberately excludes
 *  `$HOME` — see the module doc comment. Absolute-only (a relative entry
 *  can't be a root) and de-duplicated. */
export function fileToolRoots(
  ctx: { cwd: string; orgRoot?: string; env?: NodeJS.ProcessEnv },
  cfg?: { allowWrite?: string[] },
): string[] {
  const env = ctx.env ?? process.env;
  const tmp = env.TMPDIR || env.TMP || env.TEMP || tmpdir();
  return uniq([ctx.cwd, ctx.orgRoot, tmp, ...(cfg?.allowWrite ?? [])]).filter((p) => isAbsolute(p));
}

/** Paths denied inside ANY root — credentials, guard-undoing config, sockets,
 *  and the XDG runtime dir — regardless of which root admitted the path.
 *  #303's deny pass runs after root matching, not instead of it: today these
 *  are unreachable purely by accident (they sit outside `cwd`), and that
 *  accident vanishes the moment another root admits them — e.g. an operator
 *  setting `policy.sandbox.allowWrite: [$HOME]`. */
export function fileToolDenied(home: string, env: NodeJS.ProcessEnv): string[] {
  return uniq([
    ...HOME_DENY_READ.map((p) => join(home, p)),
    ...HOME_DENY_WRITE.map((p) => join(home, p)),
    ...DAEMON_SOCKETS,
    runtimeDir(env),
  ]);
}
