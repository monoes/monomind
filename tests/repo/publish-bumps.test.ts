/**
 * Monorepo-wide guard: a publishable package whose shipped code changed must
 * have a version bump before the next release.
 *
 * ## The failure this pins
 *
 * 2.11.4 shipped a monograph fix that no user could get. The fix was merged,
 * tagged and present in `packages/@monomind/monograph`, but that package kept
 * version 1.6.4 — the version already on npm from five days earlier. Only the
 * CLI and the umbrella were bumped and published.
 *
 * Every sibling is pinned as `workspace:*`, which pnpm rewrites at pack time
 * to the version the package declares. Unchanged, it resolves to the tarball
 * already on npm, so the published CLI depends on the OLD build. Nothing looks
 * wrong: CI is green, the tag holds the commit, `npm view` shows the release.
 * The installed tree simply has no trace of the fix.
 *
 * Running it here, not only at prepublishOnly, is the point: by the time a
 * release is being published the mistake has already been made, and the cost
 * of finding out is a whole extra release cycle.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs build script, no types
import { formatStaleEntry } from '../../scripts/check-package-bumps.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('publishable packages are bumped when their shipped code changes', () => {
  it('scripts/check-package-bumps.mjs exits 0', () => {
    expect(() => {
      execFileSync('node', [join(REPO_ROOT, 'scripts', 'check-package-bumps.mjs')], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        env: { ...process.env, MONOMIND_ALLOW_STALE_PACKAGES: '' },
      });
    }).not.toThrow();
  });

  it('the escape hatch is honoured, so a deliberate no-op release is not blocked', () => {
    const out = execFileSync('node', [join(REPO_ROOT, 'scripts', 'check-package-bumps.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, MONOMIND_ALLOW_STALE_PACKAGES: '1' },
    });
    expect(out).toContain('skipped');
  });
});

/**
 * The guard's verdict was right; its explanation was not. It said
 *
 *     @monoes/monobrowse is still 1.0.20, which is already on npm, but has
 *     1 commit(s) to shipped files since that version was set
 *
 * and the "already on npm" clause was invented: nothing in this script
 * contacts the registry. The first time it mattered the claim was false —
 * 1.0.20 had never been published, npm was on 1.0.19 — which sent the reader
 * chasing a publish that had not happened. The rule is unchanged; the message
 * now states only what the script can see from git.
 */
describe('the stale-package message states what the guard actually knows', () => {
  const entry = {
    pkg: { name: '@monoes/monobrowse', version: '1.0.20', dir: 'packages/@monoes/monobrowse' },
    since: '89b25c2ca1959d95f6e03d31f4e234adbf8e6b46',
    changes: ['1c32948b7 fix(monobrowse): a shipped change'],
  };

  it('names the declared version, the commit that set it, and the commits since', () => {
    const msg = formatStaleEntry(entry);

    expect(msg).toContain('@monoes/monobrowse declares 1.0.20 (set in 89b25c2ca)');
    expect(msg).toContain('1 commit(s)');
    expect(msg).toContain('1c32948b7 fix(monobrowse): a shipped change');
  });

  it('says the publication status is unknown instead of asserting it', () => {
    const msg = formatStaleEntry(entry);

    // THE BUG: this clause was printed unconditionally, without ever asking npm.
    expect(msg).not.toContain('already on npm');
    expect(msg).toContain('Whether 1.0.20 is on npm is not checked here');
    expect(msg).toContain('may be published already or not at all');
  });

  it('is unknown because the guard makes no registry call — and must not start', () => {
    // If this ever fails, the message may state the publication status for
    // real; until then "unknown" is the only honest wording. A check that
    // blocks a build stays offline: a flaky registry must not fail a publish.
    const src = readFileSync(join(REPO_ROOT, 'scripts', 'check-package-bumps.mjs'), 'utf8');
    const code = src.slice(src.indexOf('*/') + 2); // skip the header comment

    expect(code).not.toMatch(/npm\s+view|registry\.npmjs|fetch\(|https?:\/\//);
  });
});

/**
 * Release 2.24.0 (#636) published eight sub-packages at 2.24.0 although each has its own semver line
 * (monofence-ai 1.0.7, monobrowse 1.0.30, ...): the release PREP brief said "bump every publishable
 * package.json" and the guard above only asks that a version MOVED, so a forced jump passed every gate and
 * cannot be unpublished. A sub-package whose MAJOR version rises since the last release tag must have a
 * breaking commit (`type(scope)!:` subject or a `BREAKING CHANGE:` footer) touching it in that range.
 */
describe('a sub-package does not jump a major version without a breaking change (#636)', () => {
  // @ts-expect-error — plain .mjs build script, no types
  const mod = import('../../scripts/check-package-bumps.mjs');
  const sh = (cwd: string, ...a: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@e.invalid', '-c', 'commit.gpgsign=false', ...a],
      {
        cwd,
        encoding: 'utf8',
      },
    );
  const write = (root: string, rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const pkg = (version: string) => `${JSON.stringify({ name: '@x/a', version }, null, 2)}\n`;
  function repo() {
    const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'bump-mag-'));
    sh(root, 'init', '-q', '-b', 'main');
    write(root, 'packages/@x/a/package.json', pkg('1.0.3'));
    write(root, 'packages/@x/a/src/index.js', 'export const v = 1;\n');
    sh(root, 'add', '-A');
    sh(root, 'commit', '-q', '-m', 'chore(release): publish 1.0.0');
    sh(root, 'tag', 'v1.0.0');
    return root;
  }
  const commit = (root: string, msg: string, version: string) => {
    write(root, 'packages/@x/a/package.json', pkg(version));
    write(root, 'packages/@x/a/src/index.js', `export const v = ${Math.random()};\n`);
    sh(root, 'add', '-A');
    sh(root, 'commit', '-q', '-m', msg);
  };

  it('bumpMagnitudeProblem flags only a rising major without a breaking change', async () => {
    const { bumpMagnitudeProblem } = await mod;
    expect(
      bumpMagnitudeProblem({ name: 'p', from: '1.0.30', to: '2.24.0', breaking: false }),
    ).toMatch(/p: 1\.0\.30 -> 2\.24\.0/);
    expect(
      bumpMagnitudeProblem({ name: 'p', from: '1.0.30', to: '2.24.0', breaking: true }),
    ).toBeNull();
    expect(
      bumpMagnitudeProblem({ name: 'p', from: '1.0.30', to: '1.0.31', breaking: false }),
    ).toBeNull();
    expect(
      bumpMagnitudeProblem({ name: 'p', from: '1.0.30', to: '1.1.0', breaking: false }),
    ).toBeNull();
    expect(
      bumpMagnitudeProblem({ name: 'p', from: '1.0.30', to: '1.0.30', breaking: false }),
    ).toBeNull();
  });

  it('a forced jump to the release number is found, with the tag it is measured from', async () => {
    const { majorBumpsSinceLastRelease } = await mod;
    const root = repo();
    commit(root, 'chore(release): publish 2.24.0', '2.24.0');
    const r = majorBumpsSinceLastRelease(root);
    expect(r.baseTag).toBe('v1.0.0');
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('@x/a: 1.0.3 -> 2.24.0');
  });

  it('an ordinary patch or minor bump passes, and so does a major with a breaking commit', async () => {
    const { majorBumpsSinceLastRelease } = await mod;
    const patch = repo();
    commit(patch, 'fix(a): something', '1.0.4');
    expect(majorBumpsSinceLastRelease(patch).problems).toEqual([]);
    const breaking = repo();
    commit(breaking, 'feat(a)!: drop the old export', '2.0.0');
    expect(majorBumpsSinceLastRelease(breaking).problems).toEqual([]);
    const footer = repo();
    commit(footer, 'feat(a): new shape\n\nBREAKING CHANGE: the export is renamed', '2.0.0');
    expect(majorBumpsSinceLastRelease(footer).problems).toEqual([]);
  });

  it('without any release tag (a shallow clone) it says so and flags nothing', async () => {
    const { majorBumpsSinceLastRelease } = await mod;
    const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'bump-mag-'));
    sh(root, 'init', '-q', '-b', 'main');
    write(root, 'packages/@x/a/package.json', pkg('9.0.0'));
    sh(root, 'add', '-A');
    sh(root, 'commit', '-q', '-m', 'init');
    expect(majorBumpsSinceLastRelease(root)).toEqual({ baseTag: null, problems: [] });
  });

  it('the script on this repository still exits 0 (the sub-packages are on their 2.24.0 baseline now)', () => {
    expect(() =>
      execFileSync('node', [join(REPO_ROOT, 'scripts', 'check-package-bumps.mjs')], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        env: { ...process.env, MONOMIND_ALLOW_STALE_PACKAGES: '', MONOMIND_ALLOW_MAJOR_BUMP: '' },
      }),
    ).not.toThrow();
  });
});
