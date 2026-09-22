// packages/@monomind/cli/src/__tests__/cleanup-ownership-safety.test.ts
//
// Incident 2026-09-22: `monomind cleanup --force` run with cwd = a real
// repository deleted ~1000 git-TRACKED files (AGENTS.md, GEMINI.md, .agents/,
// .gemini/, ...) and wiped untracked user data (data/ memory store,
// .monomind/org-memory, .monomind/knowledge, the monograph DB) with no
// confirmation. cleanup must only ever remove what is provably monomind's.
//
// Every case runs in its own temp dir (TMPDIR), never the repo's cwd.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupCommand } from '../commands/cleanup.js';
import type { CleanupPlanEntry } from '../commands/cleanup-plan.js';
import type { CommandContext } from '../types.js';

const OWNED_AGENTS_MD = `<!-- monomind-block:agents-md -->
# AGENTS.md — Monomind on opencode

Generated body.
<!-- /monomind-block:agents-md -->
# monomind:start instructions:codex
Use the monomind MCP tools.
# monomind:end instructions:codex
`;

function makeCtx(cwd: string, flags: Record<string, unknown>): CommandContext {
  return { cwd, flags, args: [] } as unknown as CommandContext;
}

function write(root: string, rel: string, content = 'x'): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

async function run(cwd: string, flags: Record<string, unknown>) {
  const result = await cleanupCommand.action?.(makeCtx(cwd, flags));
  const data = (result?.data ?? {}) as { plan?: CleanupPlanEntry[] };
  return { result, plan: data.plan ?? [] };
}

function entry(plan: CleanupPlanEntry[], path: string): CleanupPlanEntry | undefined {
  return plan.find((e) => e.path === path);
}

describe('cleanup only removes what is provably monomind-owned', () => {
  let cwd: string;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  function newRepo(): string {
    cwd = mkdtempSync(join(tmpdir(), 'cleanup-ownership-'));
    git(cwd, 'init', '-q');
    return cwd;
  }

  it('never deletes a git-tracked AGENTS.md, even one that is entirely a monomind block', async () => {
    newRepo();
    write(cwd, 'AGENTS.md', OWNED_AGENTS_MD);
    git(cwd, 'add', 'AGENTS.md');

    const { result, plan } = await run(cwd, { force: true });

    expect(result?.success).toBe(true);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe(OWNED_AGENTS_MD);
    expect(entry(plan, 'AGENTS.md')).toMatchObject({ action: 'skip' });
    expect(entry(plan, 'AGENTS.md')?.reason).toMatch(/tracked/);
  });

  it('removes an untracked AGENTS.md that holds nothing but monomind blocks', async () => {
    newRepo();
    write(cwd, 'AGENTS.md', OWNED_AGENTS_MD);

    const { plan } = await run(cwd, { force: true });

    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    expect(entry(plan, 'AGENTS.md')).toMatchObject({ action: 'remove' });
  });

  it('keeps user content of an untracked AGENTS.md and removes only the monomind block', async () => {
    newRepo();
    const user = '# My project\n\nHand-written agent notes.\n';
    write(cwd, 'AGENTS.md', `${user}\n${OWNED_AGENTS_MD}`);

    const { plan } = await run(cwd, { force: true });

    const after = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(after).toContain('Hand-written agent notes.');
    expect(after).not.toContain('monomind');
    expect(entry(plan, 'AGENTS.md')).toMatchObject({ action: 'strip' });
  });

  it('keeps an untracked AGENTS.md with no monomind marker (cannot prove ownership)', async () => {
    newRepo();
    write(cwd, 'AGENTS.md', '# Mine\n');

    const { plan } = await run(cwd, { force: true });

    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('# Mine\n');
    expect(entry(plan, 'AGENTS.md')?.action).toBe('skip');
  });

  it('keeps user data under --force alone and removes it only with --purge-data', async () => {
    newRepo();
    write(cwd, 'data/memory/memory.db', 'db');
    write(cwd, '.monomind/org-memory/team/facts.md', 'fact');
    write(cwd, '.monomind/knowledge/index.json', '{}');
    write(cwd, '.monomind/monograph.db', 'graph');
    write(cwd, '.monomind/last-route.json', '{}');

    await run(cwd, { force: true });

    expect(existsSync(join(cwd, 'data/memory/memory.db'))).toBe(true);
    expect(existsSync(join(cwd, '.monomind/org-memory/team/facts.md'))).toBe(true);
    expect(existsSync(join(cwd, '.monomind/knowledge/index.json'))).toBe(true);
    expect(existsSync(join(cwd, '.monomind/monograph.db'))).toBe(true);
    // Plain monomind runtime state is still cleaned.
    expect(existsSync(join(cwd, '.monomind/last-route.json'))).toBe(false);

    const { plan } = await run(cwd, { force: true, 'purge-data': true });

    expect(existsSync(join(cwd, 'data/memory'))).toBe(false);
    expect(existsSync(join(cwd, '.monomind'))).toBe(false);
    expect(plan.some((e) => e.data && e.action === 'remove')).toBe(true);
  });

  it('honours MONOMIND_MEMORY_PATH as a protected data path', async () => {
    newRepo();
    write(cwd, 'store/mem/memory.db', 'db');
    const prev = process.env.MONOMIND_MEMORY_PATH;
    process.env.MONOMIND_MEMORY_PATH = './store/mem';
    try {
      const { plan } = await run(cwd, {});
      expect(entry(plan, 'store/mem')).toMatchObject({ action: 'skip', data: true });
      await run(cwd, { force: true });
      expect(existsSync(join(cwd, 'store/mem/memory.db'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MONOMIND_MEMORY_PATH;
      else process.env.MONOMIND_MEMORY_PATH = prev;
    }
  });

  it('removes untracked files inside .monomind but keeps tracked ones', async () => {
    newRepo();
    write(cwd, '.monomind/config.yaml', 'tracked: true\n');
    write(cwd, '.monomind/metrics/run.json', '{}');
    git(cwd, 'add', '.monomind/config.yaml');

    const { plan } = await run(cwd, { force: true });

    expect(readFileSync(join(cwd, '.monomind/config.yaml'), 'utf8')).toBe('tracked: true\n');
    expect(existsSync(join(cwd, '.monomind/metrics'))).toBe(false);
    expect(entry(plan, '.monomind/config.yaml')?.reason).toMatch(/tracked/);
  });

  it('in shared provider dirs removes only manifest-listed or marker-owned entries', async () => {
    newRepo();
    write(
      cwd,
      '.monomind/init-manifest.json',
      JSON.stringify({ version: 1, skills: ['mastermind'], commands: [], agents: [] }),
    );
    write(cwd, '.claude/skills/mastermind/SKILL.md', 'generated');
    write(cwd, '.claude/skills/my-own/SKILL.md', 'mine');
    write(cwd, '.claude/settings.local.json', '{}');
    write(cwd, '.gemini/rules/monomind.md', 'rules');
    write(cwd, '.gemini/settings.json', '{"user": true}');
    write(cwd, '.agents/tracked.md', 'tracked');
    git(cwd, 'add', '.agents/tracked.md');

    await run(cwd, { force: true });

    expect(existsSync(join(cwd, '.claude/skills/mastermind'))).toBe(false);
    expect(existsSync(join(cwd, '.claude/skills/my-own/SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.claude/settings.local.json'))).toBe(true);
    expect(existsSync(join(cwd, '.gemini/rules/monomind.md'))).toBe(false);
    expect(existsSync(join(cwd, '.gemini/settings.json'))).toBe(true);
    expect(existsSync(join(cwd, '.agents/tracked.md'))).toBe(true);
  });

  it('removes only the monomind entry from an untracked .mcp.json that has other servers', async () => {
    newRepo();
    write(
      cwd,
      '.mcp.json',
      JSON.stringify({ mcpServers: { monomind: { command: 'npx' }, other: { command: 'x' } } }),
    );

    await run(cwd, { force: true });

    const after = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    expect(after.mcpServers.monomind).toBeUndefined();
    expect(after.mcpServers.other).toEqual({ command: 'x' });
  });

  it('preview lists exactly what --force then does, including tracked and data skips', async () => {
    newRepo();
    write(cwd, 'AGENTS.md', OWNED_AGENTS_MD);
    git(cwd, 'add', 'AGENTS.md');
    write(cwd, 'GEMINI.md', '# Monomind for Antigravity (agy) — v2.15.6\n\nbody\n');
    write(
      cwd,
      'CLAUDE.md',
      `# Mine\n\n# monomind:start instructions:claude\nx\n# monomind:end instructions:claude\n`,
    );
    write(cwd, 'monomind.config.json', '{}');
    write(cwd, '.monomind/last-route.json', '{}');
    write(cwd, 'data/memory/memory.db', 'db');

    const preview = await run(cwd, {});
    // The preview must not touch anything.
    expect(existsSync(join(cwd, 'GEMINI.md'))).toBe(true);
    expect(existsSync(join(cwd, 'monomind.config.json'))).toBe(true);

    const applied = await run(cwd, { force: true });

    const summarize = (plan: CleanupPlanEntry[]) =>
      plan.map((e) => `${e.action} ${e.path} ${e.reason}`).sort();
    expect(summarize(applied.plan)).toEqual(summarize(preview.plan));
    expect(entry(preview.plan, 'AGENTS.md')?.action).toBe('skip');
    expect(entry(preview.plan, 'data/memory')).toMatchObject({ action: 'skip', data: true });
    for (const e of preview.plan) {
      if (e.action === 'remove') expect(existsSync(join(cwd, e.path))).toBe(false);
      if (e.action === 'skip') expect(existsSync(join(cwd, e.path))).toBe(true);
    }
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe('# Mine\n');
  });

  it('refuses --force in the monomind source repository itself', async () => {
    newRepo();
    write(cwd, 'package.json', JSON.stringify({ name: 'monomind' }));
    write(
      cwd,
      'packages/@monomind/cli/package.json',
      JSON.stringify({ name: '@monoes/monomindcli' }),
    );
    write(cwd, 'monomind.config.json', '{}');

    const { result } = await run(cwd, { force: true });

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
    expect(existsSync(join(cwd, 'monomind.config.json'))).toBe(true);
  });
});
