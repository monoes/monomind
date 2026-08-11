/**
 * End-to-end session tool integration test — verifies the new playbook tools
 * (org_task_split, org_task_merge, org_task_cancel, org_plan_graph) are wired
 * correctly from session.ts's buildOrgTools through to TaskDag state changes.
 *
 * This is the integration layer the live org run validated — here we prove
 * each tool handler mutates the DAG exactly as intended, without needing a
 * live LLM session.
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskDag } from '../../packages/@monomind/cli/src/orgrt/task-dag.js';
import { OrgBus } from '../../packages/@monomind/cli/src/orgrt/bus.js';
import { buildOrgTools } from '../../packages/@monomind/cli/src/orgrt/session.js';
import { PolicyEngine } from '../../packages/@monomind/cli/src/orgrt/policy.js';
import { Mailbox } from '../../packages/@monomind/cli/src/orgrt/mailbox.js';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'os';
import type { OrgRole } from '../../packages/@monomind/cli/src/orgrt/types.js';

function makeToolSurface(opts: {
  dag?: TaskDag;
  bus?: OrgBus;
  role?: Partial<OrgRole>;
  deliver?: (...args: unknown[]) => Promise<string>;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'mono-session-tool-'));
  const dag = opts.dag ?? new TaskDag();
  const bus = opts.bus ?? new OrgBus('test-org', 'run-1', dir);
  const role: OrgRole = {
    id: 'boss',
    title: 'Boss',
    type: 'boss',
    reports_to: null,
    responsibilities: [],
    ...opts.role,
  } as OrgRole;
  const policy = new PolicyEngine({ allowTools: ['*'] });
  const mailbox = new Mailbox('boss');

  // Wire the DAG callbacks the same way daemon.ts does:
  const sessionOpts = {
    org: 'test-org',
    role,
    bus,
    policy,
    mailbox,
    cwd: process.cwd(),
    deliver: opts.deliver ?? (async () => 'ok'),
    createTask: (_r: string, title: string, assignee: string, deps: string[]) =>
      JSON.stringify(dag.add(title, assignee, deps)),
    completeTask: (_r: string, taskId: string, result?: string) => {
      dag.markRunning(taskId);
      const promoted = dag.complete(taskId, result);
      return JSON.stringify({ done: taskId, promoted: promoted.map(t => t.id) });
    },
    listTasks: () => JSON.stringify(dag.all()),
    splitTask: (_r: string, parentId: string, children: { title: string; assignee: string }[]) => {
      try {
        return JSON.stringify(dag.split(parentId, children).map(t => ({ id: t.id, title: t.title })));
      } catch (err) {
        return JSON.stringify({ error: (err as Error).message });
      }
    },
    mergeTask: (_r: string, sourceId: string, targetId: string) => {
      const t = dag.merge(sourceId, targetId);
      return JSON.stringify({ merged: sourceId, into: targetId, status: t.status });
    },
    cancelTask: (_r: string, taskId: string, reason?: string) => {
      const promoted = dag.cancel(taskId, reason);
      return JSON.stringify({ cancelled: taskId, promoted: promoted.map(t => t.id) });
    },
    planGraph: (_r: string, specs: { name: string; title: string; assignee: string; after?: string[] }[]) => {
      const nameToId = new Map<string, string>();
      const created: { name: string; id: string }[] = [];
      for (const s of specs) {
        const depIds = (s.after ?? []).map(a => nameToId.get(a) ?? a);
        const t = dag.add(s.title, s.assignee, depIds);
        nameToId.set(s.name, t.id);
        created.push({ name: s.name, id: t.id });
      }
      return JSON.stringify({ planned: created.length, tasks: created });
    },
  };

  const tools = buildOrgTools(sessionOpts);
  return { tools, dag, bus, dir };
}

function getTool(tools: { name: string; handler: (args: unknown) => Promise<{ text: string }> }[], name: string) {
  const t = tools.find(t => t.name === name);
  if (!t) throw new Error(`tool "${name}" not registered`);
  return t;
}

describe('session tool integration — org_task_split (#6)', () => {
  it('the tool handler calls TaskDag.split and returns the created children', async () => {
    const { tools, dag } = makeToolSurface({});
    const parent = dag.add('parent task', 'coder');
    const tool = getTool(tools as never, 'org_task_split');

    const result = await tool.handler({ parentId: parent.id, children: [{ title: 'child-a', assignee: 'tester' }, { title: 'child-b', assignee: 'coder' }] });
    const parsed = JSON.parse(result.text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('child-a');
    expect(parsed[1].title).toBe('child-b');
    expect(dag.get(parent.id)!.status).toBe('split');
  });

  it('returns a JSON error string (not a throw) for an unknown parent', async () => {
    const { tools } = makeToolSurface({});
    const tool = getTool(tools as never, 'org_task_split');
    const result = await tool.handler({ parentId: 'ghost', children: [{ title: 'x', assignee: 'coder' }] });
    expect(JSON.parse(result.text).error).toBeTruthy();
  });
});

describe('session tool integration — org_task_merge (#6)', () => {
  it('the tool handler calls TaskDag.merge and returns the resulting target status', async () => {
    const { tools, dag } = makeToolSurface({});
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'coder');
    const tool = getTool(tools as never, 'org_task_merge');

    const result = await tool.handler({ sourceId: a.id, targetId: b.id });
    const parsed = JSON.parse(result.text);

    expect(parsed.merged).toBe(a.id);
    expect(parsed.into).toBe(b.id);
    expect(dag.get(a.id)!.status).toBe('merged');
  });
});

describe('session tool integration — org_task_cancel (#6)', () => {
  it('the tool handler calls TaskDag.cancel and returns the promoted downstream tasks', async () => {
    const { tools, dag } = makeToolSurface({});
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'tester', [a.id]);
    const tool = getTool(tools as never, 'org_task_cancel');

    const result = await tool.handler({ taskId: a.id, reason: 'moot' });
    const parsed = JSON.parse(result.text);

    expect(parsed.cancelled).toBe(a.id);
    expect(parsed.promoted).toEqual(expect.arrayContaining([b.id]));
    expect(dag.get(a.id)!.status).toBe('cancelled');
    expect(dag.get(b.id)!.status).toBe('ready');
  });
});

describe('session tool integration — org_plan_graph (#5)', () => {
  it('the tool handler resolves cross-references and creates the full graph', async () => {
    const { tools, dag } = makeToolSurface({});
    const tool = getTool(tools as never, 'org_plan_graph');

    const result = await tool.handler({
      tasks: [
        { name: 'setup', title: 'env setup', assignee: 'devops' },
        { name: 'build', title: 'compile', assignee: 'coder', after: ['setup'] },
        { name: 'test', title: 'verify', assignee: 'tester', after: ['build'] },
      ],
    });
    const parsed = JSON.parse(result.text);

    expect(parsed.planned).toBe(3);
    // Names should resolve to real task ids
    const setup = parsed.tasks.find((t: { name: string }) => t.name === 'setup');
    const build = parsed.tasks.find((t: { name: string }) => t.name === 'build');
    expect(setup.id).toMatch(/^task-\d+$/);
    // Deps wired correctly
    expect(dag.get(build.id)!.deps).toContain(setup.id);
  });

  it('parallel branches share a parent dep', async () => {
    const { tools, dag } = makeToolSurface({});
    const tool = getTool(tools as never, 'org_plan_graph');

    const result = await tool.handler({
      tasks: [
        { name: 'root', title: 'root', assignee: 'lead' },
        { name: 'left', title: 'left branch', assignee: 'coder', after: ['root'] },
        { name: 'right', title: 'right branch', assignee: 'tester', after: ['root'] },
      ],
    });
    const parsed = JSON.parse(result.text);
    const root = parsed.tasks.find((t: { name: string }) => t.name === 'root');
    const left = parsed.tasks.find((t: { name: string }) => t.name === 'left');
    const right = parsed.tasks.find((t: { name: string }) => t.name === 'right');

    expect(dag.get(left.id)!.deps).toContain(root.id);
    expect(dag.get(right.id)!.deps).toContain(root.id);
  });
});

describe('session tool integration — all 4 playbook tools are registered', () => {
  it('buildOrgTools includes org_task_split, org_task_merge, org_task_cancel, org_plan_graph when callbacks are set', () => {
    const { tools } = makeToolSurface({});
    const names = tools.map(t => t.name);
    expect(names).toContain('org_task_split');
    expect(names).toContain('org_task_merge');
    expect(names).toContain('org_task_cancel');
    expect(names).toContain('org_plan_graph');
  });

  it('buildOrgTools omits the 4 playbook tools when their callbacks are absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-session-noop-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const role: OrgRole = { id: 'boss', title: 'Boss', type: 'boss', reports_to: null, responsibilities: [] } as OrgRole;
    const tools = buildOrgTools({
      org: 'test-org', role, bus, policy: new PolicyEngine({}), mailbox: new Mailbox('boss'),
      cwd: '.', deliver: async () => 'ok',
      // No task callbacks set
    });
    const names = tools.map(t => t.name);
    expect(names).not.toContain('org_task_split');
    expect(names).not.toContain('org_plan_graph');
    // The basic 3 (create/done/list) should also be absent
    expect(names).not.toContain('org_task');
  });
});
