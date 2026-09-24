import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildUnifiedRegistry } from '../../src/agents/registry-builder.js';
import {
  ensureRegistry,
  findProjectRoot,
  registryIsStale,
  registryPath,
} from '../../src/agents/registry-freshness.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');

const agentMd = (fields: Record<string, string>, body = '# Agent') =>
  ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', body].join('\n');

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

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
      },
    ]);
  });
});
