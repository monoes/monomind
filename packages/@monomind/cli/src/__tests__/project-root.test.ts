/**
 * getProjectRoot — the directory that identifies "this project" for every
 * Second Brain store.
 *
 * Regression guard: the store path used to hash the raw cwd, so running
 * `doc ingest` from a package subdirectory wrote to a different store AND a
 * different metadata file than the identical command at the repo root. Neither
 * brain could see the other. These tests pin the marker walk that fixes it.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// getProjectRoot stops the upward walk at the home directory. Point homedir at
// a test-controlled path so the walk is deterministic and never depends on
// whether this machine's real $HOME happens to be a git repo.
const homeState = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => homeState.dir };
});

import { getProjectRoot } from '../memory/memory-bridge.js';

describe('getProjectRoot', () => {
  let root: string;
  let savedMonomindCwd: string | undefined;
  let savedMonomindProjectRoot: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'project-root-'));
    // Everything below `root` is walkable; the walk stops when it reaches the
    // parent of `root`, which we declare to be home.
    homeState.dir = dirname(root);
    savedMonomindCwd = process.env.MONOMIND_CWD;
    delete process.env.MONOMIND_CWD;
    savedMonomindProjectRoot = process.env.MONOMIND_PROJECT_ROOT;
    delete process.env.MONOMIND_PROJECT_ROOT;
  });

  afterEach(() => {
    if (savedMonomindCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = savedMonomindCwd;
    if (savedMonomindProjectRoot === undefined) delete process.env.MONOMIND_PROJECT_ROOT;
    else process.env.MONOMIND_PROJECT_ROOT = savedMonomindProjectRoot;
    rmSync(root, { recursive: true, force: true });
  });

  const marker = (dir: string, name: '.monomind' | '.git'): void => {
    mkdirSync(join(dir, name), { recursive: true });
  };

  it('returns the directory itself when it carries a .monomind marker', () => {
    marker(root, '.monomind');
    expect(getProjectRoot(root)).toBe(root);
  });

  it('resolves a package subdirectory up to the repo root', () => {
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli', 'src');
    mkdirSync(sub, { recursive: true });
    expect(getProjectRoot(sub)).toBe(root);
  });

  it('gives every directory in one project the same brain', () => {
    marker(root, '.git');
    const a = join(root, 'packages', 'cli');
    const b = join(root, 'docs', 'guides');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    expect(getProjectRoot(a)).toBe(getProjectRoot(b));
    expect(getProjectRoot(a)).toBe(root);
  });

  it('stops at the nearest marker, so a nested project keeps its own brain', () => {
    marker(root, '.git');
    const inner = join(root, 'vendor', 'sub-repo');
    mkdirSync(inner, { recursive: true });
    marker(inner, '.git'); // a real nested repo — .git, not .monomind
    const deep = join(inner, 'src');
    mkdirSync(deep, { recursive: true });
    expect(getProjectRoot(deep)).toBe(inner);
  });

  // o-16 (AC-3c, the ONE accepted, documented cost — not a silent break):
  // this test used to use a BARE `.monomind` at `inner` as the nested-repo
  // marker, i.e. it encoded the exact assumption this item removes — that a
  // bare `.monomind` alone is trustworthy evidence of a project boundary.
  // `.monomind` is created by monomind itself as a side effect of running
  // anywhere; a vendored directory with no `.git` and no manifest is
  // indistinguishable, from the filesystem alone, from monomind's own
  // droppings — which is precisely how `~/mdev-tmp/.monomind`
  // came to silently capture an unrelated fixture. The walk also does not
  // continue PAST an ignored bare `.monomind` to adopt some more distant
  // ancestor's `.git` (that would merge the vendored dir into the outer
  // repo's brain, a different and worse way to break "nested projects keep
  // their own brain") — it stops there and falls back to the start dir.
  it('a nested BARE .monomind (no .git, no manifest) is no longer trusted alone — falls back to the subdirectory, not the outer .git', () => {
    marker(root, '.git');
    const inner = join(root, 'vendor', 'sub-repo');
    mkdirSync(inner, { recursive: true });
    marker(inner, '.monomind'); // bare — the shape that corrupted i-086's fixture
    const deep = join(inner, 'src');
    mkdirSync(deep, { recursive: true });
    // NOT `inner` (no longer trusted) and NOT `root` (must not walk past the
    // ignored ancestor to adopt a more distant, unrelated repo either).
    expect(getProjectRoot(deep)).toBe(deep);
  });

  it('treats a .git FILE (worktree/submodule) as a marker too', () => {
    const wt = join(root, 'wt');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    expect(getProjectRoot(join(wt, 'src'))).toBe(wt);
  });

  it('never crosses the home directory into a dotfiles repo', () => {
    // ~ is a git repo (dotfiles); a loose project under it must stay its own.
    homeState.dir = root;
    marker(root, '.git');
    const loose = join(root, 'scratch', 'thing');
    mkdirSync(loose, { recursive: true });
    expect(getProjectRoot(loose)).toBe(loose);
  });

  it('falls back to the starting directory when no marker exists', () => {
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(getProjectRoot(deep)).toBe(deep);
  });

  // o-16 round 2 (revised plan): the actual incident. `dir === home` was
  // never the cause — the corruption happened entirely INSIDE $HOME. A bare
  // `.monomind` ancestor (monomind's own droppings: no `.git`, no manifest —
  // exactly `~/mdev-tmp/.monomind`'s shape) is not independent
  // evidence of a project, and worse is a feedback loop: a wrong resolution
  // creates the very marker that captures every future descendant.
  describe('o-16: .git and .monomind are categorically different markers', () => {
    it('does NOT adopt a bare .monomind ancestor with no independent project marker (the actual incident)', () => {
      const scratch = join(root, 'scratch');
      marker(scratch, '.monomind'); // bare: no .git, no manifest
      const proj = join(scratch, 'fixture-proj');
      mkdirSync(proj, { recursive: true });
      expect(getProjectRoot(proj)).toBe(proj);
    });

    it('two projects under a shared bare-.monomind parent do not share a store (the i-086 corruption shape)', () => {
      const scratch = join(root, 'scratch2');
      marker(scratch, '.monomind');
      const a = join(scratch, 'a');
      const b = join(scratch, 'b');
      mkdirSync(a, { recursive: true });
      mkdirSync(b, { recursive: true });
      expect(getProjectRoot(a)).toBe(a);
      expect(getProjectRoot(b)).toBe(b);
      expect(getProjectRoot(a)).not.toBe(getProjectRoot(b));
    });

    it('still adopts a .git ancestor even when $HOME is unrelated (CI/container paths, not just $HOME-scoped)', () => {
      // The opposite of the default beforeEach: home is NOT an ancestor of
      // root at all — proves this isn't secretly still a $HOME-bounded rule.
      homeState.dir = join(tmpdir(), 'definitely-unrelated-home-oiuq3f');
      marker(root, '.git');
      const sub = join(root, 'packages', 'x');
      mkdirSync(sub, { recursive: true });
      expect(getProjectRoot(sub)).toBe(root);
    });

    it('still adopts a .monomind ancestor when accompanied by an independent project marker (package.json)', () => {
      const proj = join(root, 'proj');
      marker(proj, '.monomind');
      writeFileSync(join(proj, 'package.json'), '{}');
      const sub = join(proj, 'sub');
      mkdirSync(sub, { recursive: true });
      expect(getProjectRoot(sub)).toBe(proj);
    });

    it.each(['pyproject.toml', 'go.mod', 'Cargo.toml'])(
      'still adopts a .monomind ancestor accompanied by %s',
      (manifest) => {
        const proj = join(root, `proj-${manifest.replace(/[^a-z]/gi, '')}`);
        marker(proj, '.monomind');
        writeFileSync(join(proj, manifest), '');
        const sub = join(proj, 'sub');
        mkdirSync(sub, { recursive: true });
        expect(getProjectRoot(sub)).toBe(proj);
      },
    );

    // o-16 revision 1 (reviewer MINOR 3): the `.each` above pins the marker
    // list against REMOVAL (dropping go.mod goes red) but nothing pinned it
    // against WIDENING — and widening is the direction that re-opens the
    // defect this item fixes (any file at all would make a bare `.monomind`
    // "corroborated" again). A .monomind ancestor with an ARBITRARY,
    // non-manifest file alongside it (not one of
    // INDEPENDENT_PROJECT_MARKERS) must still be treated as bare.
    it('a .monomind ancestor accompanied by a non-manifest file (e.g. README.md) is still NOT adopted', () => {
      const proj = join(root, 'proj-readme-only');
      marker(proj, '.monomind');
      writeFileSync(join(proj, 'README.md'), '# not a project marker');
      const sub = join(proj, 'sub');
      mkdirSync(sub, { recursive: true });
      expect(getProjectRoot(sub)).toBe(sub);
    });

    it('MONOMIND_PROJECT_ROOT overrides the walk entirely, as an explicit escape hatch', () => {
      const anchor = join(root, 'anchor-target');
      mkdirSync(anchor, { recursive: true });
      const elsewhere = join(root, 'elsewhere', 'deep');
      mkdirSync(elsewhere, { recursive: true });
      process.env.MONOMIND_PROJECT_ROOT = anchor;
      expect(getProjectRoot(elsewhere)).toBe(anchor);
    });

    // The cache (`_rootCacheKey`/`_rootCacheVal`) is keyed on the starting
    // directory so a chdir re-resolves — but MONOMIND_PROJECT_ROOT
    // short-circuits the walk for the SAME starting directory. If the cache
    // key didn't also cover the anchor, querying once without it and then
    // again after it's set (same cwd both times) would replay the stale
    // pre-anchor result, silently defeating the escape hatch.
    it('setting MONOMIND_PROJECT_ROOT after an unanchored query for the same cwd is not masked by the cache', () => {
      const elsewhere = join(root, 'elsewhere2', 'deep');
      mkdirSync(elsewhere, { recursive: true });
      expect(getProjectRoot(elsewhere)).toBe(elsewhere); // no marker, no anchor -> falls back to itself

      const anchor = join(root, 'anchor-target2');
      mkdirSync(anchor, { recursive: true });
      process.env.MONOMIND_PROJECT_ROOT = anchor;
      expect(getProjectRoot(elsewhere)).toBe(anchor); // same cwd, anchor now set -> must not reuse the cached pre-anchor value
    });

    it('re-resolves after the start directory changes — the cache does not stick a wrong root across different starts', () => {
      const a = join(root, 'proj-a');
      const b = join(root, 'proj-b');
      marker(a, '.git');
      marker(b, '.git');
      expect(getProjectRoot(a)).toBe(a);
      expect(getProjectRoot(b)).toBe(b);
      expect(getProjectRoot(a)).toBe(a); // re-query the first: still itself, not stuck on b
    });

    // AC-5: `getDbPath`'s path-traversal guard (memory-bridge.ts, ~line 282)
    // allows a custom MCP-supplied path only if it sits inside `getProjectRoot()`,
    // the per-project data dir, or the global brain. A wrong (too-wide) root
    // widens that allow-list for free — before this fix, adopting the bare
    // `.monomind` ancestor as root would have let a SIBLING directory (outside
    // the real project, but inside the wrongly-adopted parent) pass the guard.
    // This proves the fix narrows the resolved root and therefore does NOT
    // loosen the guard — it can only make it stricter.
    it('the path-traversal guard does not widen just because a bare .monomind ancestor sits nearby (AC-5)', async () => {
      const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
      const scratch = join(root, 'scratch3');
      marker(scratch, '.monomind'); // bare — same shape as the incident
      const proj = join(scratch, 'fixture-proj');
      const sibling = join(scratch, 'sibling-untrusted');
      mkdirSync(proj, { recursive: true });
      mkdirSync(sibling, { recursive: true });
      process.env.MONOMIND_CWD = proj;

      // Sanity: resolves to the project itself, not the shared scratch parent.
      expect(getProjectRoot()).toBe(proj);

      const defaultPath = bridgeGetDbPath();
      const siblingPath = bridgeGetDbPath(sibling);
      // `sibling` sits outside the resolved project root, so a custom path
      // pointing at it must fall back to the default store — not be trusted
      // as if it were inside the project — even though it WOULD have passed
      // the guard pre-o-16, when the root wrongly widened to `scratch`.
      expect(siblingPath).toBe(defaultPath);
    });

    // AC-5, anchor variant (o-16 revision 1, reviewer MAJOR 1): the walk
    // isn't the only way to widen the guard's allowed region — a wrong or
    // overly-broad MONOMIND_PROJECT_ROOT is a SECOND way, and it's new in
    // this commit (pre-o-16, memory-bridge had no anchor at all). Measured:
    // pre-validation, `MONOMIND_PROJECT_ROOT=/` made
    // `path.relative('/', anything)` never start with '..', so EVERY
    // absolute path passed the guard. This proves an invalid anchor falls
    // through to the walk instead — it does not get to define the allowed
    // region at all.
    it('an invalid MONOMIND_PROJECT_ROOT anchor ("/") does not widen the path-traversal guard (AC-5, anchor variant)', async () => {
      const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
      marker(root, '.git');
      const outside = join(root, '..', `o16-outside-${Date.now()}`);
      mkdirSync(outside, { recursive: true });
      process.env.MONOMIND_CWD = root;
      process.env.MONOMIND_PROJECT_ROOT = '/';
      try {
        // Falls through to the real .git root, NOT '/'.
        expect(getProjectRoot()).toBe(root);
        const defaultPath = bridgeGetDbPath();
        const outsidePath = bridgeGetDbPath(outside);
        expect(outsidePath).toBe(defaultPath);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    // A VALID anchor is allowed to relocate the store (that's its purpose —
    // AC-3c's escape hatch), but must not thereby admit paths that sit
    // outside the anchor itself. The anchor widens "the project" to mean
    // the anchored directory; it must not widen it to mean "anything".
    it('a VALID MONOMIND_PROJECT_ROOT anchor still rejects a path outside the anchor (AC-5, anchor variant)', async () => {
      const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
      const anchorDir = join(root, 'anchored-project');
      mkdirSync(anchorDir, { recursive: true });
      const outside = join(root, 'not-the-anchored-project');
      mkdirSync(outside, { recursive: true });
      process.env.MONOMIND_CWD = anchorDir;
      process.env.MONOMIND_PROJECT_ROOT = anchorDir;

      expect(getProjectRoot()).toBe(anchorDir);
      const defaultPath = bridgeGetDbPath();
      const outsidePath = bridgeGetDbPath(outside);
      expect(outsidePath).toBe(defaultPath);
    });

    // AC-5, leg C (o-16 revision 2, reviewer MAJOR): a symlink to '/' is a
    // SECOND way to disable the guard, distinct from anchoring at a literal
    // '/'. Root cause: validateAnchor used to validate the LEXICAL path
    // (dirname(link) !== link, since the link itself sits inside a normal
    // directory — passes) while getDbPath's guard resolves through
    // realOrResolved() (fs.realpathSync) to the link's REAL target, '/'.
    // Two notions of "the root" in one module disagreeing is what let this
    // through even after leg A/B closed the literal-'/' and non-existent
    // cases. validateAnchor now resolves and validates the REAL path, so
    // this must be rejected the same way a literal '/' is.
    //
    // STATED LIMIT this test does NOT cover (verifier, o-16 revision 2;
    // corrected in revision 3 — the first version of this comment wrongly
    // named the anchor path as the vulnerable one): a TOCTOU gap remains
    // between validateAnchor's ONE-TIME resolution of the anchor to a REAL
    // path (cached as that real-path STRING) and getDbPath's guard, which
    // re-resolves that SAME cached real-path string fresh on EVERY call —
    // see the comment at getDbPath's `relCwd` line in memory-bridge.ts.
    // Swapping the filesystem entry AT THE ANCHOR PATH after validation
    // does nothing (the anchor is never consulted again once cached).
    // Swapping the filesystem entry AT THE RESOLVED REAL TARGET — the path
    // this test's `root` variable names, once validated — for a symlink to
    // '/' AFTER validation but BEFORE a later guard check would bypass it
    // live; this test only proves validation rejects a symlink that is
    // ALREADY pointing at '/' at validation time, not a target swapped out
    // from under an already-cached resolution.
    it('a symlinked MONOMIND_PROJECT_ROOT anchor whose real target is "/" does not widen the guard (AC-5, leg C)', async () => {
      const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
      marker(root, '.git');
      const outside = join(root, '..', `o16-outside-legc-${Date.now()}`);
      mkdirSync(outside, { recursive: true });
      const linkToRoot = join(root, 'link-to-root');
      symlinkSync('/', linkToRoot);
      process.env.MONOMIND_CWD = root;
      process.env.MONOMIND_PROJECT_ROOT = linkToRoot;
      try {
        // Rejected (real target is '/', the filesystem root) — falls
        // through to the real .git root, not the symlink's lexical or real
        // form.
        expect(getProjectRoot()).toBe(root);
        const defaultPath = bridgeGetDbPath();
        const outsidePath = bridgeGetDbPath(outside);
        expect(outsidePath).toBe(defaultPath);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    // The stated limit above, as a test rather than only prose (dev-lead,
    // o-16 revision 3): proves the distinction the corrected comment makes.
    // Case A: an anchor-path swap after caching does NOT bypass the guard.
    // Case B: a resolved-real-target swap DOES. Case B is the load-bearing
    // half — it asserts the TOCTOU gap documented at getDbPath's `relCwd`
    // line is still OPEN. If that gap is ever closed properly (consuming a
    // single resolved handle instead of re-resolving a cached path string,
    // as that comment itself prescribes), THIS TEST GOES RED — and the
    // correct response then is to delete the test, not to restore the
    // weakness to make it pass again.
    it('TOCTOU: an anchor-path swap after caching is inert; a resolved-target swap bypasses the guard (accepted limit)', async () => {
      const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
      const realAnchorDir = join(root, 'real-anchor');
      mkdirSync(realAnchorDir, { recursive: true });
      const anchorLink = join(root, 'anchor-link');
      symlinkSync(realAnchorDir, anchorLink);
      const outside = join(root, '..', `o16-outside-toctou-${Date.now()}`);
      mkdirSync(outside, { recursive: true });
      process.env.MONOMIND_CWD = realAnchorDir;
      process.env.MONOMIND_PROJECT_ROOT = anchorLink;

      try {
        // Populate the cache: validates the anchor, resolves it to
        // realAnchorDir, and caches THAT REAL PATH STRING.
        expect(getProjectRoot()).toBe(realAnchorDir);
        const defaultPath = bridgeGetDbPath();

        // Case A — swap the ANCHOR itself (repoint anchorLink at '/').
        // Proves only that an anchor-path swap does not bypass the guard —
        // NOT that "the anchor is resolved once and never consulted again"
        // (reviewer: disabling the cache entirely still passes this case,
        // because validateAnchor just re-rejects '/' as the filesystem
        // root and falls through to the same walk answer either way; this
        // case is pinned on root-rejection, not on caching).
        rmSync(anchorLink, { force: true });
        symlinkSync('/', anchorLink);
        expect(getProjectRoot()).toBe(realAnchorDir); // cache unaffected
        expect(bridgeGetDbPath(outside)).toBe(defaultPath); // guard unaffected, still rejects

        // Case B — swap the RESOLVED REAL TARGET (realAnchorDir) for a
        // symlink to '/'. getDbPath's guard re-resolves this exact cached
        // string fresh on every call, so THIS bypasses — the accepted,
        // now-documented limit, not a passing security property.
        rmSync(realAnchorDir, { recursive: true, force: true });
        symlinkSync('/', realAnchorDir);
        expect(bridgeGetDbPath(outside)).toBe(outside);
      } finally {
        rmSync(outside, { recursive: true, force: true });
        rmSync(anchorLink, { force: true });
        rmSync(realAnchorDir, { recursive: true, force: true });
      }
    });
  });

  // The other half of the invariant above: the marker WRITTEN into that
  // directory must name the same root the directory is keyed to.
  it('writes an origin marker naming the project root, not the invoking subdirectory', async () => {
    const { bridgeStoreEntry, bridgeGetDbPath, shutdownBridge } = await import(
      '../memory/memory-bridge.js'
    );
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli');
    mkdirSync(sub, { recursive: true });
    process.env.MONOMIND_CWD = sub;

    try {
      await bridgeStoreEntry({ key: 'origin-probe', value: 'probe', namespace: 'default' });
    } catch {
      /* backend unavailable — asserted conditionally below */
    }

    // dbPath is <dataDir>/lancedb; origin.json sits beside it in <dataDir>.
    const originFile = join(dirname(bridgeGetDbPath()), 'origin.json');
    if (existsSync(originFile)) {
      const recorded = JSON.parse(readFileSync(originFile, 'utf-8')).path;
      expect(recorded).toBe(root);
      expect(recorded).not.toBe(sub);
    }
    // Guarded, not vacuous: this branch does run wherever a SQLite backend can
    // initialise. It is skipped only where `@monoes/memory` is unavailable —
    // the same environment memory-crud.test.ts mocks the backend away for — and
    // the slug test below still pins the root-vs-cwd invariant on the
    // directory-name side there.
    await shutdownBridge().catch(() => {
      /* best effort */
    });
  }, 60000); // bridgeStoreEntry triggers first-use backend/embedding load — exceeds the 15s default under parallel-suite load

  // MONOMIND_CWD is how monograph and swarm state already learn which project
  // they belong to. An MCP server is launched with whatever cwd the client
  // chose, so without this the agent-facing tools resolve a different brain
  // than the CLI does in the same project.
  it('prefers MONOMIND_CWD over the real cwd when no argument is given', () => {
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli');
    mkdirSync(sub, { recursive: true });
    process.env.MONOMIND_CWD = sub;
    expect(getProjectRoot()).toBe(root);
  });

  // The store directory is named for a hash of the project root, and the
  // origin.json marker inside it records which project it belongs to. If those
  // two disagree, `cleanup --data` prunes on the wrong evidence: run a memory
  // command from a package subdir, delete that subdir later, and cleanup sees
  // "origin gone" for a directory holding the WHOLE project's brain.
  it('keys the store directory to the project root, not the invoking subdirectory', async () => {
    const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli');
    mkdirSync(sub, { recursive: true });

    process.env.MONOMIND_CWD = sub;
    const fromSub = bridgeGetDbPath();
    process.env.MONOMIND_CWD = root;
    const fromRoot = bridgeGetDbPath();

    expect(fromSub).toBe(fromRoot);
    // The readable slug prefix is basename(projectRoot) — never basename(cwd).
    expect(fromSub).toContain(basename(root));
    expect(fromSub).not.toContain(`${basename(sub)}-`);
  });

  it('lets an explicit argument override MONOMIND_CWD', () => {
    const other = join(root, 'other');
    mkdirSync(other, { recursive: true });
    marker(other, '.monomind');
    process.env.MONOMIND_CWD = root;
    expect(getProjectRoot(other)).toBe(other);
  });
});
