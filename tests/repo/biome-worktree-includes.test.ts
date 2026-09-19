/**
 * Guard for GH #294: `biome.json`'s exclusion of `.claude` must not follow a
 * checkout that LIVES under `.claude/`.
 *
 * This repo's own agent workflow puts git worktrees in `.claude/worktrees/`.
 * With the old depth-unanchored exclusion (a leading globstar before
 * `.claude`), every path inside such a worktree matched it, so
 * `npx biome check` from in there reported
 * "Checked 0 files … No files were processed" and naming a changed file
 * explicitly answered "These paths were provided but ignored". That reads as a
 * clean lint but is really biome refusing to look — the bug cost real review
 * rounds before it was spotted.
 *
 * The two assertions below are the two directions of the fix, exercised against
 * the REAL `biome.json` copied into a throwaway tree whose root sits at
 * `<tmp>/.claude/worktrees/wt` — the exact shape that used to break:
 *
 *   1. source under the CLI package's `src` tree is processed and its problems
 *      are reported;
 *   2. `.claude` assets (helpers, skills, agents) are STILL excluded — the
 *      exclusion's original intent, which the fix must not throw away.
 *
 * The only edit made to the copied config is `vcs.enabled: false`: biome
 * refuses to start when `useIgnoreFile` is set and the folder is not a git
 * checkout, and VCS ignore handling is orthogonal to the `files.includes` bug
 * under test.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require_ = createRequire(import.meta.url);

/** Absolute path to the biome executable this repo resolves. */
function biomeBin(): string {
  const pkgJson = require_.resolve('@biomejs/biome/package.json');
  const { bin } = require_(pkgJson) as { bin: string | Record<string, string> };
  return join(dirname(pkgJson), typeof bin === 'string' ? bin : bin.biome);
}

/** A throwaway checkout rooted at `<tmp>/<...nesting>` (e.g. `.claude/worktrees/wt`
 *  or `.monomind/orgs/monomind-dev/work/wt`), carrying the repo's real biome.json
 *  plus one misformatted source file. Callers add any extra fixture files their
 *  case needs (e.g. an asset under the excluded directory) on top of this. */
function makeWorktreeFixture(nesting: string[]): string {
  const root = join(mkdtempSync(join(tmpdir(), 'biome-wt-')), ...nesting);
  mkdirSync(join(root, 'packages', '@monomind', 'cli', 'src'), { recursive: true });

  const config = JSON.parse(readFileSync(join(REPO_ROOT, 'biome.json'), 'utf8'));
  config.vcs = { enabled: false };
  writeFileSync(join(root, 'biome.json'), `${JSON.stringify(config, null, 2)}\n`);

  // Deliberately misformatted, so "was it processed?" is answered by biome
  // reporting it — not merely by a non-zero file count.
  writeFileSync(
    join(root, 'packages', '@monomind', 'cli', 'src', 'probe.ts'),
    'export const   probe   =   {a:1,   b:2}\n',
  );
  return root;
}

/** Probes placed just inside each of biome.json's root-anchored positive
 *  includes (`packages/@monomind/*\/src/**`, `scripts/**`, `tests/**`), each
 *  nested one level under a `.monomind` directory — NOT at the checkout root,
 *  so this fixture is unaffected by the "checkout lives under .monomind"
 *  case the other #297 tests already cover. */
const NESTED_MONOMIND_PROBES = [
  'packages/@monomind/cli/src/.monomind/probe.ts',
  'scripts/.monomind/probe.ts',
  'tests/.monomind/probe.ts',
];

/** A plain checkout (root is NOT under `.monomind`) carrying one probe under
 *  each entry in `NESTED_MONOMIND_PROBES`. `mutateIncludes` lets a caller
 *  swap the anchored `!.monomind` back to the pre-#297 unanchored
 *  `!**\/.monomind` to build the "before" side of a comparison. */
function makeNestedMonomindFixture(mutateIncludes: (includes: string[]) => string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'biome-nested-'));
  for (const rel of NESTED_MONOMIND_PROBES) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'export const   probe   =   {a:1,   b:2}\n');
  }

  const config = JSON.parse(readFileSync(join(REPO_ROOT, 'biome.json'), 'utf8'));
  config.vcs = { enabled: false };
  config.files.includes = mutateIncludes(config.files.includes);
  writeFileSync(join(root, 'biome.json'), `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

/** Run `biome check [...args]` in `cwd`; biome exits non-zero on findings, which
 *  is expected here, so capture output either way. */
function biomeCheck(cwd: string, args: string[] = []): string {
  try {
    return execFileSync(process.execPath, [biomeBin(), 'check', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

describe('biome.json files.includes (GH #294)', () => {
  it('lints source inside a checkout that lives under .claude/worktrees', () => {
    const out = biomeCheck(makeWorktreeFixture(['.claude', 'worktrees', 'wt']));

    expect(out).not.toMatch(/No files were processed/);
    // The misformatted probe is actually reported, so the file was read, not
    // just counted.
    expect(out).toMatch(/packages[/\\]@monomind[/\\]cli[/\\]src[/\\]probe\.ts/);
  });

  it('still excludes .claude assets, which is what the exclusion is for', () => {
    const root = makeWorktreeFixture(['.claude', 'worktrees', 'wt']);
    mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
    writeFileSync(join(root, '.claude', 'helpers', 'probe.cjs'), 'module.exports   =   {a:1}\n');

    const out = biomeCheck(root, ['.claude/helpers/probe.cjs']);

    expect(out).toMatch(/These paths were provided but ignored/);
  });
});

describe('biome.json files.includes (GH #297)', () => {
  it('lints source inside a checkout that lives under .monomind/orgs/.../work', () => {
    const out = biomeCheck(
      makeWorktreeFixture(['.monomind', 'orgs', 'monomind-dev', 'work', 'wt']),
    );

    expect(out).not.toMatch(/No files were processed/);
    expect(out).toMatch(/Checked \d+ file/);
    // The misformatted probe is actually reported, so the file was read, not
    // just counted.
    expect(out).toMatch(/packages[/\\]@monomind[/\\]cli[/\\]src[/\\]probe\.ts/);
  });

  it("a root lint never reports content from the repo's own .monomind tree", () => {
    const root = makeWorktreeFixture(['.monomind', 'orgs', 'monomind-dev', 'work', 'wt']);

    // What these two probes actually pin, and what they do NOT: biome.json's
    // positive includes (packages/*/src/**, packages/@monomind/*/src/**,
    // tests/**, scripts/**) are all root-anchored, so neither probe below is
    // ever ADMITTED by a positive include in the first place — both paths
    // start with `.monomind/`, matching none of them. `!.monomind` itself is
    // NOT falsifiable by either probe: deleting it produces byte-identical
    // output here (verified against a real biome run — see the structural
    // test at the bottom of this file for the only thing that CAN pin
    // deletion). See "narrows ... from any-depth to root-only" below for the
    // probe that DOES discriminate anchored from unanchored — a nested
    // `.monomind` *inside* an already-included src/scripts/tests tree. What
    // THIS test pins honestly is narrower, and unconditional: a root lint
    // never reports anything from directly inside .monomind, full stop —
    // it says nothing about what would regress it (verified: un-anchoring
    // the positive includes ALONE, with `!.monomind` intact, does not flip
    // this — the exclusion still prunes these paths regardless).
    mkdirSync(join(root, '.monomind'), { recursive: true });
    writeFileSync(join(root, '.monomind', 'junk.ts'), 'export const   junk   =   {a:1}\n');
    const junkOut = biomeCheck(root, ['.monomind/junk.ts']);
    expect(junkOut).toMatch(/These paths were provided but ignored/);
    expect(junkOut).toMatch(/\.monomind[/\\]junk\.ts/);

    const nestedSrc = join(
      root,
      '.monomind',
      'orgs',
      'x',
      'work',
      'wt',
      'packages',
      '@monomind',
      'cli',
      'src',
    );
    mkdirSync(nestedSrc, { recursive: true });
    writeFileSync(join(nestedSrc, 'probe.ts'), 'export const   probe   =   {a:1,   b:2}\n');
    const nestedOut = biomeCheck(root, [
      '.monomind/orgs/x/work/wt/packages/@monomind/cli/src/probe.ts',
    ]);
    expect(nestedOut).toMatch(/These paths were provided but ignored/);
    expect(nestedOut).toMatch(
      /orgs[/\\]x[/\\]work[/\\]wt[/\\]packages[/\\]@monomind[/\\]cli[/\\]src[/\\]probe\.ts/,
    );
  });

  it('narrows the .monomind exclusion from any-depth to root-only: nested .monomind dirs under included trees are now linted by name', () => {
    // THE actual discriminator, found only after two rounds of unfalsifiable
    // probes: each path in NESTED_MONOMIND_PROBES matches a root-anchored
    // positive include (packages/@monomind/*/src/**, scripts/**, tests/**)
    // regardless of the `.monomind` exclusion — so whether it is linted
    // depends entirely on whether that exclusion is depth-unanchored
    // (matches `.monomind` at any depth, swallowing these nested ones too)
    // or root-anchored (matches only the top-level `.monomind`, leaving them
    // alone). Verified against real biome 2.5.8: anchored → all three linted
    // and named (4 files checked); unanchored → all three silently dropped,
    // none named (1 file checked, biome.json's own default coverage).
    //
    // What this test does NOT pin: deleting `!.monomind` entirely produces
    // byte-identical output to `actual` below — every probe is still
    // admitted by its positive include with no exclusion to prune it either
    // way. Only the structural test below can catch that; see its comment.
    //
    // `actual` copies the REAL, unmodified biome.json — this is the side
    // that must fail if the real file ever regresses to the unanchored form.
    // `referenceUnanchored` is a deliberately-constructed baseline (built the
    // same way regardless of what the real file says) representing the OLD
    // behaviour for comparison, so this half of the test keeps meaning even
    // when `actual`'s exclusion is deleted outright.
    const actual = makeNestedMonomindFixture((includes) => includes);
    const referenceUnanchored = makeNestedMonomindFixture((includes) => [
      ...includes.filter((p) => p !== '!.monomind' && p !== '!**/.monomind'),
      '!**/.monomind',
    ]);

    const actualOut = biomeCheck(actual);
    const referenceOut = biomeCheck(referenceUnanchored);

    for (const rel of NESTED_MONOMIND_PROBES) {
      const probePath = new RegExp(
        rel
          .split('/')
          .map((s) => s.replace('.', '\\.'))
          .join('[/\\\\]'),
      );
      expect(actualOut, rel).toMatch(probePath);
      expect(referenceOut, rel).not.toMatch(probePath);
    }
  });

  // Structural, not behavioural — deliberately. No behavioural test can
  // distinguish `!.monomind` present from deleted outright: every probe
  // above that a positive include admits is admitted whether or not the
  // exclusion exists at all, so a lint run looks identical either way. The
  // only thing that can pin "the line is still there" is reading the config.
  //
  // Why keep an inert-today line at all, then: it is inert for TWO
  // INDEPENDENT reasons, not one — (1) every positive include is
  // root-anchored, so nothing under `.monomind/` is ever admitted by an
  // include in the first place, and (2) `vcs.useIgnoreFile` + .gitignore's
  // `.monomind/*` already prunes the tree regardless of (1). It becomes
  // load-bearing only if BOTH are removed. Measured with biome 2.5.8: adding
  // a non-root-anchored include such as `**/*.ts` defeats (1) alone but NOT
  // (2) — deleting this line in that configuration still changes nothing
  // (the ignore-file pruning still holds the line). Disabling
  // `vcs.useIgnoreFile` is what actually arms it. So this line is a second,
  // independent layer of defense against the same tree ever being linted —
  // worth keeping, cheap to keep, and this test is what stops it from being
  // deleted unnoticed alongside its own guard.
  it('anchors the .monomind exclusion (structural — pins config text, since deletion is not behaviourally observable)', () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'biome.json'), 'utf8')) as {
      files: { includes: string[] };
    };
    expect(config.files.includes).toContain('!.monomind');
    expect(config.files.includes).not.toContain('!**/.monomind');
  });
});
