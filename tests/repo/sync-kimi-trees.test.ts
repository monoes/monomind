/**
 * Guard for the kimi half of `scripts/sync-claude-trees.mjs`.
 *
 * `.kimi-code/agents`, `.kimi-code/plugin/commands` and the command flow
 * skills under `.kimi-code/skills` are not mirrors: they are the OUTPUT of the
 * kimi converters in `src/init/write-kimicode.ts` run over the root
 * `.claude/{agents,commands,skills}` tree. Before this check nothing
 * regenerated or compared them, so they drifted until someone happened to run
 * `init --force` (commit 89561f139 regenerated 126 files at once).
 *
 * The fixtures inject a trivial converter so these tests pin the sync rules
 * (write missing/differing, delete stale, leave excepted dirs alone); the last
 * test runs the real, built converter against the live repo.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { syncKimiTrees } from '../../scripts/sync-claude-trees.mjs';

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

/** Stand-in converter: one agent, one skill, one command, fixed output. */
function fakeConvert() {
  return {
    agents: new Map([['coder.md', 'AGENT\n']]),
    skills: new Map([
      ['foo', 'SKILL\n'],
      ['bar-baz', 'FLOW\n'],
    ]),
    pluginCommands: new Map([['bar-baz.md', 'CMD\n']]),
    skipped: [],
  };
}

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-kimi-trees-'));
  created.push(root);
  write(root, '.kimi-code/agents/coder.md', 'AGENT\n'); // in sync
  write(root, '.kimi-code/agents/retired.md', 'OLD\n'); // stale
  write(root, '.kimi-code/skills/foo/SKILL.md', 'SKILL\n'); // in sync
  write(root, '.kimi-code/skills/foo/references/extra.md', 'kept\n'); // non-SKILL.md file
  write(root, '.kimi-code/skills/bar-baz/SKILL.md', 'OLD FLOW\n'); // differs
  write(root, '.kimi-code/skills/gone-flow/SKILL.md', 'OLD\n'); // stale dir
  write(root, '.kimi-code/skills/generated-elsewhere/SKILL.md', 'X\n'); // excepted
  // bar-baz.md plugin command missing
  write(root, '.kimi-code/plugin/commands/gone.md', 'OLD\n'); // stale
  return root;
}

const opts = (root: string, check: boolean) => ({
  root,
  check,
  convert: fakeConvert,
  exceptSkills: ['generated-elsewhere'],
});

describe('sync-claude-trees: kimi derived trees', () => {
  it('--check reports missing, differing and stale files without writing', () => {
    const root = makeFixture();
    const report = syncKimiTrees(opts(root, true));

    expect(report.missing).toEqual(['.kimi-code/plugin/commands/bar-baz.md']);
    expect(report.diverged).toEqual(['.kimi-code/skills/bar-baz/SKILL.md']);
    expect(report.stale).toEqual([
      '.kimi-code/agents/retired.md',
      '.kimi-code/plugin/commands/gone.md',
      '.kimi-code/skills/gone-flow',
    ]);
    expect(report.written).toEqual([]);
    expect(read(root, '.kimi-code/skills/bar-baz/SKILL.md')).toBe('OLD FLOW\n');
    expect(existsSync(join(root, '.kimi-code/agents/retired.md'))).toBe(true);
  });

  it('regenerates: writes missing/differing, removes stale, keeps excepted and extra files', () => {
    const root = makeFixture();
    syncKimiTrees(opts(root, false));

    expect(read(root, '.kimi-code/plugin/commands/bar-baz.md')).toBe('CMD\n');
    expect(read(root, '.kimi-code/skills/bar-baz/SKILL.md')).toBe('FLOW\n');
    expect(existsSync(join(root, '.kimi-code/agents/retired.md'))).toBe(false);
    expect(existsSync(join(root, '.kimi-code/plugin/commands/gone.md'))).toBe(false);
    expect(existsSync(join(root, '.kimi-code/skills/gone-flow'))).toBe(false);
    expect(read(root, '.kimi-code/skills/generated-elsewhere/SKILL.md')).toBe('X\n');
    expect(read(root, '.kimi-code/skills/foo/references/extra.md')).toBe('kept\n');

    const again = syncKimiTrees(opts(root, true));
    expect([...again.missing, ...again.diverged, ...again.stale]).toEqual([]);
  });

  it('the live repo kimi trees match the converters run over .claude/ (needs the built CLI)', () => {
    expect(() =>
      execFileSync('node', [SCRIPT, '--check'], { encoding: 'utf8', cwd: REPO_ROOT }),
    ).not.toThrow();
  });
});
