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

  it('ranks platform skills and org-library skills from one index', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    root = mkdtempSync(join(tmpdir(), 'pick-cmd-'));
    mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'helpers', 'skill-registry.json'),
      JSON.stringify({
        skills: [
          { skill: 'zorbling-audit', invoke: 'Skill("zorbling-audit")', description: 'Audit zorbling flux' },
          { skill: 'zorbling-shared', invoke: 'Skill("zorbling-shared")', description: 'Shared zorbling flux' },
        ],
      }),
    );
    for (const name of ['zorbling-tuning', 'zorbling-shared']) {
      mkdirSync(join(root, '.monomind', 'org-skills', name), { recursive: true });
      writeFileSync(
        join(root, '.monomind', 'org-skills', name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Tune zorbling flux\n---\n\nBody\n`,
      );
    }
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    const res = await pickAction({
      args: [],
      flags: { _: [], task: 'zorbling flux', json: true, skills: true, top: 10 },
      cwd: root,
      interactive: false,
    });
    expect(res.success).toBe(true);
    const ranked: { id: string; source: string; invoke?: string }[] = JSON.parse(logs.join('\n'))
      .skills.ranked;
    const byId = new Map(ranked.map((s) => [s.id, s]));
    expect(byId.get('zorbling-audit')).toMatchObject({ source: 'platform' });
    expect(byId.get('zorbling-tuning')).toMatchObject({
      source: 'org',
      invoke: 'monomind org skills show zorbling-tuning',
    });
    // A name in both pools is listed once, as the invokable platform skill.
    expect(ranked.filter((s) => s.id === 'zorbling-shared')).toEqual([
      expect.objectContaining({ source: 'platform' }),
    ]);
  });

  it('prints the spawnable agent name in text mode and keeps id + name in JSON', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    root = mkdtempSync(join(tmpdir(), 'pick-cmd-'));
    mkdirSync(join(root, '.monomind'));
    writeFileSync(
      join(root, '.monomind', 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'engineering-technical-writer', name: 'Technical Writer', category: 'engineering', description: 'Writes docs and READMEs' },
          { slug: 'coder', name: 'coder', category: 'core', description: 'Writes code' },
        ],
      }),
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    await pickAction({
      args: [],
      flags: { _: [], task: 'update the README docs', agents: true },
      cwd: root,
      interactive: false,
    });
    expect(logs.join('\n')).toContain('Technical Writer');
    logs.length = 0;
    await pickAction({
      args: [],
      flags: { _: [], task: 'update the README docs', agents: true, json: true },
      cwd: root,
      interactive: false,
    });
    const out = JSON.parse(logs.join('\n'));
    expect(out.agents).toMatchObject({ method: 'keyword', source: 'keyword', lowConfidence: false });
    expect(out.agents.ranked[0]).toMatchObject({ id: 'engineering-technical-writer', name: 'Technical Writer' });
  });

  it('rejects a --min-confidence outside (0, 1]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await pickAction({
      args: [],
      flags: { _: [], task: 'x', 'min-confidence': 3 },
      cwd: tmpdir(),
      interactive: false,
    });
    expect(res).toMatchObject({ success: false, exitCode: 1 });
  });

  it('fails with usage when --task is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await pickAction({ args: [], flags: { _: [] }, cwd: tmpdir(), interactive: false });
    expect(res).toMatchObject({ success: false, exitCode: 1 });
  });
});
