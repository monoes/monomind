/**
 * org_tasks takes an optional taskId. The full listing of a long run is large
 * enough to be spilled to a file, and on the 2.16.0 release run the captain
 * read single tasks back out of those spill files with dd and python.
 */
import { describe, expect, it, vi } from 'vitest';
import { dagListTasks } from '../../src/orgrt/decisions.js';
import type { OrgBus } from '../../src/orgrt/bus.js';
import type { Mailbox } from '../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildOrgTools, type SessionOpts } from '../../src/orgrt/session.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import type { OrgRole } from '../../src/orgrt/types.js';

function daemonWith(dag: TaskDag) {
  return { orgs: new Map([['o', { taskDag: dag }]]) } as any;
}

describe('org_tasks taskId filter', () => {
  it('returns just the named task with its result and evidence', () => {
    const dag = new TaskDag();
    const a = dag.add('build', 'dev');
    dag.add('other', 'dev');
    dag.recordEvidence(a.id, { headSha: 'abc1234', checks: [{ command: 'pnpm test', exitCode: 0 }] });
    dag.complete(a.id, 'built it');
    const got = JSON.parse(dagListTasks(daemonWith(dag), 'o', a.id));
    expect(got.id).toBe(a.id);
    expect(got.result).toBe('built it');
    expect(got.lastEvidence.headSha).toBe('abc1234');
  });

  it('lists every task without a filter, and names an unknown id', () => {
    const dag = new TaskDag();
    dag.add('a', 'dev');
    dag.add('b', 'dev');
    expect(JSON.parse(dagListTasks(daemonWith(dag), 'o'))).toHaveLength(2);
    expect(JSON.parse(dagListTasks(daemonWith(dag), 'o', 'task-9')).error).toMatch(/task-9/);
  });

  it('the tool passes the filter through', async () => {
    const listTasks = vi.fn(() => '[]');
    const tool = buildOrgTools({
      org: 'o',
      role: { id: 'boss' } as OrgRole,
      bus: {} as OrgBus,
      policy: {} as PolicyEngine,
      mailbox: {} as Mailbox,
      cwd: '/work',
      deliver: async () => 'ok',
      listTasks,
    } as SessionOpts).find((t) => t.name === 'org_tasks')!;
    expect(tool.description).toMatch(/taskId/);
    await tool.handler({ taskId: 'task-3' });
    expect(listTasks).toHaveBeenCalledWith('task-3');
  });
});
