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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('doc counts are the same on every machine', () => {
  // The counts used to walk the working tree, so a gitignored or untracked
  // skill (the locally compiled monodesign skill, a scratch skill someone is
  // drafting) changed them: the committed docs said 89/84 bundled/pickable
  // skills where a checkout with monodesign compiled said 90/85. Only tracked
  // files plus the skills generated at pack time may count.
  // The probe goes in org-skills (counted through the same tracked-files gate)
  // rather than .claude/skills, which other repo tests list concurrently.
  it('an untracked skill in the shipped package does not change any count', () => {
    const probe = join(REPO_ROOT, 'packages/@monomind/cli/org-skills/zz-doc-counts-probe');
    mkdirSync(probe, { recursive: true });
    writeFileSync(
      join(probe, 'SKILL.md'),
      '---\nname: zz-doc-counts-probe\ndescription: untracked probe\n---\n\nprobe\n',
    );
    try {
      expect(() => {
        execFileSync('node', [join(REPO_ROOT, 'scripts', 'generate-doc-counts.mjs'), '--check'], {
          cwd: REPO_ROOT,
          stdio: 'pipe',
        });
      }).not.toThrow();
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });
});
