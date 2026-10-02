/**
 * Memory Bridge — project-root resolution and store path resolution
 * (per-project data dir, global brain, MCP path-traversal guard). Split out
 * of memory-bridge.ts, which re-exports the public symbols.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logBridgeError } from './memory-bridge-core.js';

// ===== DB path resolution =====

// LanceDB commits via atomic rename, which exFAT/SMB project volumes don't support
// (ENOTSUP os error 45) — and non-APFS volumes grow ._ AppleDouble sidecars inside
// the .lance datasets that corrupt reads. So the store always lives on the home
// volume, namespaced per project directory.
//
// The slug is a hash of the full resolved path, not a character-substitution of
// it — flattening separators to '-' is not collision-safe ('/x/foo-bar' and
// '/x/foo/bar' would both flatten to 'x-foo-bar'). A short readable prefix is
// kept purely so the directory name is browsable; only the hash guarantees
// uniqueness.

// o-16: `.git` and `.monomind` are NOT equivalent evidence of a project.
// `.git` is created by the user, deliberately (`git init`/clone) — "this
// directory is a repository". `.monomind` is created by monomind ITSELF, as
// a side effect of running anywhere — "monomind once ran here", and nothing
// more. Treating a bare `.monomind` ancestor as adoptable is a feedback
// loop: a wrong resolution creates the very marker that captures every
// future descendant. Measured against the actual incident:
// `~/mdev-tmp/.monomind` and `~/.monomind` both exist,
// neither has a `.git` or manifest, and neither is a project — both are
// monomind's own state directories. `INDEPENDENT_PROJECT_MARKERS` (other
// than `.git`, handled unconditionally) is what makes a `.monomind`
// ancestor's claim independently checkable.
const INDEPENDENT_PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'];

function markerExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch (e) {
    logBridgeError('walkToProjectRoot', e); /* unreadable dir — treat as absent, keep walking */
    return false;
  }
}

export interface ProjectRootResolution {
  root: string;
  /** Why `root` was chosen — for disclosure (doctor, debug logs), not
   *  behavior. `explicit-anchor`: MONOMIND_PROJECT_ROOT set and valid.
   *  `git`: a `.git` ancestor (any depth) was adopted. `monomind-at-start`:
   *  the starting directory itself carries `.monomind` (the user is
   *  standing in their own project — always trusted). `monomind-with-marker`:
   *  an ancestor's `.monomind` was corroborated by an independent project
   *  marker. `start-fallback`: nothing adoptable was found; `root` is
   *  `start`. */
  reason:
    | 'explicit-anchor'
    | 'git'
    | 'monomind-at-start'
    | 'monomind-with-marker'
    | 'start-fallback';
  /** Set only on `start-fallback`: the first bare `.monomind` ancestor that
   *  was found but NOT adopted (no independent marker alongside it), so a
   *  caller can tell a genuinely ambiguous user why their brain stayed put
   *  instead of silently picking a directory that merely looked plausible. */
  ignoredBareMonomind?: string;
  /** Set whenever MONOMIND_PROJECT_ROOT was present in the environment but
   *  failed validation — regardless of what `reason`/`root` ended up being,
   *  so a typo'd anchor is never silently dropped just because the ordinary
   *  walk happened to land somewhere reasonable anyway (o-16 revision 1). */
  invalidAnchor?: { value: string; problem: string };
}

/** o-16 revision 1 (reviewer MAJOR 1, measured not argued): the anchor used
 *  to be trusted unconditionally. Two proven harms: (a) a non-existent path
 *  (a typo) was adopted as-is, and `projectDataDir()` hashed it into a
 *  fresh, empty store directory — the exact split-store failure this item
 *  exists to eliminate, reintroduced by the escape hatch meant to fix it.
 *  (b) `MONOMIND_PROJECT_ROOT=/` disabled `getDbPath`'s MCP path-traversal
 *  guard entirely: the guard is `path.relative(getProjectRoot(), resolved)`
 *  not starting with `..`, and `path.relative('/', anything)` never does.
 *  `existsSync` + `isDirectory` alone catch (a) but NOT (b) — `/` exists and
 *  is a directory — so the filesystem-root check below is what closes (b)
 *  specifically; it is not redundant with the others. An invalid anchor is
 *  never silently accepted OR silently dropped: the caller falls through to
 *  the ordinary walk, and the fact that an anchor was set and rejected is
 *  preserved on the result (`invalidAnchor`) so `doctor` can say exactly
 *  what happened instead of the user just seeing an unexplained directory. */
function validateAnchor(
  raw: string,
): { ok: true; resolved: string } | { ok: false; problem: string } {
  if (!path.isAbsolute(raw)) return { ok: false, problem: 'not an absolute path' };
  const lexical = path.resolve(raw);
  // o-16 revision 2 (reviewer MAJOR): resolve symlinks BEFORE validating,
  // and return the REAL path, not the lexical one. Without this, a symlink
  // whose real target is '/' (e.g. MONOMIND_PROJECT_ROOT=<tmp>/link-to-root)
  // passes every check below on its lexical form — dirname(lexical) !==
  // lexical, since the link itself sits inside a normal directory — while
  // getDbPath's traversal guard (memory-bridge-paths.ts's realOrResolved(), i.e.
  // fs.realpathSync) resolves the SAME anchor to '/' downstream. Two
  // notions of "the root" in one module: the store gets hashed from the
  // lexical path this function returned, the guard's boundary is computed
  // from the real one, and path.relative('/', anything) never starts with
  // '..' — the exact guard-disabling hole this function exists to close,
  // reopened one indirection away. Validating and returning the SAME (real)
  // path is what makes validation and consumption agree, for any
  // symlinked anchor, not just a literal '/'.
  let real: string;
  try {
    real = fs.realpathSync(lexical);
  } catch {
    return { ok: false, problem: 'does not exist' };
  }
  let stat: ReturnType<typeof fs.statSync>;
  try {
    stat = fs.statSync(real);
  } catch {
    return { ok: false, problem: 'does not exist' };
  }
  if (!stat.isDirectory()) return { ok: false, problem: 'is not a directory' };
  if (path.dirname(real) === real) {
    return {
      ok: false,
      problem: 'is the filesystem root, which would disable the MCP path-traversal guard',
    };
  }
  return { ok: true, resolved: real };
}

function walkToProjectRoot(start: string): ProjectRootResolution {
  // Explicit escape hatch: honored ahead of any walk, but only once valid —
  // see validateAnchor's comment for why unconditional trust was wrong.
  const anchorRaw = process.env.MONOMIND_PROJECT_ROOT;
  let invalidAnchor: ProjectRootResolution['invalidAnchor'];
  if (anchorRaw) {
    const check = validateAnchor(anchorRaw);
    if (check.ok) return { root: check.resolved, reason: 'explicit-anchor' };
    invalidAnchor = { value: anchorRaw, problem: check.problem };
    logBridgeError(
      'walkToProjectRoot',
      new Error(
        `MONOMIND_PROJECT_ROOT ignored: "${anchorRaw}" ${check.problem} — falling back to the walk`,
      ),
    );
  }

  // Retained from before o-16: protects the dotfiles-repo-at-$HOME case (a
  // `.git` at $HOME must not swallow every loose project underneath it).
  // Insufficient ALONE against the reported incident — that marker sat
  // *inside* $HOME, so the walk reached it long before ever reaching home —
  // which is why it is additive to, not a replacement for, the rule below.
  const home = path.resolve(os.homedir());

  let dir = start;
  let ignoredBareMonomind: string | undefined;
  let atStart = true;
  for (;;) {
    if (dir === home) break;
    if (markerExists(path.join(dir, '.git'))) return { root: dir, reason: 'git', invalidAnchor };
    if (markerExists(path.join(dir, '.monomind'))) {
      if (atStart) return { root: dir, reason: 'monomind-at-start', invalidAnchor };
      const corroborated = INDEPENDENT_PROJECT_MARKERS.some((m) => markerExists(path.join(dir, m)));
      if (corroborated) return { root: dir, reason: 'monomind-with-marker', invalidAnchor };
      // The nearest marker found doesn't qualify — stop HERE. Continuing
      // past it to adopt some more distant, unrelated ancestor's `.git`
      // would break "nested projects keep their own brain" in a new way:
      // a vendored sub-repo with only a bare `.monomind` would get silently
      // merged into whatever repo happens to sit further up, which the
      // original nearest-marker-wins design specifically existed to
      // prevent. Not adopting is the fallback; walking past is not.
      ignoredBareMonomind = dir;
      break;
    }
    atStart = false;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (ignoredBareMonomind !== undefined) {
    logBridgeError(
      'walkToProjectRoot',
      new Error(
        `bare .monomind ancestor ignored at ${ignoredBareMonomind} (no independent project marker) — using ${start}`,
      ),
    );
  }
  return { root: start, reason: 'start-fallback', ignoredBareMonomind, invalidAnchor };
}

// getBackend() resolves the store path on every store/search, so a bulk ingest
// would otherwise repeat the stat walk thousands of times. A project does not
// gain or lose its markers mid-process; the key is the starting directory, so a
// chdir still re-resolves.
let _rootCacheKey: string | undefined;
let _rootCacheVal: ProjectRootResolution | undefined;

/** The full resolution — root, reason and (when the walk found nothing
 *  adoptable) which bare `.monomind` ancestor it ignored. `doctor` uses this
 *  to disclose which directory a user's brain is keyed to and why, instead
 *  of a plausible-but-silent path (o-16). See `getProjectRoot` for the
 *  string-only form the other ~28 call sites use. */
export function getProjectRootResolution(
  from: string = process.env.MONOMIND_CWD || process.cwd(),
): ProjectRootResolution {
  const start = path.resolve(from);
  // Cache key must cover everything walkToProjectRoot's result depends on,
  // not just `start` — MONOMIND_PROJECT_ROOT short-circuits the walk (o-16),
  // so a cache keyed on `start` alone would replay a stale pre-anchor (or
  // stale different-anchor) result for the same cwd once the env var changes
  // mid-process, silently defeating the escape hatch it's supposed to be.
  const cacheKey = `${start}\n${process.env.MONOMIND_PROJECT_ROOT ?? ''}`;
  if (cacheKey === _rootCacheKey && _rootCacheVal !== undefined) return _rootCacheVal;
  const resolved = walkToProjectRoot(start);
  _rootCacheKey = cacheKey;
  _rootCacheVal = resolved;
  return resolved;
}

/** The directory that identifies "this project" for every Second Brain store.
 *
 * Deliberately NOT the raw cwd: keying on cwd forked the brain per directory —
 * `doc ingest ./docs` from a package subdir wrote to a different store, and a
 * different metadata file, than the identical command at the repo root, and
 * neither could see the other. We walk up to the nearest ancestor carrying a
 * `.git` marker (any depth), or a `.monomind` marker corroborated by an
 * independent project marker, so every directory inside one project resolves
 * to one brain. Nested projects still win (the walk stops at the FIRST
 * eligible marker), which keeps worktrees and vendored sub-repos independent.
 *
 * o-16: a BARE `.monomind` ancestor (no `.git`, no manifest) is NOT adopted.
 * `.monomind` is created by monomind itself as a side effect of running
 * anywhere — it is not independent evidence of a project, and a wrong
 * resolution creates the very marker that would capture every future
 * descendant if it were trusted alone. See `walkToProjectRoot`'s comment for
 * the measured incident this fixes. The starting directory's OWN `.monomind`
 * is still trusted unconditionally — that is the user pointing at their own
 * project — and `.git` at any depth is untouched, so CI/devcontainer repos
 * and subdirectory unification behave exactly as before.
 *
 * The walk never crosses the home directory: a dotfiles repo at `~` would
 * otherwise swallow every loose project underneath it into one shared brain.
 * `MONOMIND_PROJECT_ROOT`, if set AND VALID (absolute, exists, is a
 * directory, is not itself the filesystem root — see `validateAnchor`), is
 * an explicit anchor that skips the walk entirely — the escape hatch for
 * the genuinely ambiguous case (design decision 4 / AC-3c: a real, non-git
 * project whose root has a bare `.monomind` and no manifest has no other
 * way to be found from a subdirectory). An invalid anchor falls through to
 * the walk rather than being adopted OR silently dropped — see
 * `ProjectRootResolution.invalidAnchor`.
 *
 * This is `MONOMIND_PROJECT_ROOT`'s SECOND consumer in this codebase —
 * `mcp-tools/guidance-tools.ts:findProjectRoot()` already reads the same
 * env var, for a DIFFERENT marker (`.claude`, not `.monomind`/`.git`), with
 * a stricter rule: `if (envRoot && existsSync(join(envRoot, '.claude')))`,
 * i.e. it only honors the anchor when `.claude` exists there, silently
 * falling through to its own walk otherwise. After this revision the two
 * converge on ANCHOR HANDLING for the cases that matter most — a typo'd or
 * missing path is rejected by both (this one via `validateAnchor`,
 * guidance-tools' because `.claude` is absent) — but "converge" describes
 * only whether each accepts or rejects the anchor, not the final resolved
 * root: a rejected anchor falls through to each resolver's OWN walk
 * (`walkToProjectRoot` here; guidance-tools' own Strategy 1/2/3 chain
 * there), which can still land on different directories for the same
 * unanchored cwd. Two residual disagreements remain, both legitimate rather
 * than oversights:
 * 1. An anchor that exists and is a real directory but has no `.claude` in
 *    it: this function honors it (memory has no reason to require a
 *    `.claude` folder — a project's knowledge store isn't gated on whether
 *    an agent config lives there), guidance-tools does not (`.claude` is
 *    the one thing it's searching FOR, so its absence is a real signal, not
 *    noise, for that consumer specifically).
 * 2. A RELATIVE anchor: `validateAnchor` rejects it outright (an anchor
 *    that silently depends on cwd defeats the point of an anchor).
 *    guidance-tools has no absolute-path check, so `existsSync(join(envRoot,
 *    '.claude'))` would resolve a relative `envRoot` against cwd and could
 *    accept it — narrower in practice (needs a `.claude` at that resolved
 *    location too) but a real gap in the two resolvers' shared assumptions.
 * Reconciling the two resolvers' semantics into one shared rule is a
 * separate, larger question (tracked as o-32), not something this fix
 * should decide as a side effect.
 *
 * For anyone who already ran from the project root — the normal case — the
 * resolved path is identical to before, so their store does not move.
 *
 * `MONOMIND_CWD` wins over the real cwd, matching `getProjectCwd()` in
 * mcp-tools/types.ts — an MCP server is launched with whatever cwd the client
 * chose, and that env var is already how monograph and swarm state learn which
 * project they belong to. Inlined rather than imported to keep this module on
 * node builtins only (see the static import in document-pipeline.ts).
 */
export function getProjectRoot(from: string = process.env.MONOMIND_CWD || process.cwd()): string {
  return getProjectRootResolution(from).root;
}

export function projectDataDir(): string {
  const resolved = path.resolve(getProjectRoot());
  const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  const readable =
    path
      .basename(resolved)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 40) || 'project';
  // MONOMIND_PROJECTS_DIR redirects the parent only (a harness keeping a run's state out of the
  // real home); the <name>-<hash> leaf, and so the project's identity, is the same either way.
  const override = process.env.MONOMIND_PROJECTS_DIR;
  if (override && !path.isAbsolute(override))
    throw new Error(`MONOMIND_PROJECTS_DIR must be an absolute path, got "${override}"`);
  const parent = override || path.join(os.homedir(), '.monomind', 'projects');
  return path.join(parent, `${readable}-${hash}`);
}

/** Resolve symlinks so the traversal check below can't be bypassed by a link
 * that lexically resolves inside the allowed trees but points outside them. */
function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    logBridgeError('realOrResolved', e);
    return p;
  }
}

/** The personal, cross-project knowledge store. Deliberately a SIBLING of
 *  ~/.monomind/projects (never inside it) so per-project pruning heuristics
 *  (`cleanup --data`) can never touch it. Env-overridable for tests and for
 *  users who keep their brain on a synced/external location. Resolved lazily
 *  so the override works regardless of import order. */
export function getGlobalBrainDir(): string {
  return (
    process.env.MONOMIND_GLOBAL_BRAIN_DIR || path.join(os.homedir(), '.monomind', 'global-brain')
  );
}
/** Sentinel callers pass as dbPath to address the global brain. */
export const GLOBAL_BRAIN = '@global';

export function getDbPath(customPath?: string): string {
  const defaultDir = path.join(projectDataDir(), 'lancedb');
  if (!customPath || customPath === ':memory:') return defaultDir;
  if (customPath === GLOBAL_BRAIN) return getGlobalBrainDir();
  // Treat legacy .db paths (and the legacy .swarm dir) as a signal to use the default
  if (customPath.endsWith('.db')) return defaultDir;
  const resolved = realOrResolved(path.resolve(customPath));
  // Guard against path traversal from MCP inputs: only allow paths inside the
  // project, the per-project home data dir, or the global brain.
  //
  // STATED LIMIT (o-16 revision 2, corrected in revision 3 — verifier found
  // the first version of this comment named the wrong path): `validateAnchor`
  // resolves a `MONOMIND_PROJECT_ROOT` anchor to its REAL path ONCE via
  // `fs.realpathSync`, and caches THAT REAL PATH STRING in `_rootCacheVal`
  // (see above) — `getProjectRoot()` returns this cached real-path string on
  // every subsequent call in this process; it does not re-read the anchor
  // or re-run `validateAnchor`. So swapping the filesystem entry AT THE
  // ANCHOR PATH after validation does nothing — the anchor itself is never
  // consulted again. The actual gap is one level further in: the line below
  // calls `realOrResolved()` (a fresh `fs.realpathSync`) on that cached
  // REAL-PATH STRING every time `getDbPath` runs. If the filesystem entry
  // AT THAT RESOLVED TARGET (not the anchor) is swapped for a symlink to
  // `/` after validation but before a later call here, this re-resolves to
  // the new real target live, and the guard is bypassed for that call — a
  // TOCTOU gap between a one-time resolution and a re-resolved-every-call
  // consumption of the same path string. NOT defended against: closing it
  // properly means validating and consuming a single resolved handle rather
  // than a path string, which is a real design change and out of scope for
  // this fix. Accepted because it needs filesystem write access at the
  // resolved target's path, timed against a live process — an attacker
  // with that capability already has easier routes than this guard.
  const relCwd = path.relative(realOrResolved(getProjectRoot()), resolved);
  const relHome = path.relative(realOrResolved(projectDataDir()), resolved);
  const relGlobal = path.relative(realOrResolved(getGlobalBrainDir()), resolved);
  if (!relCwd.startsWith('..') && !path.isAbsolute(relCwd)) return resolved;
  if (!relHome.startsWith('..') && !path.isAbsolute(relHome)) return resolved;
  if (!relGlobal.startsWith('..') && !path.isAbsolute(relGlobal)) return resolved;
  return defaultDir;
}

/** Resolve the real on-disk SQLite data-dir path for a given custom path (or the
 *  default) — the dir is still named `lancedb` for legacy path back-compat. */
export function bridgeGetDbPath(customPath?: string): string {
  return getDbPath(customPath);
}
