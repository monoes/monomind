// packages/@monomind/cli/src/orgrt/policy-paths.ts
// Split out of policy.ts (file-size sweep) — glob matching, web-domain
// matching, and the real-path helpers PolicyEngine.decide() uses to resolve
// and scope file-tool paths.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { probeCase } from './fs-case.js';

const REGEX_METACHARS = new Set('.+^${}()|[]\\'.split(''));

/**
 * tiny glob→RegExp: `**\/` matches zero-or-more leading directories (so
 * `**\/*.md` matches both `README.md` and `docs/README.md`, standard glob
 * semantics), bare `**` matches any depth, `*` matches one path segment.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (glob.startsWith('**', i)) {
      out += '.*';
      i += 2;
      continue;
    }
    const c = glob[i];
    if (c === '*') {
      out += '[^/]*';
      i++;
      continue;
    }
    if (REGEX_METACHARS.has(c)) {
      out += `\\${c}`;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return new RegExp(`^${out}$`);
}

/** webAllow entry matcher. `*` allows any host (the intuitive "no
 *  restriction" value); `*.example.com` matches the bare domain and every
 *  subdomain; anything else is an exact host or subdomain suffix match. */
export function webDomainMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern || host.endsWith(`.${pattern}`);
}

export const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** #303: is `target` equal to, or nested under, `container`? Both must
 *  already be `realPath()`-resolved — this is a plain string comparison, not
 *  a filesystem check, so a symlink escape must be resolved before this
 *  runs, never lexically. #496: with a `fold` other than `exact` the paths
 *  compare segment by segment through normalizeSegment. */
export function isWithin(container: string, target: string, fold: SegmentFold = 'exact'): boolean {
  if (fold !== 'exact') return segmentsBelow(container, target, process.platform, fold) !== null;
  if (container === target) return true;
  const withSep = container.endsWith(sep) ? container : container + sep;
  return target.startsWith(withSep);
}

/**
 * #496: is `target` inside the granted `container`? Both realPath()-resolved,
 * so every EXISTING part of either is already in its on-disk spelling
 * (realpathSync.native) and compares exactly: a grant never folds its way
 * into a differently-cased directory that really exists. Only with `fold`
 * `case` (pathFolds().allow: darwin/win32, where the probe shows the
 * filesystem folds case) do the not-yet-existing segments of `target`
 * compare case-insensitively, since they will be created on that filesystem.
 */
export function grantWithin(
  container: string,
  target: string,
  fold: SegmentFold = 'exact',
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (isWithin(container, target)) return true;
  if (fold !== 'case') return false;
  const c = pathSegments(container, platform, 'exact');
  const t = pathSegments(target, platform, 'exact');
  if (t.length < c.length) return false;
  const existing = pathSegments(existingAncestor(target), platform, 'exact').length;
  // A Windows drive letter (`C:` / `c:`) is the same drive in either case.
  const drive = (a: string, b: string) =>
    /^[a-z]:$/i.test(a) && a.toLowerCase() === b.toLowerCase();
  return c.every((s, i) =>
    i < existing ? s === t[i] || drive(s, t[i]) : s.toLowerCase() === t[i].toLowerCase(),
  );
}

/** The nearest ancestor of `p` (or `p` itself) that exists. */
export function existingAncestor(p: string): string {
  for (let cur = p; ; cur = dirname(cur)) {
    try {
      lstatSync(cur);
      return cur;
    } catch {
      if (dirname(cur) === cur) return cur;
    }
  }
}

/** realpath of `p`, resolving through the nearest EXISTING ancestor when the
 *  target itself doesn't exist yet (a Write into a symlinked directory), and
 *  falling back to the lexical path when nothing on it exists. `.native`
 *  (#498): it returns the on-disk spelling of every existing part — the case
 *  on a case-insensitive filesystem, the long form of a Windows 8.3 name.
 *  A dangling symlink is followed to where a write through it would land. */
export function realPath(p: string): string {
  return resolveReal(p, 0);
}

function resolveReal(p: string, depth: number): string {
  const rest: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...rest);
    } catch {
      /* not there — try the parent */
    }
    try {
      if (depth < 40 && lstatSync(cur).isSymbolicLink())
        return resolveReal(join(resolve(dirname(cur), readlinkSync(cur)), ...rest), depth + 1);
    } catch {
      /* not a link either */
    }
    const parent = dirname(cur);
    if (parent === cur) return p;
    rest.unshift(basename(cur));
    cur = parent;
  }
}

/**
 * #496: how path segments compare.
 *   - `exact`: as written — a case-sensitive filesystem.
 *   - `case`: lower-cased — the default on darwin and win32, and for a
 *     GRANT's not-yet-existing segments where the filesystem folds case
 *     (grantWithin).
 *   - `deny`: for every DENY check, on every platform: NFKC-normalized and
 *     fully case-folded (lower, upper, lower again, so `ſ`, `ß`/`ẞ`, `ı`,
 *     the Kelvin sign and ligatures such as `ﬁ` meet their ASCII forms), with
 *     trailing dots and spaces and a `:stream` suffix dropped as Windows,
 *     vfat and exfat drop them. It over-folds on purpose: a deny may refuse
 *     a look-alike, it must never miss the real file.
 */
export type SegmentFold = 'exact' | 'case' | 'deny';

/** darwin and win32 volumes are case-insensitive by default. */
const platformFolds = (platform: NodeJS.Platform): boolean =>
  platform === 'darwin' || platform === 'win32';

/**
 * #496: the folds for the checks on one resolved path. Deny checks always
 * use `deny`, on every platform: a filesystem probe can be wrong (the
 * casefold flag of a Linux directory governs its entries, not its own name;
 * a mount root has no parent to compare), so it never relaxes a deny.
 * Grants fold (see grantWithin) only on darwin and win32, and only where
 * fs-case.ts's probe shows the filesystem folds case; on Linux they never
 * fold.
 */
export function pathFolds(
  real: string,
  platform: NodeJS.Platform = process.platform,
): { deny: SegmentFold; allow: SegmentFold } {
  return {
    deny: 'deny',
    allow: platformFolds(platform) && probeCase(real) === 'insensitive' ? 'case' : 'exact',
  };
}

/** Linux casefold (like HFS+) also ignores default-ignorable code points
 *  (ZWSP, ZWNJ/ZWJ, soft hyphen, BOM, CGJ…), so `.gi<ZWJ>t` is `.git`. */
const foldForDeny = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()
    .normalize('NFKC');

/**
 * #498: the spelling of one path segment as the filesystem compares it,
 * folded as `fold` says (#496; by default case-folded on darwin and win32,
 * which are case-insensitive by default). On win32 a trailing run of dots
 * and spaces and an alternate-data-stream suffix (`bus.jsonl::$DATA`,
 * `x.json:s`) are dropped too, as Windows drops them when it opens the file.
 * A drive segment (`C:`) keeps its colon. Compare segments only after
 * `realPath()`, which already turned any existing part into its on-disk
 * spelling.
 */
export function normalizeSegment(
  seg: string,
  platform: NodeJS.Platform = process.platform,
  fold: SegmentFold = platformFolds(platform) ? 'case' : 'exact',
): string {
  let s = seg;
  if ((platform === 'win32' || fold === 'deny') && !/^[a-z]:$/i.test(s)) {
    s = s.replace(/:.*$/s, '');
    if (s !== '.' && s !== '..') s = s.replace(/[. ]+$/, '');
  }
  if (fold === 'deny') return foldForDeny(s);
  return fold === 'exact' ? s : s.toLowerCase();
}

/** The normalized segments of an absolute path (see normalizeSegment), with
 *  `.` and `..` collapsed lexically, as `path.resolve()` would. Only a
 *  segment WRITTEN as `.` or `..` is one: a name that folds to `..`
 *  (fullwidth `．．` under NFKC) is an ordinary name on disk. */
export function pathSegments(
  p: string,
  platform: NodeJS.Platform = process.platform,
  fold?: SegmentFold,
): string[] {
  const out: string[] = [];
  for (const raw of p.split(platform === 'win32' ? /[\\/]+/ : /\/+/)) {
    if (!raw || raw === '.') continue;
    if (raw === '..') {
      out.pop();
      continue;
    }
    const s = normalizeSegment(raw, platform, fold);
    if (s !== '' && s !== '.') out.push(s);
  }
  return out;
}

/** The normalized segments of `target` below `base`, or null when `target`
 *  is not under it (`[]` when they are the same path). Both absolute. */
export function segmentsBelow(
  base: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
  fold?: SegmentFold,
): string[] | null {
  const b = pathSegments(base, platform, fold);
  const t = pathSegments(target, platform, fold);
  if (t.length < b.length || b.some((s, i) => s !== t[i])) return null;
  return t.slice(b.length);
}

/** Entries git runs or obeys: `config` (core.fsmonitor, core.hooksPath,
 *  core.sshCommand, aliases and filter drivers all execute), `hooks`, and the
 *  per-worktree `config.worktree`. */
const GIT_EXEC_ENTRIES = new Set(['config', 'hooks', 'config.worktree']);

/**
 * #258: a file-tool write into a `.git` dir that `policy.git` forbids, as the
 * `.git/...` path to name in the denial, or null when it is allowed. `real`
 * is the resolved target; segments compare case-insensitively where the
 * filesystem does (#498, #496: pass `pathFolds(real).deny`), so
 * `.GIT/Config` is `.git/config` on darwin.
 *
 * What git itself executes is refused at EVERY level, `push` included: the
 * operator's own git (an IDE's background `git status`, a commit in their
 * terminal) runs `core.fsmonitor`, a hook or a filter driver written there
 * outside every role sandbox. That is `config`, `hooks` and `config.worktree`
 * in the common dir, the same in a submodule's (`modules/<name>/…`) or a
 * linked worktree's (`worktrees/<name>/…`) git dir, and the `.git` entry
 * itself (a worktree's `gitdir:` pointer, which could name a git dir the role
 * wrote). A `push` role's `git config` and `git remote add` run in git, not
 * here, and are unaffected.
 */
export function gitWriteViolation(
  real: string,
  gitLevel: string,
  platform: NodeJS.Platform = process.platform,
  fold?: SegmentFold,
): string | null {
  const segments = pathSegments(real, platform, fold);
  const at = segments.lastIndexOf('.git');
  if (at === -1) return null;
  const rest = segments.slice(at + 1);
  const executes =
    rest.length === 0 ||
    GIT_EXEC_ENTRIES.has(rest[0]) ||
    ((rest[0] === 'modules' || rest[0] === 'worktrees') &&
      rest.slice(1).some((s) => GIT_EXEC_ENTRIES.has(s)));
  if (gitLevel === 'push' || gitLevel === 'commit') {
    if (!executes) return null;
  }
  return segments.slice(at).join('/');
}

export function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
