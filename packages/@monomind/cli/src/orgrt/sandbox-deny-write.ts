// packages/@monomind/cli/src/orgrt/sandbox-deny-write.ts
/**
 * #323: deny-write directories the SDK sandbox (bubblewrap) can live with.
 *
 * The Claude Agent SDK adds its own write-denies for "dangerous files"
 * relative to the role's cwd (.gitconfig, .bashrc, .mcp.json, .claude/…) and
 * under ~/.claude (settings, hooks, skills, commands, ide, local, …). For one
 * that does not exist it binds /dev/null onto the path, so bwrap must create
 * a 0-byte mount-point file first. When monomind hands the SDK a read-only
 * directory that contains such a path — `policy.sandbox.denyWrite: ["."]`
 * resolves to the org root, which is (or contains) every role's cwd, and
 * HOME_DENY_WRITE has ".claude" — bwrap dies with "Can't create file …:
 * Read-only file system" and the role's Bash call fails. It only worked while
 * another sandboxed process happened to hold the stub.
 *
 * So such a directory is never passed as a deny. It is replaced by its
 * existing children, each read-only (a child that itself contains the cwd or
 * ~/.claude is expanded the same way), and the directory itself is returned
 * as a mount point for `filesystem.allowWrite`: bind-mounted, it cannot be
 * renamed or removed (EBUSY), while bwrap can create the SDK's stubs in it.
 *
 * What becomes writable at the OS layer: NEW entries directly inside such a
 * directory (a new top-level file in the org root or ~/.claude), and the
 * directory's own mode bits. Everything that existed at session start stays
 * read-only — an existing entry is a mount point, so it cannot be rewritten,
 * unlinked, renamed or replaced. The Claude-Code-critical new names (settings,
 * hooks, skills, commands, agents, .mcp.json, .gitconfig, …) are the SDK's own
 * denies, now enforceable because their stubs can be created. The file tools
 * never relied on this layer: their permission rules (`Edit(//dir/**)`) and
 * the PolicyEngine deny lists keep the unexpanded directory.
 *
 * An empty regular file among those children is left out: it is one of
 * those stubs, which the SDK deletes when the sandbox that made it ends. The
 * restrictions are built when the role's process starts, so a stub captured
 * then could be gone by the next Bash call, and bwrap dies binding a missing
 * source ("Can't find source path ~/.claude/local", 2.16.2 release run). The
 * SDK denies that name itself. A path the SDK adds and loses the same way is
 * the sandbox-fault restart's to recover (sandbox-fault.ts): a new process
 * builds its restrictions again from what exists then.
 *
 * Linux only: seatbelt (macOS) denies by path rule, needs no mount points,
 * and keeps the whole directory read-only.
 */

import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Is `target` equal to, or nested under, `container`? */
const within = (container: string, target: string): boolean =>
  target === container || target.startsWith(container.endsWith(sep) ? container : container + sep);

/** A 0-byte regular file: bwrap's mount-point stub for an SDK /dev/null bind. */
const isStub = (p: string): boolean => {
  try {
    const st = lstatSync(p);
    return st.isFile() && st.size === 0;
  } catch {
    return true; // already gone
  }
};

export interface ExpandedDenyWrite {
  /** What to pass as `filesystem.denyWrite` (still unfiltered for existence). */
  denyWrite: string[];
  /** Directories that were expanded; the caller makes each one a writable
   *  bind mount when it already lies under a writable root. */
  mountPoints: string[];
}

/**
 * Replaces every deny-write path that equals or contains one of `keepWritable`
 * (the role's cwd, ~/.claude) with its existing children (less the SDK's
 * empty stubs), recursively. A path
 * that cannot be listed (missing, unreadable, not a directory) is kept as-is,
 * so the old — stricter — behaviour is the fallback.
 */
export function expandDenyWrite(
  paths: string[],
  keepWritable: string[],
  platform: NodeJS.Platform = process.platform,
): ExpandedDenyWrite {
  if (platform !== 'linux') return { denyWrite: paths, mountPoints: [] };
  const keep = keepWritable.map(real);
  const denyWrite: string[] = [];
  const mountPoints: string[] = [];
  const visit = (p: string): void => {
    if (!keep.some((k) => within(real(p), k))) {
      denyWrite.push(p);
      return;
    }
    let entries: string[];
    try {
      if (!lstatSync(p).isDirectory()) throw new Error('not a directory');
      entries = readdirSync(p);
    } catch {
      denyWrite.push(p);
      return;
    }
    mountPoints.push(p);
    for (const e of entries) if (!isStub(join(p, e))) visit(join(p, e));
  };
  for (const p of paths) visit(p);
  return { denyWrite, mountPoints };
}

/** `within()` over real paths, for picking the mount points that lie under a
 *  root that is writable anyway (anything else was never writable and must not
 *  become so). */
export function underAnyRoot(p: string, roots: string[]): boolean {
  const rp = real(p);
  return roots.some((r) => within(real(r), rp));
}
