/**
 * A task's `brief` travels with its dispatch. On the 2.16.0 release run
 * org_task took only a title, so the captain sent the details in a follow-up
 * org_send that missed the 500 ms coalescing window: the publisher asked for
 * them twice and the maintainer finished tasks before their briefs arrived,
 * then was woken four more times (~3M tokens).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { OrgBus } from '../../src/orgrt/bus.js';
import {
  DISPATCH_COALESCE_MS,
  dagCompleteTask,
  dagCreateTask,
  dagPlanGraph,
  dagSplitTask,
  dispatchReadyTasks,
} from '../../src/orgrt/decisions.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildOrgTools, type SessionOpts } from '../../src/orgrt/session.js';
import { MAX_TASK_BRIEF, TaskDag } from '../../src/orgrt/task-dag.js';
import { OrgDefSchema, type OrgRole } from '../../src/orgrt/types.js';

function setup(sessionScope?: 'task') {
  const def = OrgDefSchema.parse({
    name: 'o',
    goal: 'g',
    run_config: sessionScope ? { session_scope: sessionScope } : {},
    roles: [
      { id: 'boss', title: 'B', type: 'b' },
      { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' },
    ],
  });
  const boxes = { boss: new Mailbox(), dev: new Mailbox() };
  const running = {
    def,
    taskDag: new TaskDag(),
    bus: new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'brief-'))),
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

const BRIEF = 'Fix the flaky retry in forwarder.ts; acceptance: `pnpm vitest run forwarder` exits 0.';

describe('task brief at dispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('stores the brief on the task and sends it in the same message as the title', () => {
    const { daemon, running, boxes, drain } = setup();
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'fix the retry', 'dev', [], undefined, BRIEF));
    expect(running.taskDag.get(t.id).brief).toBe(BRIEF);
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    const got = drain(boxes.dev);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain(`[task:${t.id}] fix the retry`);
    expect(got[0]).toContain(BRIEF);
  });

  it('sends the plain line when there is no brief', () => {
    const { daemon, boxes, drain } = setup();
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'fix the retry', 'dev', []));
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev)).toEqual([`[task:${t.id}] fix the retry`]);
  });

  it('keeps the brief for a task dispatched later, when its deps complete', () => {
    const { daemon, boxes, drain } = setup();
    const a = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'first', 'dev', []));
    const b = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'second', 'dev', [a.id], undefined, BRIEF));
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev).join('\n')).not.toContain(BRIEF);
    dagCompleteTask(daemon, 'o', 'dev', a.id, 'ok');
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    const got = drain(boxes.dev).join('\n');
    expect(got).toContain(`[task:${b.id}] second`);
    expect(got).toContain(BRIEF);
  });

  it('survives a checkpoint round-trip and is re-sent when the task is requeued', () => {
    const { daemon, running, boxes, drain } = setup();
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'fix the retry', 'dev', [], undefined, BRIEF));
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    drain(boxes.dev);
    running.taskDag = TaskDag.fromJSON(JSON.parse(JSON.stringify(running.taskDag.toJSON())));
    expect(running.taskDag.get(t.id).brief).toBe(BRIEF);
    running.taskDag.requeue(t.id);
    dispatchReadyTasks(daemon, 'o', running);
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev).join('\n')).toContain(BRIEF);
  });

  it('takes a brief per org_plan_graph node', () => {
    const { daemon, running, boxes, drain } = setup();
    const res = JSON.parse(
      dagPlanGraph(daemon, 'o', 'boss', [
        { name: 'a', title: 'A', assignee: 'dev', brief: BRIEF },
        { name: 'b', title: 'B', assignee: 'dev', after: ['a'] },
      ]),
    );
    expect(running.taskDag.get(res.tasks[0].id).brief).toBe(BRIEF);
    expect(running.taskDag.get(res.tasks[1].id).brief).toBeUndefined();
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev).join('\n')).toContain(BRIEF);
  });

  it('split children keep the parent brief', () => {
    const { daemon, running } = setup();
    const t = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'big', 'dev', [], undefined, BRIEF));
    dagSplitTask(daemon, 'o', 'dev', t.id, [{ title: 'part', assignee: 'dev' }]);
    const child = running.taskDag.all().find((x: any) => x.splitFrom === t.id);
    expect(child.brief).toBe(BRIEF);
  });

  it('in task scope the brief stays in the task’s own mailbox entry', () => {
    const { daemon, boxes, drain } = setup('task');
    const a = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'one', 'dev', [], undefined, BRIEF));
    const b = JSON.parse(dagCreateTask(daemon, 'o', 'boss', 'two', 'dev', []));
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    const got = drain(boxes.dev);
    expect(got).toHaveLength(2);
    expect(got[0].startsWith(`[task:${a.id}] one`)).toBe(true);
    expect(got[0]).toContain(BRIEF);
    expect(got[1]).toBe(`[task:${b.id}] two`);
  });
});

describe('brief on the org_task and org_plan_graph tools', () => {
  function tools(extra: Partial<SessionOpts>) {
    return buildOrgTools({
      org: 'o',
      role: { id: 'boss' } as OrgRole,
      bus: {} as OrgBus,
      policy: {} as PolicyEngine,
      mailbox: {} as Mailbox,
      cwd: '/work',
      deliver: async () => 'ok',
      ...extra,
    } as SessionOpts);
  }

  it('passes the brief through and tells the model to put instructions there', async () => {
    const createTask = vi.fn(() => '{}');
    const planGraph = vi.fn(() => '{}');
    const all = tools({ createTask, planGraph });
    const orgTask = all.find((t) => t.name === 'org_task')!;
    expect(orgTask.description).toMatch(/brief/);
    await orgTask.handler({ title: 't', assignee: 'dev', deps: [], brief: BRIEF });
    expect(createTask).toHaveBeenCalledWith('boss', 't', 'dev', [], undefined, BRIEF);
    const plan = all.find((t) => t.name === 'org_plan_graph')!;
    expect(plan.description).toMatch(/brief/);
    const spec = { name: 'a', title: 'A', assignee: 'dev', after: [], brief: BRIEF };
    await plan.handler({ tasks: [spec] });
    expect(planGraph).toHaveBeenCalledWith('boss', [spec]);
  });

  it('bounds the brief length', () => {
    const all = tools({ createTask: () => '{}', planGraph: () => '{}' });
    const taskSchema = z.object(all.find((t) => t.name === 'org_task')!.schema as z.ZodRawShape);
    expect(taskSchema.safeParse({ title: 't', assignee: 'dev', brief: 'x'.repeat(MAX_TASK_BRIEF) }).success).toBe(true);
    expect(taskSchema.safeParse({ title: 't', assignee: 'dev', brief: 'x'.repeat(MAX_TASK_BRIEF + 1) }).success).toBe(false);
    const planSchema = z.object(all.find((t) => t.name === 'org_plan_graph')!.schema as z.ZodRawShape);
    const node = { name: 'a', title: 'A', assignee: 'dev', brief: 'x'.repeat(MAX_TASK_BRIEF + 1) };
    expect(planSchema.safeParse({ tasks: [node] }).success).toBe(false);
  });
});
