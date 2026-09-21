/**
 * run_config.notify_task_creator: when a task completes, tell whoever created
 * it. Without this, a completion lived only on the bus — the live trial of
 * ADR-O001 had a boss waiting on a task its worker had already closed, until
 * the idle watchdog would have nudged it. Opt-in; default off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import {
  DISPATCH_COALESCE_MS,
  dagCompleteTask,
  dagCreateTask,
  dagPlanGraph,
  dagSplitTask,
} from '../../src/orgrt/decisions.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

function setup(runConfig: Record<string, unknown>) {
  const def = OrgDefSchema.parse({
    name: 'o',
    goal: 'g',
    run_config: runConfig,
    roles: [
      { id: 'boss', title: 'B', type: 'b' },
      { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' },
    ],
  });
  const boxes = { boss: new Mailbox(), dev: new Mailbox() };
  const running = {
    def,
    taskDag: new TaskDag(),
    bus: new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'notice-'))),
    agents: new Map(Object.entries(boxes).map(([k, mailbox]) => [k, { mailbox }])),
    pendingRoles: new Map(),
    bossRoleId: 'boss',
  } as any;
  const daemon = { orgs: new Map([['o', running]]), root: '/nonexistent' } as any;
  const drain = (box: Mailbox): string[] => {
    const out: string[] = [];
    while (box.peek() !== undefined) {
      out.push(box.peek()!);
      (box as any).queue.shift();
    }
    return out;
  };
  return { running, daemon, boxes, drain };
}

describe('notify_task_creator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records who created a task, and split children inherit it', () => {
    const { daemon, running } = setup({});
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'build', 'dev', []));
    expect(running.taskDag.get(t.id).createdBy).toBe('boss');
    const planned = JSON.parse(dagPlanGraph(daemon, 'o', 'boss', [{ name: 'a', title: 'A', assignee: 'dev' }]));
    expect(running.taskDag.get(planned.tasks[0].id).createdBy).toBe('boss');
    dagSplitTask(daemon, 'o', 'dev', t.id, [{ title: 'part', assignee: 'dev' }]);
    const child = running.taskDag.all().find((x: any) => x.splitFrom === t.id);
    expect(child.createdBy).toBe('boss');
  });

  it('is off by default: the creator hears nothing', () => {
    const { daemon, boxes, drain } = setup({});
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'build', 'dev', []));
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    drain(boxes.dev);
    dagCompleteTask(daemon, 'o', 'dev', t.id, 'shipped it');
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.boss)).toEqual([]);
  });

  it('when on, sends the creator one tagged notice with the result and evidence', () => {
    const { daemon, boxes, drain } = setup({ notify_task_creator: true });
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'build', 'dev', []));
    dagCompleteTask(daemon, 'o', 'dev', t.id, 'shipped it', {
      headSha: 'abc1234',
      checks: [{ command: 'npm test', exitCode: 0 }],
    });
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    const got = drain(boxes.boss);
    expect(got).toHaveLength(1);
    expect(got[0].startsWith(`[task:${t.id}] DONE`)).toBe(true);
    expect(got[0]).toContain('dev');
    expect(got[0]).toContain('shipped it');
    expect(got[0]).toContain('npm test → exit 0');
  });

  it('does not notify a creator who closed the task itself', () => {
    const { daemon, boxes, drain } = setup({ notify_task_creator: true });
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'self', 'boss', []));
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    drain(boxes.boss);
    dagCompleteTask(daemon, 'o', 'boss', t.id, 'done');
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.boss)).toEqual([]);
  });

  it('adds nothing to the schema when absent', () => {
    const def = OrgDefSchema.parse({ name: 'o', goal: 'g', roles: [{ id: 'b', title: 'B', type: 'b' }] });
    expect('notify_task_creator' in def.run_config).toBe(false);
  });
});
