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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgBus } from '../orgrt/bus.js';
import { pushMessage } from '../orgrt/cross-org.js';
import { type AgentRuntime, OrgDaemon, type RunningOrg } from '../orgrt/daemon.js';
import { DISPATCH_COALESCE_MS, dispatchReadyTasks } from '../orgrt/decisions.js';
import { Mailbox } from '../orgrt/mailbox.js';
import type { PolicyEngine } from '../orgrt/policy.js';
import { TaskDag } from '../orgrt/task-dag.js';
import type { BusEvent } from '../orgrt/types.js';
import { ORG_DIR, type OrgDef } from '../orgrt/types.js';

function minimalDef(name: string): OrgDef {
  return { name, goal: 'test', roles: [{ id: 'dev' }], run_config: {} } as unknown as OrgDef;
}

/** Wait out the task-dispatch coalescing window (#275). */
const settleDispatch = (): Promise<void> =>
  new Promise((r) => setTimeout(r, DISPATCH_COALESCE_MS + 50));

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
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
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
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
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

  it('still dispatches normally to a live agent (regression guard)', async () => {
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
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
      taskDag,
    };

    dispatchReadyTasks(daemon, 'alpha', running);

    expect(taskDag.get(task.id)?.status).toBe('running');
    // The push itself is held for one coalescing window (#275) — the task is
    // marked running immediately, the mailbox message lands a beat later.
    expect(agent.mailbox.serialize().queue).toEqual([]);
    await settleDispatch();
    expect(agent.mailbox.serialize().queue).toEqual([`[task:${task.id}] do the thing`]);
    const dispatched = events.find((e) => e.reason === 'task-dispatched');
    expect(dispatched).toBeTruthy();
    expect((dispatched?.data as any).assignee).toBe('worker');
  });
});

/**
 * #275: release-captain called org_task (assigning fixer) and, in the same
 * turn, org_send with the numbered issue list the task was about. Each push is
 * its own mailbox entry and Mailbox.stream() yields one entry per SDK turn, so
 * fixer's turn opened with the bare title and the briefing sat behind it unread
 * — fixer had to ask for a resend, costing a whole round.
 */
describe('org_task auto-dispatch + same-turn org_send (#275)', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  const makeRunning = (bus: OrgBus, taskDag: TaskDag, agent: AgentRuntime): RunningOrg => ({
    def: minimalDef('alpha'),
    run: 'run-1',
    bus,
    agents: new Map([['fixer', agent]]),
    busEvents: () => [],
    roleSlots: new Map(),
    bossRoleId: 'boss',
    glossary: [],
    respawning: new Set(),
    taskDag,
  });

  it('delivers the task and the message the same turn sent as one mailbox message', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-coalesce-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const agent = makeAgent();
    const taskDag = new TaskDag();
    const task = taskDag.add('ROUND 1 FIXES: fixer resolves 10 numbered issues', 'fixer', []);
    const running = makeRunning(bus, taskDag, agent);
    daemon.orgs.set('alpha', running);

    // One coordinator turn: org_task auto-dispatches, org_send follows.
    dispatchReadyTasks(daemon, 'alpha', running);
    const delivered = await pushMessage(
      daemon,
      'alpha',
      running,
      'fixer',
      'release-captain',
      'ROUND 1 FIXES',
      '1. build-engineer: tsc error in org.ts\n2. cli-qa: monomind org status lies',
      'msg-1',
    );
    expect(delivered).toBe(true);
    await settleDispatch();

    const queue = agent.mailbox.serialize().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toContain(`[task:${task.id}]`);
    expect(queue[0]).toContain('ROUND 1 FIXES: fixer resolves 10 numbered issues');
    expect(queue[0]).toContain('1. build-engineer: tsc error in org.ts');
    expect(queue[0]).toContain('2. cli-qa: monomind org status lies');
    daemon.orgs.delete('alpha');
  });

  it('leaves a message with no task dispatch in flight as its own delivery', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-plain-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const agent = makeAgent();
    const running = makeRunning(bus, new TaskDag(), agent);
    daemon.orgs.set('alpha', running);

    await pushMessage(daemon, 'alpha', running, 'fixer', 'release-captain', 'ping', 'body', 'm1');
    await settleDispatch();

    const queue = agent.mailbox.serialize().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toContain('[message from release-captain] subject: ping');
    daemon.orgs.delete('alpha');
  });
});

describe('dispatchReadyTasks: lazy (pending-role) assignee', () => {
  let tmp = '';
  afterEach(() => {
    vi.useRealTimers();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('leaves the task ready when the spawn does not produce a live agent', () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-lazy-fail-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const taskDag = new TaskDag();
    const task = taskDag.add('do the thing', 'worker', []);
    const running: RunningOrg = {
      def: minimalDef('alpha'),
      run: 'run-1',
      bus,
      agents: new Map(),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
      taskDag,
      pendingRoles: new Map([['worker', { id: 'worker' } as any]]),
      spawnRole: () => {
        /* spawn failed: no runtime registered */
      },
    };

    dispatchReadyTasks(daemon, 'alpha', running);

    expect(taskDag.get(task.id)?.status).toBe('ready');
    expect(events.find((e) => e.reason === 'task-dispatched')).toBeUndefined();
    expect(events.find((e) => e.reason === 'dispatch-recipient-unavailable')).toBeTruthy();
  });

  it('honors max_concurrent_agents: defers the spawn, keeps the task ready, dispatches once a slot frees', async () => {
    vi.useFakeTimers();
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-lazy-gate-'));
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const boss = makeAgent();
    const taskDag = new TaskDag();
    const task = taskDag.add('do the thing', 'worker', []);
    const spawned: string[] = [];
    const running: RunningOrg = {
      def: {
        ...minimalDef('alpha'),
        run_config: { max_concurrent_agents: 1 },
      } as unknown as OrgDef,
      run: 'run-1',
      bus,
      agents: new Map([['boss', boss]]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: '',
      glossary: [],
      respawning: new Set(),
      taskDag,
      pendingRoles: new Map([['worker', { id: 'worker' } as any]]),
      spawnRole: (role) => {
        spawned.push(role.id);
        running.agents.set(role.id, makeAgent());
      },
    };
    daemon.orgs.set('alpha', running);

    dispatchReadyTasks(daemon, 'alpha', running);

    // At the ceiling: nothing spawned, task still visibly 'ready', no false dispatch.
    expect(spawned).toEqual([]);
    expect(taskDag.get(task.id)?.status).toBe('ready');
    expect(events.find((e) => e.reason === 'task-dispatched')).toBeUndefined();
    expect(events.find((e) => e.reason === 'concurrency-limit')).toBeTruthy();

    // Boss ends → slot frees → deferred spawn fires and the task is dispatched.
    boss.status = 'ended';
    await vi.advanceTimersByTimeAsync(5_100);

    expect(spawned).toEqual(['worker']);
    expect(taskDag.get(task.id)?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(DISPATCH_COALESCE_MS + 50); // #275 coalescing window
    expect(running.agents.get('worker')?.mailbox.serialize().queue).toEqual([
      `[task:${task.id}] do the thing`,
    ]);
    expect(events.find((e) => e.reason === 'task-dispatched')).toBeTruthy();
    daemon.orgs.delete('alpha');
  });
});
