import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickAction } from '../../src/commands/pick.js';
import { readPickStats } from '../../src/decision/pick-stats.js';

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
    // Platform skills are indexed from the project's real .claude/skills tree.
    for (const [name, description] of [
      ['zorbling-audit', 'Audit zorbling flux'],
      ['zorbling-shared', 'Shared zorbling flux'],
    ]) {
      mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
      writeFileSync(
        join(root, '.claude', 'skills', name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`,
      );
    }
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

  it('re-ranks keyword agents by pick history and explains the prior', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    root = mkdtempSync(join(tmpdir(), 'pick-cmd-'));
    mkdirSync(join(root, '.monomind'));
    writeFileSync(
      join(root, '.monomind', 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'alpha', name: 'alpha', category: 'core', description: 'Fixes parser bugs' },
          { slug: 'beta', name: 'beta', category: 'core', description: 'Fixes parser bugs' },
        ],
      }),
    );
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) {
      lines.push(JSON.stringify({ ts: 1000 + i, routeId: `r${i}`, recommended: 'alpha', actual: 'beta', followed: false }));
    }
    writeFileSync(join(root, '.monomind', 'pick-adherence.jsonl'), `${lines.join('\n')}\n`);
    const fb = [1, 2, 3, 4, 5, 6].map((i) =>
      JSON.stringify({ timestamp: new Date(2000 + i).toISOString(), actualAgent: 'beta', followed: false, intelligenceFeedback: true }),
    );
    writeFileSync(join(root, '.monomind', 'routing-feedback.jsonl'), `${fb.join('\n')}\n`);
    // The hooks write pick-stats.json at SubagentStop/SessionEnd.
    createRequire(import.meta.url)('../../.claude/helpers/pick-stats.cjs').update(root);

    const summary = readPickStats(root);
    expect(summary).toMatchObject({ routes: 0, shown: 0, spawns: 6, adherenceRate: 0, followedSuccessRate: null, notFollowedSuccessRate: 1 });
    expect(summary.topAgents[0]).toMatchObject({ name: 'beta', chosen: 6, success: 6, successRate: 1 });
    expect(summary.topAgents[0].prior).toBeGreaterThan(1);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      logs.push(String(m));
    });
    const res = await pickAction({
      args: [],
      flags: { _: [], task: 'fix parser bugs', agents: true, explain: true },
      cwd: root,
      interactive: false,
    });
    expect(res.success).toBe(true);
    const ranked = (res.data as { agents: { ranked: { id: string; prior?: number; baseScore?: number }[] } }).agents.ranked;
    expect(ranked.map((r) => r.id)).toEqual(['beta', 'alpha']);
    expect(ranked[0].prior).toBeGreaterThan(1);
    expect(ranked[1].prior).toBeLessThan(1);
    const text = logs.join('\n');
    expect(text).toMatch(/beta.*= [0-9.]+ × 1\.[0-9]+ prior/);
    expect(text).toMatch(/Pick history: 0 routes, 0 shown, 6 spawns · adherence 0%/);
  });

  it('readPickStats is empty without history', () => {
    root = mkdtempSync(join(tmpdir(), 'pick-cmd-'));
    expect(readPickStats(root)).toEqual({
      routes: 0,
      shown: 0,
      spawns: 0,
      adherenceRate: null,
      followedSuccessRate: null,
      notFollowedSuccessRate: null,
      topAgents: [],
      updatedAt: expect.any(String),
    });
  });
});
