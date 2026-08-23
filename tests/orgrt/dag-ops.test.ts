/**
 * Graph engineering playbook improvement #6 — daemon-level DAG operations.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OrgBus } from '../../packages/@monomind/cli/src/orgrt/bus.js';
import {
  dagCancelTask,
  dagMergeTask,
  dagPlanGraph,
  dagSplitTask,
  dispatchReadyTasks,
} from '../../packages/@monomind/cli/src/orgrt/decisions.js';
import { TaskDag } from '../../packages/@monomind/cli/src/orgrt/task-dag.js';

interface MockAgent {
  mailbox: { push: (m: string) => void; isClosed: boolean };
}

function makeMockDaemon(dag: TaskDag, bus: OrgBus, agents = new Map<string, MockAgent>()) {
  return {
    orgs: new Map([
      [
        'test-org',
        {
          taskDag: dag,
          bus,
          agents,
          pendingRoles: new Map(),
          spawnRole: undefined,
        },
      ],
    ]),
    root: mkdtempSync(join(tmpdir(), 'mono-dag-test-')),
  } as unknown as Parameters<typeof dagSplitTask>[0];
}

describe('dagSplitTask — daemon wiring', () => {
  it('splits a task and emits a status event on the bus', async () => {
    const dag = new TaskDag();
    const parent = dag.add('parent', 'coder');
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-split-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    const result = dagSplitTask(daemon, 'test-org', 'boss', parent.id, [
      { title: 'child-a', assignee: 'tester' },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.split).toBe(parent.id);
    expect(parsed.children).toHaveLength(1);
    expect(dag.get(parent.id)?.status).toBe('split');
    await bus.flush();
    const history = OrgBus.readHistory(dir);
    expect(history.some((e) => e.reason === 'task-split')).toBe(true);
  });

  it('returns a JSON error for an unknown parent', () => {
    const dag = new TaskDag();
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-split-err-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);
    const result = dagSplitTask(daemon, 'test-org', 'boss', 'ghost', []);
    expect(JSON.parse(result).error).toBeTruthy();
  });
});

describe('dagMergeTask — daemon wiring', () => {
  it('merges a task and emits a status event', async () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'coder');
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-merge-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    const result = dagMergeTask(daemon, 'test-org', 'boss', a.id, b.id);
    const parsed = JSON.parse(result);
    expect(parsed.merged).toBe(a.id);
    expect(parsed.into).toBe(b.id);
    expect(dag.get(a.id)?.status).toBe('merged');
    await bus.flush();
    const history = OrgBus.readHistory(dir);
    expect(history.some((e) => e.reason === 'task-merged')).toBe(true);
  });
});

describe('dagCancelTask — daemon wiring', () => {
  it('cancels a task and emits a status event', async () => {
    const dag = new TaskDag();
    const t = dag.add('t', 'coder');
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-cancel-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    const result = dagCancelTask(daemon, 'test-org', 'boss', t.id, 'moot');
    const parsed = JSON.parse(result);
    expect(parsed.cancelled).toBe(t.id);
    expect(dag.get(t.id)?.status).toBe('cancelled');
    await bus.flush();
    const history = OrgBus.readHistory(dir);
    expect(history.some((e) => e.reason === 'task-cancelled')).toBe(true);
  });

  it('returns the promoted downstream tasks when cancelling unblocks them', () => {
    const dag = new TaskDag();
    const a = dag.add('a', 'coder');
    const b = dag.add('b', 'tester', [a.id]);
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-cancel-promo-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    const result = dagCancelTask(daemon, 'test-org', 'boss', a.id);
    const parsed = JSON.parse(result);
    expect(parsed.promoted).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: b.id })]),
    );
  });
});

describe('dispatchReadyTasks — wires to agent mailboxes', () => {
  it("pushes a [task] message to the assignee's mailbox when one is ready", () => {
    const dag = new TaskDag();
    const _t = dag.add('task for tester', 'tester');
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-dispatch-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const push = vi.fn();
    const agents = new Map([['tester', { mailbox: { push, isClosed: false } }]]);
    const daemon = makeMockDaemon(dag, bus, agents);
    const running = (daemon.orgs as Map<string, unknown>).get('test-org') as never;
    dispatchReadyTasks(daemon, 'test-org', running);
    expect(push).toHaveBeenCalledWith(expect.stringContaining('[task:'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('task for tester'));
  });
});

describe('dagPlanGraph — work graph generator (#5)', () => {
  it('creates a batch of tasks with cross-references resolved in one call', () => {
    const dag = new TaskDag();
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-plan-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    const result = dagPlanGraph(daemon, 'test-org', 'boss', [
      { name: 'research', title: 'investigate', assignee: 'researcher' },
      { name: 'implement', title: 'build it', assignee: 'coder', after: ['research'] },
      { name: 'test', title: 'verify', assignee: 'tester', after: ['implement'] },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.planned).toBe(3);
    expect(parsed.tasks).toHaveLength(3);
    const research = parsed.tasks.find((t: { name: string }) => t.name === 'research');
    expect(['ready', 'running']).toContain(research.status);
    const implement = parsed.tasks.find((t: { name: string }) => t.name === 'implement');
    const test = parsed.tasks.find((t: { name: string }) => t.name === 'test');
    expect(dag.get(implement.id)?.deps).toContain(research.id);
    expect(dag.get(test.id)?.deps).toContain(implement.id);
  });

  it('handles parallel branches that depend on the same parent', () => {
    const dag = new TaskDag();
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-plan-par-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    const result = dagPlanGraph(daemon, 'test-org', 'boss', [
      { name: 'setup', title: 'set up env', assignee: 'devops' },
      { name: 'backend', title: 'build api', assignee: 'coder', after: ['setup'] },
      { name: 'frontend', title: 'build ui', assignee: 'coder', after: ['setup'] },
      { name: 'integrate', title: 'wire them', assignee: 'lead', after: ['backend', 'frontend'] },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.planned).toBe(4);
    const setup = parsed.tasks.find((t: { name: string }) => t.name === 'setup');
    const backend = parsed.tasks.find((t: { name: string }) => t.name === 'backend');
    const frontend = parsed.tasks.find((t: { name: string }) => t.name === 'frontend');
    const integrate = parsed.tasks.find((t: { name: string }) => t.name === 'integrate');
    expect(['ready', 'running']).toContain(dag.get(setup.id)?.status);
    expect(dag.get(backend.id)?.status).toBe('pending');
    expect(dag.get(frontend.id)?.status).toBe('pending');
    expect(dag.get(integrate.id)?.deps).toEqual(expect.arrayContaining([backend.id, frontend.id]));
  });

  it('returns an error for unresolved cross-references', () => {
    const dag = new TaskDag();
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-plan-err-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    const result = dagPlanGraph(daemon, 'test-org', 'boss', [
      { name: 'a', title: 'do a', assignee: 'coder', after: ['nonexistent'] },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain('unresolved');
  });

  it('emits a plan-graph status event on the bus', async () => {
    const dag = new TaskDag();
    const dir = mkdtempSync(join(tmpdir(), 'mono-bus-plan-emit-'));
    const bus = new OrgBus('test-org', 'run-1', dir);
    const daemon = makeMockDaemon(dag, bus);

    dagPlanGraph(daemon, 'test-org', 'boss', [
      { name: 'solo', title: 'standalone', assignee: 'coder' },
    ]);
    await bus.flush();
    const history = OrgBus.readHistory(dir);
    expect(history.some((e) => e.reason === 'plan-graph')).toBe(true);
  });
});
