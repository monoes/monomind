/**
 * #128: hand-maintained counts in docs (CLI subcommand counts, worker
 * counts, etc.) drift every time the underlying code changes — multiple
 * "docs: update all surfaces" commits have each fixed some and left others
 * stale. The sharpest live example found in the 2026-08-09 audit:
 * README.md/CLAUDE.md said "8 background workers" while doc/index.html,
 * doc/commands/cli-reference.md, doc/concepts/hooks.md,
 * doc/concepts/statusline.md, and doc/design-system.html all said "15" —
 * the real number (WORKER_CONFIGS in packages/@monomind/hooks) is 8.
 *
 * scripts/generate-doc-counts.mjs computes counts from source and
 * substitutes them into `<!-- doc-count:NAME -->N<!-- /doc-count:NAME -->`
 * markers. This test runs it in --check mode so CI (not just
 * prepublishOnly) fails the moment a marked doc value goes stale.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('#128: doc-count markers are up to date', () => {
  it('scripts/generate-doc-counts.mjs --check exits 0 (no stale marker)', () => {
    expect(() => {
      execFileSync('node', [join(REPO_ROOT, 'scripts', 'generate-doc-counts.mjs'), '--check'], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });
});
