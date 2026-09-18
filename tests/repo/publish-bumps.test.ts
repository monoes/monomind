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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
