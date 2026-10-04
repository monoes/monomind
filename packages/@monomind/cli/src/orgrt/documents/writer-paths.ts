// packages/@monomind/cli/src/orgrt/documents/writer-paths.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.2): the path arithmetic of the writer core. Pure, lexical
 * only: nothing here touches the file system, so a relative entry means "relative to the workspace" for
 * file-tool scopes and "relative to the org root" for sandbox entries, exactly as `policy.ts` reads them.
 * Where a comparison cannot be decided without a real path (a relative entry against an absolute
 * workspace, `~`, `$VAR`), the answer is `undefined` and the caller picks the safe side; the real-path
 * boundary check at role start (P4.4) is the backstop for those.
 */
import { posix } from 'node:path';
import { globToRegExp } from '../policy-paths.js';
import { isGlobScope } from '../policy-scopes.js';
import { ORG_DIR } from '../types.js';

export const isGlob = isGlobScope;

/** `a/./b/` becomes `a/b`; the empty string and `./` become `.`. */
export function norm(p: string): string {
  let n = posix.normalize(p.trim());
  if (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1);
  return n === '' ? '.' : n;
}

const isAbs = (p: string): boolean => p.startsWith('/');
/** `~` and `$VAR` entries are expanded by the sandbox, not here. */
const opaque = (p: string): boolean => p.startsWith('~') || p.includes('$');

/** Does the directory `a` contain `b` (or equal it)? Both must be of one kind (relative or absolute). */
function contains(a: string, b: string): boolean {
  if (/^\.\.(\/\.\.)*$/.test(a)) {
    // A chain of `..` is an ancestor of the base and of everything not climbing higher than it.
    const up = (p: string) => p.split('/').filter((s) => s === '..').length;
    return up(b) <= up(a) && !isAbs(b);
  }
  if (a === '.') return !b.startsWith('..');
  if (a === '/') return isAbs(b);
  return b === a || b.startsWith(`${a}/`);
}

/** `p` as an absolute path when it is one or when `orgRoot` (absolute) resolves it; else undefined. */
function resolveWith(p: string, orgRoot: string | undefined): string | undefined {
  if (opaque(p)) return undefined;
  if (isAbs(p)) return norm(p);
  return orgRoot !== undefined && isAbs(orgRoot) ? norm(posix.join(orgRoot, p)) : undefined;
}

/** Are `a` and `b` of one kind after resolving what can be resolved? */
function comparable(
  a: string,
  b: string,
  orgRoot: string | undefined,
): [string, string] | undefined {
  if (opaque(a) || opaque(b)) return undefined;
  if (isAbs(a) === isAbs(b)) return [norm(a), norm(b)];
  const ra = resolveWith(a, orgRoot);
  const rb = resolveWith(b, orgRoot);
  return ra !== undefined && rb !== undefined ? [ra, rb] : undefined;
}

/** `a` is `b` or an ancestor of `b` (a grant or deny of `a` covers `b`); undefined when undecidable. */
export function covers(a: string, b: string, orgRoot?: string): boolean | undefined {
  const pair = comparable(a, b, orgRoot);
  return pair === undefined ? undefined : contains(pair[0], pair[1]);
}

/** `a` and `b` are the same path or one lies inside the other; undefined when undecidable. */
export function overlaps(a: string, b: string, orgRoot?: string): boolean | undefined {
  const pair = comparable(a, b, orgRoot);
  return pair === undefined ? undefined : contains(pair[0], pair[1]) || contains(pair[1], pair[0]);
}

/** The directory part of an entry before its first wildcard segment (`src/**` gives `src`). */
export function literalBase(entry: string): string {
  const e = norm(entry);
  const segs = e.split('/');
  const keep: string[] = [];
  for (const s of segs) {
    if (isGlob(s)) break;
    keep.push(s);
  }
  const base = keep.join('/');
  return base === '' ? (isAbs(e) ? '/' : '.') : base;
}

const FILL_A = 'zz';
const FILL_B = 'q.q/q';

/** The entry with every wildcard replaced by a concrete name (two fillers, to catch one-segment globs). */
function instances(entry: string): string[] {
  const make = (fill: string) =>
    entry
      .replace(/\*\*\//g, `${fill}/${fill}/`)
      .replace(/\*\*/g, `${fill}/${fill}`)
      .replace(/\*/g, fill.split('/')[0])
      .replace(/\?/g, 'z');
  return [make(FILL_A), make(FILL_B)];
}

/**
 * Does the scope entry `w` (a `writes` glob or directory) cover every path the entry `e` can name?
 * Conservative, by instantiation, not a proof: a plain path `e` is a directory grant in `policy.ts` (the
 * path and everything beneath it), so it is covered only when `w` covers a deep path beneath it; name a
 * single file by listing it as the glob itself. `w` that is a plain directory covers whatever lies lexically
 * under it.
 */
export function scopeCovers(w: string, e: string): boolean {
  const W = norm(w);
  const E = norm(e);
  if (W === E || W === '**') return true;
  if (isAbs(W) !== isAbs(E)) return false;
  if (E === '..' || E.startsWith('../')) return false;
  if (!isGlob(W)) return contains(W, isGlob(E) ? literalBase(E) : E);
  const rx = globToRegExp(W);
  if (isGlob(E)) return instances(E).every((i) => rx.test(i));
  return rx.test(`${E}/${FILL_A}`) && rx.test(`${E}/${FILL_B}`);
}

/** Is the workspace-relative path `rel` inside any entry of `scope`? (Plain entry: a directory grant.) */
export function pathInScope(scope: string[], rel: string): boolean {
  const p = norm(rel);
  if (isAbs(p) || p === '..' || p.startsWith('../')) return false;
  return scope.some((s) => {
    const S = norm(s);
    return !isAbs(S) && (isGlob(S) ? globToRegExp(S).test(p) : contains(S, p));
  });
}

export type WorkspaceMode = 'repo' | 'isolated' | 'worktree' | 'worktree-per-role' | 'path';

export interface WorkspaceInfo {
  mode: WorkspaceMode;
  /** Roles with the same key share one directory. */
  key: string;
  /** The workspace as a sandbox entry: `.` for the project root, a path under the org root, or as given. */
  entry: string;
  /** False only for `worktree-per-role` (each role has its own tree). */
  shared: boolean;
}

interface WsDef {
  name?: string;
  run_config?: Record<string, unknown>;
}

/** `run_config.workspace` as the daemon reads it (`daemon.workspaceSetting`), without the project root. */
export function workspaceInfo(def: WsDef, roleId?: string): WorkspaceInfo {
  const raw = def.run_config?.workspace;
  const ws = typeof raw === 'string' && raw !== '' ? raw : 'repo';
  const under = (leaf: string) => (def.name ? `${ORG_DIR}/${def.name}/${leaf}` : '.');
  if (ws === 'repo') return { mode: 'repo', key: 'repo', entry: '.', shared: true };
  if (ws === 'isolated')
    return { mode: 'isolated', key: 'isolated', entry: under('workspace'), shared: true };
  if (ws === 'worktree')
    return { mode: 'worktree', key: 'worktree', entry: under('worktree'), shared: true };
  if (ws === 'worktree-per-role')
    return {
      mode: 'worktree-per-role',
      key: `worktree-per-role:${roleId ?? ''}`,
      entry: under(`worktree-${roleId ?? ''}`),
      shared: false,
    };
  const entry = norm(ws);
  return { mode: 'path', key: `path:${entry}`, entry, shared: true };
}

/** Does a `policy.sandbox.denyWrite` entry cover the workspace? Undecidable counts as no. */
export function denyCoversWorkspace(deny: string, ws: WorkspaceInfo, orgRoot?: string): boolean {
  return covers(deny, ws.entry, orgRoot) === true;
}

/** Would a `policy.sandbox.allowWrite` entry make any part of the workspace writable? Undecidable counts as no. */
export function allowReachesWorkspace(allow: string, ws: WorkspaceInfo, orgRoot?: string): boolean {
  return overlaps(allow, ws.entry, orgRoot) === true;
}

/**
 * Would a `fileWrite` entry grant a write inside the workspace? A relative entry is relative to the
 * workspace itself, so it always does (unless it climbs out of it); an absolute one when it overlaps.
 */
export function fileScopeReachesWorkspace(
  entry: string,
  ws: WorkspaceInfo,
  orgRoot?: string,
): boolean {
  const e = norm(entry);
  if (opaque(e)) return false;
  if (!isAbs(e)) return !(e === '..' || e.startsWith('../'));
  return overlaps(literalBase(e), ws.entry, orgRoot) === true;
}
