import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUnifiedRegistry, computeAgentRoots } from '../../src/agents/registry-builder.js';
import {
  ensureRegistry,
  findProjectRoot,
  registryIsStale,
  registryPath,
} from '../../src/agents/registry-freshness.js';
import { agentCatalog } from '../../src/decision/catalogs.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');

const agentMd = (fields: Record<string, string>, body = '# Agent') =>
  ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', body].join('\n');

let root = '';
// A fake home: user agents come from $HOME/.claude/agents, never the real one.
let home = '';
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-registry-home-'));
  vi.stubEnv('HOME', home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  root = '';
});

function userAgent(rel: string, fields: Record<string, string>): string {
  const file = join(home, '.claude', 'agents', rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, agentMd(fields));
  return file;
}

function project(): string {
  root = mkdtempSync(join(tmpdir(), 'agent-registry-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.claude', 'agents', 'core'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'agents', 'core', 'coder.md'),
    agentMd({ name: 'coder', description: 'Writes code' }),
  );
  return root;
}

describe('findProjectRoot', () => {
  it('walks up to the directory holding .claude/agents and stops at the git root', () => {
    project();
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    expect(findProjectRoot(join(root, 'src', 'deep'), '/nonexistent-home')).toBe(root);
    const bare = mkdtempSync(join(tmpdir(), 'agent-registry-bare-'));
    mkdirSync(join(bare, '.git'));
    mkdirSync(join(bare, 'sub'));
    expect(findProjectRoot(join(bare, 'sub'), '/nonexistent-home')).toBeNull();
    rmSync(bare, { recursive: true, force: true });
  });

  it('never treats the home directory (with its global ~/.monomind) as a project', () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-registry-home-'));
    mkdirSync(join(home, '.monomind'));
    mkdirSync(join(home, 'work'));
    expect(findProjectRoot(join(home, 'work'), home)).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });
});

describe('ensureRegistry', () => {
  it('builds a missing registry synchronously and skips a fresh one', () => {
    project();
    expect(registryIsStale(root)).toBe(true);
    expect(ensureRegistry(root)?.agents.map((a) => a.slug)).toEqual(['coder']);
    expect(registryIsStale(root)).toBe(false);
    expect(ensureRegistry(root)).toBeNull();
  });

  it('rebuilds when an agent file is newer than the registry', () => {
    project();
    ensureRegistry(root);
    const past = new Date(Date.now() - 60_000);
    utimesSync(registryPath(root), past, past);
    writeFileSync(join(root, '.claude', 'agents', 'core', 'tester.md'), agentMd({ name: 'tester' }));
    expect(ensureRegistry(root)?.agents.map((a) => a.slug).sort()).toEqual(['coder', 'tester']);
  });

  it('never replaces a non-empty registry with an empty one', () => {
    project();
    ensureRegistry(root);
    const before = readFileSync(registryPath(root), 'utf-8');
    const empty = mkdtempSync(join(tmpdir(), 'agent-registry-empty-'));
    const reg = buildUnifiedRegistry([join(empty, 'nothing')], registryPath(root));
    expect(reg.agents).toEqual([]);
    expect(readFileSync(registryPath(root), 'utf-8')).toBe(before);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('registry fields and duplicates', () => {
  it('records duplicate slugs instead of dropping them silently', () => {
    project();
    mkdirSync(join(root, '.claude', 'agents', 'squad'));
    writeFileSync(join(root, '.claude', 'agents', 'squad', 'coder.md'), agentMd({ name: 'coder 2' }));
    const reg = buildUnifiedRegistry([join(root, '.claude', 'agents')], undefined, { base: root });
    expect(reg.agents).toHaveLength(1);
    expect(reg.duplicates).toEqual([
      expect.objectContaining({ slug: 'coder', dropped: [expect.stringContaining('coder.md')] }),
    ]);
  });

  it('stores when_to_use, tags and vibe; the catalog leads with when_to_use and skips deprecated', () => {
    project();
    writeFileSync(
      join(root, '.claude', 'agents', 'core', 'coder.md'),
      [
        '---',
        'name: Coder',
        'slug: coder',
        'description: Implementation specialist',
        'when_to_use: Writing or changing production code',
        'vibe: Ships clean diffs',
        'tags:',
        '  - implementation',
        '  - refactor',
        'capabilities: [typescript]',
        '---',
        '# Coder',
      ].join('\n'),
    );
    writeFileSync(
      join(root, '.claude', 'agents', 'core', 'old.md'),
      agentMd({ name: 'old', deprecated: 'true', deprecatedBy: 'coder' }),
    );
    const reg = ensureRegistry(root);
    const coder = reg?.agents.find((a) => a.slug === 'coder');
    expect(coder).toMatchObject({
      whenToUse: 'Writing or changing production code',
      tags: ['implementation', 'refactor'],
      vibe: 'Ships clean diffs',
    });
    expect(jp.loadAgentCatalog(root)).toEqual([
      {
        id: 'coder',
        name: 'Coder',
        category: 'core',
        description: 'Writing or changing production code — Implementation specialist',
        text: 'core implementation refactor typescript Ships clean diffs',
        origin: 'project',
      },
    ]);
  });
});

describe('user agents (~/.claude/agents)', () => {
  it('indexes them with origin user and a ~/ filePath, never the absolute home path', () => {
    project();
    userAgent('personal/my-helper.md', { name: 'my-helper', description: 'My own helper' });
    const reg = ensureRegistry(root);
    const mine = reg?.agents.find((a) => a.slug === 'my-helper');
    expect(mine).toMatchObject({
      origin: 'user',
      category: 'personal',
      filePath: '~/.claude/agents/personal/my-helper.md',
    });
    expect(reg?.agents.find((a) => a.slug === 'coder')?.origin).toBe('project');
    expect(reg?.counts).toEqual({ project: 1, user: 1, extra: 0 });
    expect(readFileSync(registryPath(root), 'utf-8')).not.toContain(home);
  });

  it('lets a project agent win on slug and on frontmatter name, as Claude Code does', () => {
    project();
    userAgent('coder.md', { name: 'coder', description: 'My coder' });
    userAgent('other-file.md', { name: 'coder', description: 'Same name, other file' });
    userAgent('unique.md', { name: 'unique', description: 'Only mine' });
    const reg = ensureRegistry(root);
    const coder = reg?.agents.filter((a) => a.name === 'coder');
    expect(coder).toHaveLength(1);
    expect(coder?.[0]).toMatchObject({ origin: 'project', description: 'Writes code' });
    expect(reg?.agents.map((a) => a.slug).sort()).toEqual(['coder', 'unique']);
    expect(reg?.shadowed.map((s) => s.filePath).sort()).toEqual([
      '~/.claude/agents/coder.md',
      '~/.claude/agents/other-file.md',
    ]);
    // A shadowed user agent is expected, not a duplicate to warn about.
    expect(reg?.duplicates).toEqual([]);
  });

  it('keeps extra roots first, then project, then user', () => {
    project();
    const roots = computeAgentRoots(root, { env: { MONOMIND_EXTRA_AGENT_PATHS: '/x/extra' } });
    expect(roots.map((r) => r.origin)).toEqual(['extra', 'project', 'user']);
    expect(roots[2]).toMatchObject({ dir: join(home, '.claude', 'agents'), label: '~/.claude/agents' });
    expect(computeAgentRoots(root, { user: false }).map((r) => r.origin)).toEqual(['project']);
    // From the home directory the two .claude/agents are one root.
    expect(computeAgentRoots(home).map((r) => r.origin)).toEqual(['user']);
  });

  it('marks the registry stale when a user agent is added or changed', () => {
    project();
    ensureRegistry(root);
    expect(registryIsStale(root)).toBe(false);
    const later = new Date(Date.now() + 60_000);
    utimesSync(userAgent('late.md', { name: 'late', description: 'Added after the build' }), later, later);
    expect(registryIsStale(root)).toBe(true);
    expect(ensureRegistry(root)?.agents.map((a) => a.slug)).toContain('late');
  });

  it('carries origin into the pick catalog', () => {
    project();
    userAgent('my-helper.md', { name: 'my-helper', description: 'My own helper' });
    ensureRegistry(root);
    const origins = Object.fromEntries(
      jp.loadAgentCatalog(root).map((a: { id: string; origin: string }) => [a.id, a.origin]),
    );
    expect(origins).toEqual({ coder: 'project', 'my-helper': 'user' });
  });

  it('outside a project: sees user agents in memory and writes nothing', () => {
    userAgent('my-helper.md', { name: 'my-helper', description: 'My own helper' });
    root = mkdtempSync(join(tmpdir(), 'agent-registry-plain-'));
    mkdirSync(join(root, '.git'));
    const items = agentCatalog(root);
    expect(items.map((a) => [a.id, a.origin])).toEqual([['my-helper', 'user']]);
    expect(readdirSync(root)).toEqual(['.git']);
    expect(existsSync(join(home, '.monomind'))).toBe(false);
    expect(readdirSync(join(home, '.claude'))).toEqual(['agents']);
  });
});
