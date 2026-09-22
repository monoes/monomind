import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickAction } from '../../src/commands/pick.js';

describe('monomind pick', () => {
  let root = '';
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('prints keyword-ranked JSON when no decision model is configured', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    root = mkdtempSync(join(tmpdir(), 'pick-cmd-'));
    mkdirSync(join(root, '.monomind'));
    writeFileSync(
      join(root, '.monomind', 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'coder', name: 'coder', category: 'core', description: 'Writes code' },
          { slug: 'tester', name: 'tester', category: 'core', description: 'Writes unit tests' },
          { slug: 'seo', name: 'SEO', category: 'marketing', description: 'Search ranking' },
        ],
      }),
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    const res = await pickAction({
      args: [],
      flags: { _: [], task: 'write tests for the parser', json: true, agents: true, categories: 'core' },
      cwd: root,
      interactive: false,
    });
    expect(res.success).toBe(true);
    const out = JSON.parse(logs.join('\n'));
    expect(out.agents.method).toBe('keyword');
    expect(out.agents.ranked[0].id).toBe('tester');
    expect(out.agents.ranked.map((a: { id: string }) => a.id)).not.toContain('seo');
  });

  it('fails with usage when --task is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await pickAction({ args: [], flags: { _: [] }, cwd: tmpdir(), interactive: false });
    expect(res).toMatchObject({ success: false, exitCode: 1 });
  });
});
