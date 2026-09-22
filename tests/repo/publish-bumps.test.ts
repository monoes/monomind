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
import { readFileSync } from 'node:fs';
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
