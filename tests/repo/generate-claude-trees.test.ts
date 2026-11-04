/**
 * Guard for `scripts/generate-claude-trees.mjs`, which writes the gitignored
 * derived copies of the root `.claude/` tree (the npm-shipped package tree and
 * the .agents / .gemini / .kimi-code trees). Tested against a fixture repo so
 * the live trees are not touched.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkTrees,
  diffTrees,
  planTrees,
  writeTrees,
} from '../../scripts/generate-claude-trees.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = 'packages/@monomind/cli';
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'generate-claude-trees-'));
  created.push(root);
  write(root, '.claude/skills/alpha/SKILL.md', 'alpha\n');
  write(root, '.claude/skills/alpha/references/r.md', 'ref\n');
  write(root, '.claude/skills/monoagent-image/SKILL.md', 'repo-only skill\n');
  write(root, '.claude/agents/core/coder.md', 'coder\n');
  write(root, '.claude/helpers/hook.cjs', 'hook\n');
  write(root, '.claude/helpers/pre-commit', 'git hook\n');
  write(root, '.claude/settings.json', '{}\n');
  write(root, '.claude/settings.local.json', 'machine-local\n');
  write(root, '.claude/mcp.json', 'repo-only\n');
  write(root, `${PKG}/claude-overlay/agents/squad/boss.md`, 'overlay only\n');
  return root;
}

const kimiConvert = () => ({
  agents: new Map([['coder.md', 'kimi coder\n']]),
  pluginCommands: new Map(),
  skills: new Map([['alpha', 'kimi alpha\n']]),
});

describe('generate-claude-trees', () => {
  it('derives the package, platform and kimi trees from .claude plus the overlay', () => {
    const root = makeFixture();
    const wanted = planTrees({ root, kimiConvert });
    writeTrees({ outRoot: root, wanted });
    const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

    expect(read(`${PKG}/.claude/skills/alpha/SKILL.md`)).toBe('alpha\n');
    expect(read(`${PKG}/.claude/agents/squad/boss.md`)).toBe('overlay only\n');
    expect(read(`${PKG}/.claude/settings.json`)).toBe('{}\n');
    expect(read('.agents/skills/alpha/references/r.md')).toBe('ref\n');
    expect(read('.gemini/helpers/hook.cjs')).toBe('hook\n');
    expect(read('.kimi-code/agents/coder.md')).toBe('kimi coder\n');
    expect(read('.kimi-code/skills/alpha/SKILL.md')).toBe('kimi alpha\n');
    expect(read('.kimi-code/skills/alpha/references/r.md')).toBe('ref\n');

    // Repo-only and machine-local files never reach the shipped tree.
    for (const rel of [
      `${PKG}/.claude/mcp.json`,
      `${PKG}/.claude/settings.local.json`,
      `${PKG}/.claude/helpers/pre-commit`,
      `${PKG}/.claude/skills/monoagent-image/SKILL.md`,
      '.gemini/helpers/pre-commit',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(false);
    }
  });

  it('is idempotent and removes stale files from generated trees only', () => {
    const root = makeFixture();
    const wanted = planTrees({ root, kimiConvert });
    writeTrees({ outRoot: root, wanted });
    write(root, `${PKG}/.claude/agents/core/stale.md`, 'stale\n');
    write(root, '.gemini/helpers/statusline.sh', 'tracked extra\n');
    write(root, '.gemini/settings.json', 'hand-written\n');

    expect(diffTrees({ outRoot: root, wanted }).stale).toEqual([
      `${PKG}/.claude/agents/core/stale.md`,
    ]);
    const second = writeTrees({ outRoot: root, wanted });
    expect(second.written).toEqual([]);
    expect(second.removed).toEqual([`${PKG}/.claude/agents/core/stale.md`]);
    expect(existsSync(join(root, '.gemini/helpers/statusline.sh'))).toBe(true);
    expect(existsSync(join(root, '.gemini/settings.json'))).toBe(true);
  });

  it('reports a diverged generated file', () => {
    const root = makeFixture();
    const wanted = planTrees({ root, kimiConvert });
    writeTrees({ outRoot: root, wanted });
    write(root, '.agents/skills/alpha/SKILL.md', 'hand edit\n');
    expect(diffTrees({ outRoot: root, wanted }).diverged).toEqual([
      '.agents/skills/alpha/SKILL.md',
    ]);
  });

  it('regenerates the live repo deterministically and completely', async () => {
    expect(await checkTrees({ root: REPO_ROOT, kimi: false })).toEqual([]);
  }, 120_000);
});
