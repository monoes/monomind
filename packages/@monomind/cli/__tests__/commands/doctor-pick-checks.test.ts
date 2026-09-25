import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPick, readPickAdherence } from '../../src/commands/doctor-pick-checks.js';
import { newRoot } from '../catalog/fixtures.js';

function put(file: string, text: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

const jsonl = (rows: object[]) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

function project(): string {
  const root = newRoot('pick-doctor-');
  mkdirSync(join(root, '.git'));
  put(
    join(root, '.claude', 'agents', 'core', 'tester.md'),
    '---\nname: tester\nslug: tester\ndescription: Writes unit tests\n---\n',
  );
  put(
    join(root, '.claude', 'skills', 'test-master', 'SKILL.md'),
    '---\nname: test-master\ndescription: Unit test strategy and coverage\n---\n\nBody\n',
  );
  return root;
}

let home = '';
beforeEach(() => {
  home = newRoot('pick-doctor-home-');
  vi.stubEnv('HOME', home);
  vi.stubEnv('MONOMIND_HOME', join(home, '.monomind'));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readPickAdherence', () => {
  it('counts routes, shown picks and spawns that followed a pick', () => {
    const root = project();
    put(
      join(root, '.monomind', 'route-outcomes.jsonl'),
      jsonl([{ routeId: 'a', shown: true }, { routeId: 'b', shown: false }, { routeId: 'c' }]),
    );
    put(
      join(root, '.monomind', 'pick-adherence.jsonl'),
      `${jsonl([{ followed: true }, { followed: false }, { followed: null }, { followed: true }])}not json\n`,
    );
    expect(readPickAdherence(root)).toEqual({ routes: 3, shown: 1, spawns: 3, followed: 2 });
  });

  it('is all zeros without logs', () => {
    expect(readPickAdherence(project())).toEqual({ routes: 0, shown: 0, spawns: 0, followed: 0 });
  });
});

describe('checkPick', () => {
  it('passes a healthy project and reports each part', async () => {
    const root = project();
    const r = await checkPick(root, {});
    expect(r.name).toBe('Agent/Skill Picking');
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/registry: 1 pickable agent of 1 registered/);
    expect(r.message).toMatch(/0 duplicate/);
    expect(r.message).toMatch(/skills: \d+ pickable \(1 platform, \d+ org, 0 user\); skill index holds \d+ entr/);
    expect(r.message).toMatch(/decision model: not configured/);
    expect(r.message).toMatch(/eval: no tests\/pick-eval set/);
    expect(r.message).toMatch(/adherence: no picks logged/);
  });

  // The registry file holds deprecated agents too; picks hide them, so the
  // two counts differ and the label must say which one it shows.
  it('says how many registered agents picks hide', async () => {
    const root = project();
    put(
      join(root, '.claude', 'agents', 'core', 'old-tester.md'),
      '---\nname: old-tester\nslug: old-tester\ndescription: Old tests\ndeprecated: true\ndeprecatedBy: tester\n---\n',
    );
    const r = await checkPick(root, {});
    expect(r.message).toMatch(/registry: 1 pickable agent of 2 registered \(1 hidden: deprecated\)/);
  });

  it('counts agents from ~/.claude/agents', async () => {
    const root = project();
    put(
      join(home, '.claude', 'agents', 'mine.md'),
      '---\nname: mine\ndescription: My own agent\n---\n',
    );
    const r = await checkPick(root, {});
    expect(r.message).toMatch(/registry: 2 pickable agents of 2 registered, 1 from ~\/\.claude\/agents, 0 duplicates/);
  });

  it('warns when the registry has no agents', async () => {
    const root = newRoot('pick-doctor-empty-');
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, '.monomind'));
    const r = await checkPick(root, {});
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/registry: 0 pickable agents of 0 registered/);
    expect(r.fix).toMatch(/monomind init/);
  });

  it('names the configured decision model without probing it', async () => {
    const r = await checkPick(project(), { MONOMIND_JEV_URL: 'http://127.0.0.1:9' });
    expect(r.message).toMatch(/decision model: configured \(/);
  });

  it('scores the frozen eval set when the project carries one', async () => {
    const root = project();
    const task = { id: 1, task: 'Write unit tests', agents: ['tester'], skills: ['test-master'] };
    put(join(root, 'tests', 'pick-eval', 'dataset.json'), JSON.stringify([task]));
    put(join(root, 'tests', 'pick-eval', 'holdout.json'), '[]');
    put(
      join(root, 'tests', 'pick-eval', 'catalog-snapshot.json'),
      JSON.stringify({
        agents: [{ id: 'tester', description: 'Writes unit tests' }],
        skills: [{ id: 'test-master', description: 'Unit test strategy' }],
      }),
    );
    const r = await checkPick(root, {});
    expect(r.message).toMatch(/eval \(frozen catalog, keyword\): agents top1 1\/1, top3 1\/1 · skills top1 1\/1/);
  });

  it('reports adherence from the hook logs', async () => {
    const root = project();
    put(join(root, '.monomind', 'route-outcomes.jsonl'), jsonl([{ shown: true }, { shown: true }]));
    put(join(root, '.monomind', 'pick-adherence.jsonl'), jsonl([{ followed: true }, { followed: false }]));
    const r = await checkPick(root, {});
    expect(r.message).toMatch(/adherence: 2 routes, 2 shown; spawns followed the pick 1\/2 \(50%\)/);
  });
});
