/**
 * Regression tests for dispatchReadyTasks() in decisions.ts.
 *
 * Bug 1: a task assigned to an unknown/typo'd assignee used to be marked
 * 'running' unconditionally (before the assignee was ever looked up), so an
 * unresolvable assignee left the task stuck 'running' forever with no
 * mailbox message ever sent and zero observability.
 *
 * Bug 2: a task assigned to a role whose mailbox is closed (crashed, or
 * closed for a recoverable reason like a budget cap) still looked like a
 * valid recipient — it's still in `running.agents` — so the task got marked
 * 'running', the mailbox push silently no-op'd (Mailbox.push()'s own
 * closed-guard), yet the bus still emitted a "task dispatched" event: a
 * false-positive audit trail for work nobody is aware of.
 *
 * Both are fixed by resolving the assignee BEFORE calling markRunning, and
 * only marking a task 'running' when there is an actual live recipient.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../orgrt/bus.js';
import { type AgentRuntime, OrgDaemon, type RunningOrg } from '../orgrt/daemon.js';
import { dispatchReadyTasks } from '../orgrt/decisions.js';
import { Mailbox } from '../orgrt/mailbox.js';
import type { PolicyEngine } from '../orgrt/policy.js';
import { TaskDag } from '../orgrt/task-dag.js';
import type { BusEvent } from '../orgrt/types.js';
import { ORG_DIR, type OrgDef } from '../orgrt/types.js';

function minimalDef(name: string): OrgDef {
  return { name, goal: 'test', roles: [{ id: 'dev' }], run_config: {} } as unknown as OrgDef;
}

function makeAgent(): AgentRuntime {
  return {
    mailbox: new Mailbox(),
    policy: {} as unknown as PolicyEngine,
    done: Promise.resolve(),
    status: 'running',
    metrics: { tokens: 0, costUsd: 0 },
    scrollback: { push: () => {}, all: () => [] } as any,
  };
}

describe('dispatchReadyTasks: assignee resolution before markRunning', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('does not mark a task running when its assignee is unresolvable, and flags it', () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-unresolved-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const taskDag = new TaskDag();
    const task = taskDag.add('do the thing', 'typo-role', []);
    expect(task.status).toBe('ready');

    const running: RunningOrg = {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus,
      agents: new Map(),
      busEvents: () => [],
      taskDag,
    };

    dispatchReadyTasks(daemon, 'alpha', running);

    // Left visibly stuck at 'ready' — never flipped to permanent 'running' limbo.
    expect(taskDag.get(task.id)?.status).toBe('ready');
    expect(taskDag.get(task.id)?.startedAt).toBeUndefined();

    // No false "dispatched" event.
    expect(events.find((e) => e.reason === 'task-dispatched')).toBeUndefined();

    // A clear, discoverable warning was emitted instead.
    const warning = events.find((e) => e.reason === 'dispatch-assignee-unresolved');
    expect(warning).toBeTruthy();
    expect(warning?.type).toBe('audit');
    expect((warning?.data as any).taskId).toBe(task.id);
    expect((warning?.data as any).assignee).toBe('typo-role');
  });

  it('does not mark a task running or emit a false dispatch when the assignee mailbox is closed', () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-closed-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const crashedAgent = makeAgent();
    crashedAgent.status = 'crashed';
    crashedAgent.mailbox.close();

    const taskDag = new TaskDag();
    const task = taskDag.add('do the thing', 'worker', []);
    expect(task.status).toBe('ready');

    const running: RunningOrg = {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus,
      agents: new Map([['worker', crashedAgent]]),
      busEvents: () => [],
      taskDag,
    };

    dispatchReadyTasks(daemon, 'alpha', running);

    // Left visibly stuck at 'ready' — not permanently 'running' with no owner aware of it.
    expect(taskDag.get(task.id)?.status).toBe('ready');
    expect(taskDag.get(task.id)?.startedAt).toBeUndefined();

    // No push happened (mailbox stayed closed and empty) and no misleading
    // "dispatched" event was emitted.
    expect(crashedAgent.mailbox.serialize().queue.length).toBe(0);
    expect(events.find((e) => e.reason === 'task-dispatched')).toBeUndefined();

    const warning = events.find((e) => e.reason === 'dispatch-recipient-unavailable');
    expect(warning).toBeTruthy();
    expect(warning?.type).toBe('audit');
    expect((warning?.data as any).taskId).toBe(task.id);
    expect((warning?.data as any).assignee).toBe('worker');
  });

  it('still dispatches normally to a live agent (regression guard)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-happy-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const agent = makeAgent();
    const taskDag = new TaskDag();
    const task = taskDag.add('do the thing', 'worker', []);

    const running: RunningOrg = {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus,
      agents: new Map([['worker', agent]]),
      busEvents: () => [],
      taskDag,
    };

    dispatchReadyTasks(daemon, 'alpha', running);

    expect(taskDag.get(task.id)?.status).toBe('running');
    expect(agent.mailbox.serialize().queue).toEqual([`[task:${task.id}] do the thing`]);
    const dispatched = events.find((e) => e.reason === 'task-dispatched');
    expect(dispatched).toBeTruthy();
    expect((dispatched?.data as any).assignee).toBe('worker');
  });
});
