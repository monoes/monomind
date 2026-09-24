// packages/@monomind/cli/__tests__/orgrt/task-pick-provenance.test.ts
//
// Org picks leave a trail: an auto-assigned task records how its role was
// chosen, a dispatch that suggests skills records them, and a role loading a
// suggested skill is recorded against the task — all on the task row (so it
// rides the checkpoint) and on the bus as audit events.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OrgBus } from '../../src/orgrt/bus.js';
import { OrgDaemon, type RunningOrg } from '../../src/orgrt/daemon.js';
import { dagCreateTask, openTaskCount, recordSkillLoad } from '../../src/orgrt/decisions.js';
import { buildOrgTools } from '../../src/orgrt/session.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

function setup() {
  const daemon = new OrgDaemon(mkdtempSync(join(tmpdir(), 'pick-prov-')));
  const emit = vi.fn();
  const running = {
    def: OrgDefSchema.parse({
      name: 'acme',
      goal: 'ship',
      roles: [
        { id: 'boss', title: 'Boss', type: 'coordinator' },
        { id: 'dev', title: 'Dev', type: 'specialist', reports_to: 'boss' },
      ],
    }),
    run: 'run-1',
    bus: { emit } as unknown as OrgBus,
    agents: new Map(),
    taskDag: new TaskDag(),
  } as unknown as RunningOrg;
  daemon.orgs.set('acme', running);
  return { daemon, running, emit };
}

const events = (emit: ReturnType<typeof vi.fn>, reason: string) =>
  emit.mock.calls.map((c) => c[0]).filter((e) => e.reason === reason);

describe('auto-assign provenance', () => {
  const pick = { method: 'keyword' as const, score: 6.2, candidates: [{ id: 'dev', score: 6.2 }] };

  it('records the pick on the task and audits it', () => {
    const { daemon, running, emit } = setup();
    const task = JSON.parse(dagCreateTask(daemon, 'acme', 'boss', 'add parser', 'dev', [], undefined, undefined, pick));
    expect(task).toMatchObject({ assignedBy: 'auto', pick });
    expect(running.taskDag?.get(task.id)?.pick).toEqual(pick);
    expect(events(emit, 'task-auto-assigned')).toEqual([
      expect.objectContaining({ type: 'audit', from: 'boss', to: 'dev', data: { taskId: task.id, assignee: 'dev', ...pick } }),
    ]);
  });

  it('marks a named assignee explicit and audits nothing extra', () => {
    const { daemon, emit } = setup();
    const task = JSON.parse(dagCreateTask(daemon, 'acme', 'boss', 'add parser', 'dev', []));
    expect(task.assignedBy).toBe('explicit');
    expect(task.pick).toBeUndefined();
    expect(events(emit, 'task-auto-assigned')).toHaveLength(0);
  });

  it('survives a checkpoint round trip, and older rows without it still load', () => {
    const dag = new TaskDag();
    const t = dag.add('x', 'dev', []);
    Object.assign(t, { assignedBy: 'auto', pick, suggestedSkills: ['a'], loadedSkills: ['a'] });
    const back = TaskDag.fromJSON(JSON.parse(JSON.stringify(dag.toJSON()))).get(t.id);
    expect(back).toMatchObject({ assignedBy: 'auto', pick, suggestedSkills: ['a'], loadedSkills: ['a'] });
    const old = TaskDag.fromJSON([{ id: 'task-1', title: 'x', assignee: 'dev', deps: [], status: 'ready', createdAt: 1 }]);
    expect(old.get('task-1')?.pick).toBeUndefined();
  });

  it('counts only open tasks as load', () => {
    const { running } = setup();
    const a = running.taskDag!.add('a', 'dev', []);
    running.taskDag!.add('b', 'dev', []);
    running.taskDag!.complete(a.id);
    expect(openTaskCount(running, 'dev')).toBe(1);
    expect(openTaskCount(running, 'boss')).toBe(0);
  });
});

describe('suggested skill adherence', () => {
  it('records a load of a suggested skill against the open task that suggested it', () => {
    const { running, emit } = setup();
    const t = running.taskDag!.add('design api', 'dev', []);
    t.suggestedSkills = ['api-design'];
    recordSkillLoad(running, 'dev', 'api-design');
    recordSkillLoad(running, 'dev', 'api-design');
    expect(t.loadedSkills).toEqual(['api-design']);
    expect(events(emit, 'skill-loaded')[0]).toMatchObject({
      type: 'audit',
      from: 'dev',
      data: { skill: 'api-design', suggested: true, taskIds: [t.id] },
    });
  });

  it('audits an unsuggested load without touching tasks', () => {
    const { running, emit } = setup();
    const t = running.taskDag!.add('design api', 'dev', []);
    recordSkillLoad(running, 'dev', 'sql-tuning');
    expect(t.loadedSkills).toBeUndefined();
    expect(events(emit, 'skill-loaded')[0].data).toEqual({ skill: 'sql-tuning', suggested: false, taskIds: [] });
  });
});

describe('org_skill_load reporting and org_skill_search', () => {
  const root = mkdtempSync(join(tmpdir(), 'pick-skills-'));
  for (const [name, desc] of [
    ['zz-mine', 'Parse config files'],
    ['zz-other', 'Tune slow parser benchmarks'],
  ]) {
    const dir = join(root, '.monomind', 'org-skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\nBody of ${name}.\n`);
  }
  const role = { id: 'dev', skill_pool: ['zz-mine'] };

  it('reports a successful load, not a refused one', async () => {
    const onSkillLoad = vi.fn();
    const tools = buildOrgTools({ role, cwd: root, orgRoot: root, deliver: () => {}, onSkillLoad } as never);
    const load = tools.find((t) => t.name === 'org_skill_load')!;
    await load.handler({ name: 'zz-mine' });
    await load.handler({ name: 'zz-other' });
    expect(onSkillLoad.mock.calls).toEqual([['dev', 'zz-mine']]);
  });

  it('searches the whole library but keeps loading to the pool', async () => {
    const tools = buildOrgTools({ role, cwd: root, orgRoot: root, deliver: () => {} } as never);
    const search = tools.find((t) => t.name === 'org_skill_search')!;
    const out = (await search.handler({ query: 'parser benchmarks' })).text;
    expect(out).toContain('zz-other (not in your pool): Tune slow parser benchmarks');
    const load = tools.find((t) => t.name === 'org_skill_load')!;
    expect((await load.handler({ name: 'zz-other' })).text).toMatch(/^ERROR/);
  });

  it('is not offered to a role with no skills', () => {
    const tools = buildOrgTools({ role: { id: 'x' }, cwd: root, deliver: () => {} } as never);
    expect(tools.some((t) => t.name === 'org_skill_search')).toBe(false);
  });
});
