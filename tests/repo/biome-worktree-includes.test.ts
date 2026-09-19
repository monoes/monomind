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
    // start with `.monomind/`, matching none of them. That makes `!.monomind`
    // itself unfalsifiable by any behavioural test today: deleting it
    // produces byte-identical output here (verified against a real biome
    // run). It is a traversal-pruning hint for a large runtime tree, not a
    // correctness guard — see the structural test below for the only thing
    // that CAN pin it. What this test pins honestly is narrower: a root lint
    // never reports anything from inside .monomind, which would regress the
    // moment a positive include were ever changed to be un-anchored (a
    // leading `**/`) the way the exclusion itself was before #294/#297.
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

  // Structural, not behavioural — deliberately, per the comment above: no
  // biome run can currently distinguish `!.monomind` present from absent, so
  // the only honest guard against silently deleting the anchored line (or
  // reintroducing the unanchored `!**/.monomind`) is reading the config.
  it('anchors the .monomind exclusion (structural — the pruning hint above cannot be pinned behaviourally)', () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'biome.json'), 'utf8')) as {
      files: { includes: string[] };
    };
    expect(config.files.includes).toContain('!.monomind');
    expect(config.files.includes).not.toContain('!**/.monomind');
  });
});
