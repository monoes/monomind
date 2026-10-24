// packages/@monomind/cli/src/orgrt/codex-write-roots.ts
/**
 * A codex role's `policy.sandbox.allowWrite` as extra writable roots of codex's
 * own sandbox (`-c sandbox_workspace_write.writable_roots=[...]`).
 *
 * Verified against codex-cli 0.159.3 on decoy dirs (`codex exec --sandbox
 * workspace-write`): a listed root becomes writable while a sibling and the
 * home stay read-only; a `.git` inside a root stays read-only, as in the cwd;
 * a missing root is ignored. `codex sandbox` (permission-profile mode) ignores
 * the key, so only `codex exec` carries it.
 *
 * codex can only ADD roots: it cannot carve a read-only path out of one. So a
 * root is granted only when nothing protected lies inside it or contains it:
 * the credential/authority locations and operator-protected paths the claude
 * sandbox denies (file-roots.ts, authority-mask.ts, operator-protected-paths.ts),
 * and the role's own `denyWrite` entries. Unlike the claude path, a signed
 * allowWrite does not opt in to an operator-protected path here. Roots must be
 * real directories, not symlinks, and never `/` or the home.
 *
 * Known limit (parity with the claude path): roots are validated by realpath
 * when the session starts and codex opens them by path when its sandbox starts.
 * The claude layers have the same shape (authority-mask.ts binds the realpath'd
 * path with `--bind d d`; the SDK sandbox takes paths), and neither holds an fd
 * or inode. A process that can write a root's PARENT directory can swap the
 * root for a symlink in that window, so keep allowWrite roots under directories
 * no role can write.
 */
import { statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { authorityDirs } from './authority-mask.js';
import type { OrgBus } from './bus.js';
import { fileToolDenied } from './file-roots.js';
import { operatorProtectedPaths } from './operator-protected-paths.js';
import { isWithin, realPath } from './policy-paths.js';

export interface DroppedWriteRoot {
  path: string;
  reason: string;
}

export interface CodexWriteRoots {
  roots: string[];
  dropped: DroppedWriteRoot[];
}

export interface CodexWriteRootsCtx {
  allowWrite?: string[];
  denyWrite?: string[];
  cwd: string;
  orgRoot?: string;
  home: string;
  env: NodeJS.ProcessEnv;
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const exists = (p: string): boolean => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

export function codexWriteRoots(ctx: CodexWriteRootsCtx): CodexWriteRoots {
  const roots: string[] = [];
  const dropped: DroppedWriteRoot[] = [];
  if (!ctx.allowWrite?.length) return { roots, dropped };
  const base = ctx.orgRoot ?? ctx.cwd;
  const realHome = realPath(ctx.home);
  const realCwd = realPath(ctx.cwd);
  const forbidden = [
    ...fileToolDenied(ctx.home, ctx.env),
    ...authorityDirs(ctx.home, ctx.env),
    ...operatorProtectedPaths({ home: ctx.home, env: ctx.env, orgRoot: ctx.orgRoot, cwd: ctx.cwd }),
    ...[ctx.orgRoot, ctx.cwd].filter((r): r is string => !!r).map((r) => join(r, '.monomind')),
  ].map((p) => ({ p, real: realPath(p), kind: 'protected' }));
  const denied = (ctx.denyWrite ?? []).map((d) => {
    const p = resolve(base, d);
    return { p, real: realPath(p), kind: 'denyWrite' };
  });

  const drop = (path: string, reason: string) => dropped.push({ path, reason });
  for (const entry of ctx.allowWrite) {
    const abs = resolve(base, entry);
    if (!exists(abs)) {
      drop(entry, 'does not exist');
      continue;
    }
    const real = realPath(abs);
    if (join(realPath(dirname(abs)), basename(abs)) !== real) {
      drop(entry, `is a symlink (to ${real})`);
      continue;
    }
    if (!isDir(real)) {
      drop(entry, 'is not a directory');
      continue;
    }
    if (real === '/' || isWithin(real, realHome)) {
      drop(entry, 'would make / or the whole home directory writable');
      continue;
    }
    if (isWithin(realCwd, real)) {
      drop(entry, 'already writable (inside the working directory)');
      continue;
    }
    const hit = [...forbidden, ...denied].find(
      (f) => isWithin(f.real, real, 'deny') || isWithin(real, f.real, 'deny'),
    );
    if (hit) {
      const inside = isWithin(hit.real, real, 'deny');
      drop(
        entry,
        hit.kind === 'denyWrite'
          ? `${inside ? 'is inside' : 'contains'} denyWrite entry ${hit.p}; codex cannot deny a path inside a writable root, so the root is not granted`
          : `${inside ? 'is inside' : 'contains'} protected path ${hit.p}; codex cannot carve an exception out of a writable root`,
      );
      continue;
    }
    if (!roots.includes(real)) roots.push(real);
  }
  return { roots, dropped };
}

/** The writable roots for one codex session, with an audit event for the
 *  grant and for every entry dropped. Undefined when there is nothing to add. */
export function codexSessionWriteRoots(
  bus: OrgBus,
  roleId: string,
  ctx: CodexWriteRootsCtx,
): string[] | undefined {
  const r = codexWriteRoots(ctx);
  if (!ctx.allowWrite?.length) return undefined;
  bus.emit({
    type: 'audit',
    from: roleId,
    reason: 'codex-write-roots',
    msg: r.roots.length
      ? `codex sandbox: policy.sandbox.allowWrite granted as extra writable roots: ${r.roots.join(', ')}${
          r.dropped.length
            ? `; not granted: ${r.dropped.map((d) => `${d.path} (${d.reason})`).join('; ')}`
            : ''
        }`
      : `codex sandbox: none of policy.sandbox.allowWrite could be granted: ${r.dropped
          .map((d) => `${d.path} (${d.reason})`)
          .join('; ')}`,
    data: { roots: r.roots, dropped: r.dropped },
  });
  return r.roots.length ? r.roots : undefined;
}
