/**
 * Guard for `scripts/sync-claude-trees.mjs` — the tool that repairs what
 * `monomind init --force` does to this repo's own asset trees.
 *
 * Three properties matter, and two of them are opposites, so all are tested
 * against purpose-built fixture trees rather than the live repo:
 *
 *   - a file paired across both trees must be made to agree;
 *   - a file that exists in only ONE tree must survive untouched. The shipped
 *     `packages/@monomind/cli/.claude` tree is a deliberate SUPERSET, and the
 *     predecessor of this script (`sync-claude-assets.sh`) had to be hard-
 *     disabled precisely because its `rsync --delete` semantics would have
 *     wiped it. A sync that can delete is worse than no sync;
 *   - init's `monomind:start skills:…` ownership markers must be stripped, not
 *     propagated. The shipped tree is init's own asset SOURCE, so mirroring the
 *     markers into it makes the next init nest a second block inside the first
 *     (reproduced on 2.11.6) and publishes the markers to npm.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalContent, syncTrees } from '../../scripts/sync-claude-trees.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'sync-claude-trees.mjs');

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');

/**
 * A miniature of the real layout: a source tree, a mirror tree that is a
 * superset of it, one diverging file, one identical file, one file only in the
 * mirror, one only in the source, and one the way `init --force` leaves it.
 */
function makeFixture(): { root: string; mirrors: Array<Record<string, unknown>> } {
  const root = mkdtempSync(join(tmpdir(), 'sync-claude-trees-'));
  created.push(root);

  write(root, 'src/skills/diverged/SKILL.md', 'source version\n');
  write(root, 'mirror/skills/diverged/SKILL.md', 'stale mirror version\n');

  write(root, 'src/skills/identical/SKILL.md', 'same on both sides\n');
  write(root, 'mirror/skills/identical/SKILL.md', 'same on both sides\n');

  // Exactly the shape `init --force` leaves behind in the root tree.
  write(
    root,
    'src/skills/marked/SKILL.md',
    '# monomind:start skills:claude:marked\nthe body\n# monomind:end skills:claude:marked\n',
  );
  write(root, 'mirror/skills/marked/SKILL.md', 'the body\n');

  // The superset: present only in the mirror. Must survive.
  write(root, 'mirror/skills/shipped-only/SKILL.md', 'ships to npm users only\n');

  // Present only in the source (e.g. a machine-local root file). Must not be
  // created in the mirror.
  write(root, 'src/skills/root-only/SKILL.md', 'never shipped\n');

  return { root, mirrors: [{ source: 'src', mirror: 'mirror' }] };
}

describe('sync-claude-trees', () => {
  it('copies the source copy over a diverging mirror copy', () => {
    const { root, mirrors } = makeFixture();

    const report = syncTrees({ root, mirrors });

    expect(report.written).toContain('mirror/skills/diverged/SKILL.md');
    expect(read(root, 'mirror/skills/diverged/SKILL.md')).toBe('source version\n');
  });

  it('leaves a file that exists only in the mirror completely alone', () => {
    const { root, mirrors } = makeFixture();

    syncTrees({ root, mirrors });

    // The whole reason sync-claude-assets.sh had to be disabled.
    expect(read(root, 'mirror/skills/shipped-only/SKILL.md')).toBe('ships to npm users only\n');
  });

  it('does not create a mirror copy of a file that exists only in the source', () => {
    const { root, mirrors } = makeFixture();

    syncTrees({ root, mirrors });

    expect(() => read(root, 'mirror/skills/root-only/SKILL.md')).toThrow();
  });

  it('leaves an already-identical file untouched', () => {
    const { root, mirrors } = makeFixture();

    const report = syncTrees({ root, mirrors });

    expect(report.written).not.toContain('mirror/skills/identical/SKILL.md');
    expect(read(root, 'mirror/skills/identical/SKILL.md')).toBe('same on both sides\n');
  });

  it("strips init's ownership markers from the source instead of mirroring them", () => {
    const { root, mirrors } = makeFixture();

    syncTrees({ root, mirrors });

    // The shipped tree is init's own asset source: a marker copied into it
    // makes the next init nest a second block inside the first.
    expect(read(root, 'src/skills/marked/SKILL.md')).toBe('the body\n');
    expect(read(root, 'mirror/skills/marked/SKILL.md')).toBe('the body\n');
  });

  it('strips only the marker lines, never the body or another namespace', () => {
    // The opening marker is written over the blank line between frontmatter
    // and body, so removing it must put that line back — otherwise every
    // synced file sits one whitespace line away from its committed form.
    expect(
      canonicalContent(
        '---\nname: x\n---\n# monomind:start skills:claude:x\nbody line\n# monomind:end skills:claude:x\n',
      ),
    ).toBe('---\nname: x\n---\n\nbody line\n');

    // A file that never had a marker is returned untouched, gap or no gap.
    expect(canonicalContent('---\nname: x\n---\nbody line\n')).toBe(
      '---\nname: x\n---\nbody line\n',
    );

    // `instructions:` blocks are committed content owned by another subsystem.
    const instructions =
      '# monomind:start instructions:claude\nkeep me\n# monomind:end instructions:claude\n';
    expect(canonicalContent(instructions)).toBe(instructions);
  });

  it('is idempotent — a second run writes nothing', () => {
    const { root, mirrors } = makeFixture();

    syncTrees({ root, mirrors });
    const second = syncTrees({ root, mirrors });

    expect(second.written).toEqual([]);
    expect(second.pairs[0].diverged).toEqual([]);
    expect(second.pairs[0].unmarked).toEqual([]);
  });

  it('--check reports divergence without writing, and the CLI exits non-zero', () => {
    const { root, mirrors } = makeFixture();

    const report = syncTrees({ root, mirrors, check: true });

    // `marked` is reported as unmarked-at-source, not diverged: the mirror
    // already holds the canonical body, only the root copy carries markers.
    expect(report.pairs[0].diverged).toEqual(['skills/diverged/SKILL.md']);
    expect(report.pairs[0].unmarked).toEqual(['skills/marked/SKILL.md']);
    expect(report.written).toEqual([]);
    // Nothing written: both offending files are still as they were.
    expect(read(root, 'mirror/skills/diverged/SKILL.md')).toBe('stale mirror version\n');
    expect(read(root, 'src/skills/marked/SKILL.md')).toContain('monomind:start');
  });

  it('--check reports nothing once the trees agree', () => {
    const { root, mirrors } = makeFixture();

    syncTrees({ root, mirrors });
    const report = syncTrees({ root, mirrors, check: true });

    expect(report.pairs[0].diverged).toEqual([]);
    expect(report.pairs[0].unmarked).toEqual([]);
  });

  it('honours per-mirror exceptions and flags one that is no longer needed', () => {
    const { root } = makeFixture();
    const mirrors = [
      {
        source: 'src',
        mirror: 'mirror',
        // `identical` is listed but the two copies already agree — a stale
        // exception, which must be reported so the list cannot rot.
        exceptions: ['skills/diverged/SKILL.md', 'skills/identical/SKILL.md'],
      },
    ];

    const report = syncTrees({ root, mirrors });

    expect(report.written).not.toContain('mirror/skills/diverged/SKILL.md');
    expect(read(root, 'mirror/skills/diverged/SKILL.md')).toBe('stale mirror version\n');
    expect(report.staleExceptions).toEqual(['mirror/skills/identical/SKILL.md']);
  });

  // `.gemini/helpers` is a full install copy of `.claude/helpers` (init copies
  // the whole helper tree into both), so that mirror also gains missing files.
  it('a copyMissing mirror gains source-only files, and --check counts them', () => {
    const { root } = makeFixture();
    const mirrors = [{ source: 'src', mirror: 'mirror', copyMissing: true }];

    const check = syncTrees({ root, mirrors, check: true });
    expect(check.pairs[0].missing).toEqual(['skills/root-only/SKILL.md']);
    expect(() => read(root, 'mirror/skills/root-only/SKILL.md')).toThrow();

    const report = syncTrees({ root, mirrors });
    expect(report.written).toContain('mirror/skills/root-only/SKILL.md');
    expect(read(root, 'mirror/skills/root-only/SKILL.md')).toBe('never shipped\n');
    // Still never deletes the mirror's own files.
    expect(read(root, 'mirror/skills/shipped-only/SKILL.md')).toBe('ships to npm users only\n');
    expect(syncTrees({ root, mirrors, check: true }).pairs[0].missing).toEqual([]);
  });

  it('the live repo is in its canonical form — this is what makes --check a usable guard', () => {
    expect(() =>
      execFileSync('node', [SCRIPT, '--check'], { encoding: 'utf8', cwd: REPO_ROOT }),
    ).not.toThrow();
  });
});
