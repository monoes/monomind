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

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgBus } from '../orgrt/bus.js';
import { captureCheckpoint } from '../orgrt/checkpoint.js';
import { pushMessage } from '../orgrt/cross-org.js';
import { type AgentRuntime, OrgDaemon, type RunningOrg } from '../orgrt/daemon.js';
import { DISPATCH_COALESCE_MS, dagCompleteTask, dispatchReadyTasks } from '../orgrt/decisions.js';
import { Mailbox } from '../orgrt/mailbox.js';
import type { PolicyEngine } from '../orgrt/policy.js';
import { TaskDag } from '../orgrt/task-dag.js';
import type { BusEvent } from '../orgrt/types.js';
import { ORG_DIR, type OrgDef } from '../orgrt/types.js';

function minimalDef(name: string): OrgDef {
  return { name, goal: 'test', roles: [{ id: 'dev' }], run_config: {} } as unknown as OrgDef;
}

/** OrgBus writes every event to <run dir>/bus.jsonl in the background
 *  (mkdir -p, then appends); emit() never waits for it. A test that ends right
 *  after emitting still has that write in flight when afterEach deletes tmp,
 *  and a directory or bus.jsonl created mid-rmSync makes the rmdir fail with
 *  ENOTEMPTY — the test fails in its afterEach (seen under parallel load), or
 *  the tree is silently recreated and leaked. Every afterEach here seals the
 *  buses its test opened (wait for the queued writes, then no more disk
 *  writes) before removing tmp. */
const openBuses: OrgBus[] = [];
function openBus(tmp: string): OrgBus {
  const bus = new OrgBus('alpha', 'run-1', join(tmp, ORG_DIR, 'alpha', 'run-1'));
  openBuses.push(bus);
  return bus;
}
async function sealBuses(): Promise<void> {
  await Promise.all(openBuses.splice(0).map((bus) => bus.seal()));
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
    scrollback: { push: () => {}, all: () => [], snapshot: () => [] } as any,
  };
}

describe('dispatchReadyTasks: assignee resolution before markRunning', () => {
  let tmp = '';
  afterEach(async () => {
    await sealBuses();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('does not mark a task running when its assignee is unresolvable, and flags it', () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-unresolved-'));
    const daemon = new OrgDaemon(tmp);
    const bus = openBus(tmp);
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
    const bus = openBus(tmp);
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
    const bus = openBus(tmp);
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
  afterEach(async () => {
    await sealBuses();
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
    const bus = openBus(tmp);
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
    const bus = openBus(tmp);
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
  afterEach(async () => {
    vi.useRealTimers();
    await sealBuses();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('leaves the task ready when the spawn does not produce a live agent', () => {
    tmp = mkdtempSync(join(tmpdir(), 'org-dispatch-lazy-fail-'));
    const daemon = new OrgDaemon(tmp);
    const bus = openBus(tmp);
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
    const bus = openBus(tmp);
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

/**
 * ADR-O001 D5, wired end to end: the pure decision lives in
 * completion-gate.test.ts; this file asserts what dagCompleteTask DOES with a
 * refusal — the item must go back on the queue with the reason attached, not
 * crash the run and not silently vanish. The head sha comes from a real git
 * repo here, because the whole point is that the runtime resolves it rather
 * than trusting the number the agent typed.
 */
describe('dagCompleteTask: evidence gate (run_config.completion_evidence)', () => {
  let tmp = '';
  afterEach(async () => {
    await sealBuses();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function commit(repo: string, file: string): string {
    writeFileSync(join(repo, file), file);
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-m', file], { cwd: repo });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  }

  function setup(completionEvidence: boolean, maxEvidenceAttempts?: number) {
    tmp = mkdtempSync(join(tmpdir(), 'org-evidence-'));
    const repo = join(tmp, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
    const sha = commit(repo, 'first.txt');

    const daemon = new OrgDaemon(tmp);
    const bus = openBus(tmp);
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const dev = makeAgent();
    const boss = makeAgent();
    const taskDag = new TaskDag();
    const task = taskDag.add('ship the thing', 'dev', []);
    const running: RunningOrg = {
      def: {
        ...minimalDef('alpha'),
        run_config: {
          completion_evidence: completionEvidence,
          ...(maxEvidenceAttempts === undefined
            ? {}
            : { max_evidence_attempts: maxEvidenceAttempts }),
        },
      } as unknown as OrgDef,
      run: 'run-1',
      bus,
      agents: new Map([
        ['dev', dev],
        ['boss', boss],
      ]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: 'boss',
      glossary: [],
      respawning: new Set(),
      taskDag,
      workdir: repo,
    };
    daemon.orgs.set('alpha', running);
    taskDag.markRunning(task.id);
    return { daemon, repo, sha, taskDag, task, dev, boss, events, running };
  }

  it('refuses a close with no evidence, requeues the task, and re-dispatches with the reason', async () => {
    const { daemon, taskDag, task, dev, events } = setup(true);
    const out = JSON.parse(
      dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'all done, looks good'),
    );

    expect(out.error).toMatch(/evidence/i);
    expect(out.requeued).toBe(task.id);
    // Re-dispatched, not closed and not abandoned: the DAG picked it back up.
    expect(taskDag.get(task.id)?.status).toBe('running');
    expect(events.find((e) => e.reason === 'task-evidence-refused')).toBeTruthy();
    expect(events.find((e) => e.reason === 'task-done')).toBeUndefined();

    await settleDispatch();
    const delivered = dev.mailbox.serialize().queue.join('\n');
    expect(delivered).toMatch(/NOT CLOSED/);
    expect(delivered).toContain(`[task:${task.id}]`);
    daemon.orgs.delete('alpha');
  });

  it('accepts evidence pinned to the current head, and records the commands on the task', () => {
    const { daemon, sha, taskDag, task } = setup(true);
    const out = JSON.parse(
      dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'green', {
        headSha: sha,
        checks: [{ command: 'pnpm vitest run thing.test.ts', exitCode: 0, output: '3 passed' }],
      }),
    );

    expect(out.done).toBe(task.id);
    expect(taskDag.get(task.id)?.status).toBe('done');
    // The record is the command and its exit code, not the prose claim alone.
    expect(taskDag.get(task.id)?.result).toContain('pnpm vitest run thing.test.ts');
    expect(taskDag.get(task.id)?.result).toContain('exit 0');
    daemon.orgs.delete('alpha');
  });

  it('accepts a check whose declared expectExit matched, and records the expectation on the task', () => {
    const { daemon, sha, taskDag, task, events } = setup(true);
    const out = JSON.parse(
      dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'unset key stays unset', {
        headSha: sha,
        checks: [
          {
            command: 'git config --get x.unset',
            exitCode: 1,
            expectExit: 1,
            expectReason: 'the key must stay unset',
          },
        ],
      }),
    );
    expect(out.done).toBe(task.id);
    // The reason travels with the exit code — a reader of the task row sees
    // WHY exit 1 was accepted, not just that it was.
    expect(taskDag.get(task.id)?.result).toContain('exit 1 (expected 1: the key must stay unset)');
    // Every accepted expectExit is auditable after the fact, without
    // re-reading the task: it is a bus event of its own.
    const audit = events.find((e) => e.reason === 'evidence-expect-exit');
    expect(audit?.data).toMatchObject({
      taskId: task.id,
      role: 'dev',
      command: 'git config --get x.unset',
      expectExit: 1,
      expectReason: 'the key must stay unset',
    });
    daemon.orgs.delete('alpha');
  });

  it('refuses expectExit on a whole test suite — the misuse that shipped in 2.15.6', () => {
    const { daemon, sha, taskDag, task, events } = setup(true);
    const out = JSON.parse(
      dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'suite is green but for one', {
        headSha: sha,
        checks: [
          {
            command: 'pnpm run test:all:run',
            exitCode: 1,
            expectExit: 1,
            expectReason: 'one known-failing test',
          },
        ],
      }),
    );
    expect(out.error).toMatch(/expectExit/);
    expect(out.requeued).toBe(task.id);
    expect(taskDag.get(task.id)?.status).not.toBe('done');
    expect(events.find((e) => e.reason === 'evidence-expect-exit')).toBeUndefined();
    daemon.orgs.delete('alpha');
  });

  it('emits no expect-exit audit for an ordinary exit-0 close', () => {
    const { daemon, sha, task, events } = setup(true);
    dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'green', {
      headSha: sha,
      checks: [{ command: 'pnpm vitest run thing.test.ts', exitCode: 0 }],
    });
    expect(events.find((e) => e.reason === 'evidence-expect-exit')).toBeUndefined();
    daemon.orgs.delete('alpha');
  });

  // THE case: evidence that passed at the sha it was gathered at, then the
  // tree moved. Nothing about the prose changes — only the commit does.
  it('refuses evidence pinned to a STALE sha after a new commit lands', () => {
    const { daemon, repo, sha, taskDag, task } = setup(true);
    const stale = { headSha: sha, checks: [{ command: 'pnpm test', exitCode: 0, output: 'ok' }] };
    const moved = commit(repo, 'second.txt');
    expect(moved).not.toBe(sha);

    const out = JSON.parse(dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'green', stale));

    expect(out.error).toMatch(/stale/i);
    expect(out.error).toContain(moved);
    expect(taskDag.get(task.id)?.status).not.toBe('done');
    daemon.orgs.delete('alpha');
  });

  // Upgrade safety: the same no-evidence close that is refused above closes
  // normally with the flag off, which is every existing org.
  it('closes normally with no evidence when completion_evidence is off (the default)', () => {
    const { daemon, taskDag, task } = setup(false);
    const out = JSON.parse(dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'all done'));
    expect(out.done).toBe(task.id);
    expect(taskDag.get(task.id)?.status).toBe('done');
    daemon.orgs.delete('alpha');
  });

  /**
   * ADR-O001 D4 — "bound retries (3) and escalate". D5's re-dispatch loop had
   * no cap: a role that kept failing the evidence gate kept getting the task
   * back forever. Each round costs a full LLM turn, so it is not a tight
   * loop, but nothing except the budget ceiling ever ended it.
   *
   * Escalation reuses what D4 already built rather than inventing a channel:
   * the task is failed with the reason recorded on it, a loud `audit` event
   * is emitted (same convention as `no-progress`), and the boss — the role
   * daemon.ts already notifies when a worker crashes — gets the task in its
   * mailbox to re-plan. The counter lives on the task row, so the checkpoint
   * carries it like every other piece of task state.
   */
  describe('retry cap (run_config.max_evidence_attempts)', () => {
    // A real failed proof: a check that did not exit as expected. (A call with
    // no evidence at all is a formatting slip and does not count — see below.)
    const failedCheck = (daemon: OrgDaemon, id: string, role = 'dev') =>
      JSON.parse(
        dagCompleteTask(daemon, 'alpha', role, id, 'trust me', {
          headSha: 'deadbeefdeadbeef',
          checks: [{ command: 'pnpm test', exitCode: 1, output: '1 failed' }],
        }),
      );
    const bare = (daemon: OrgDaemon, id: string) =>
      JSON.parse(dagCompleteTask(daemon, 'alpha', 'dev', id, 'done'));

    // The release org's first run: 4 of 6 tasks lost an attempt because the
    // role's first org_task_done carried no `evidence` object at all.
    it('a call with NO evidence object is refused and requeued but does not spend an attempt', async () => {
      const { daemon, taskDag, task, dev } = setup(true, 2);
      for (let i = 0; i < 3; i++) {
        const out = bare(daemon, task.id);
        expect(out.error).toMatch(/evidence/i);
        expect(out.requeued).toBe(task.id);
      }
      expect(taskDag.get(task.id)?.evidenceFailures).toBeFalsy();
      expect(taskDag.get(task.id)?.status).toBe('running');
      await settleDispatch();
      expect(dev.mailbox.serialize().queue.join('\n')).toMatch(/did not count/);

      // A real failed check still counts.
      expect(failedCheck(daemon, task.id).requeued).toBe(task.id);
      expect(taskDag.get(task.id)?.evidenceFailures).toBe(1);
      daemon.orgs.delete('alpha');
    });

    it('escalates to the boss on the third failure instead of re-dispatching again', async () => {
      const { daemon, taskDag, task, dev, boss, events } = setup(true);

      expect(failedCheck(daemon, task.id).requeued).toBe(task.id);
      expect(failedCheck(daemon, task.id).requeued).toBe(task.id);
      expect(taskDag.get(task.id)?.status).toBe('running');

      const third = failedCheck(daemon, task.id);
      expect(third.requeued).toBeUndefined();
      expect(third.escalated).toBe(task.id);
      expect(third.attempts).toBe(3);
      // Terminal and explicitly recorded, not left non-terminal with nothing
      // scheduled to pick it up (the D4 liveness invariant).
      expect(taskDag.get(task.id)?.status).toBe('failed');
      expect(taskDag.get(task.id)?.result).toMatch(/evidence/i);

      const escalation = events.find((e) => e.reason === 'task-evidence-escalated');
      expect(escalation).toBeTruthy();
      expect(escalation?.data).toMatchObject({ taskId: task.id, assignee: 'dev', attempts: 3 });

      await settleDispatch();
      // The boss is told; the assignee is not handed the task a third time.
      // (The two returns land in one coalesced mailbox entry — #275.)
      expect(boss.mailbox.serialize().queue.join('\n')).toMatch(/ESCALATED/);
      const returned =
        dev.mailbox
          .serialize()
          .queue.join('\n')
          .match(/NOT CLOSED/g) ?? [];
      expect(returned).toHaveLength(2);
      daemon.orgs.delete('alpha');
    });

    // A crash that reset the count would make the cap meaningless: the role
    // would get three fresh attempts after every resume.
    it('carries the failure count through a checkpoint round-trip', () => {
      const { daemon, taskDag, task, running } = setup(true);
      failedCheck(daemon, task.id);
      failedCheck(daemon, task.id);
      expect(taskDag.get(task.id)?.evidenceFailures).toBe(2);

      const checkpoint = captureCheckpoint(running);
      running.taskDag = TaskDag.fromJSON(checkpoint.tasks ?? []);
      expect(running.taskDag.get(task.id)?.evidenceFailures).toBe(2);

      // Third failure of the SAME task, counted across the restart.
      expect(failedCheck(daemon, task.id).escalated).toBe(task.id);
      daemon.orgs.delete('alpha');
    });

    it('counts per task, not globally', () => {
      const { daemon, taskDag, task } = setup(true);
      const other = taskDag.add('another thing', 'dev', []);
      taskDag.markRunning(other.id);

      failedCheck(daemon, task.id);
      failedCheck(daemon, task.id);
      // A different task is on attempt 1, not inheriting the other's two.
      expect(failedCheck(daemon, other.id).requeued).toBe(other.id);
      expect(taskDag.get(other.id)?.evidenceFailures).toBe(1);
      expect(taskDag.get(other.id)?.status).not.toBe('failed');
      daemon.orgs.delete('alpha');
    });

    // Two failures then a pass must not leave the task one failure from
    // escalation for the rest of its life.
    it('clears the count when the task is closed with accepted evidence', () => {
      const { daemon, sha, taskDag, task } = setup(true);
      failedCheck(daemon, task.id);
      failedCheck(daemon, task.id);
      expect(taskDag.get(task.id)?.evidenceFailures).toBe(2);

      const out = JSON.parse(
        dagCompleteTask(daemon, 'alpha', 'dev', task.id, 'green', {
          headSha: sha,
          checks: [{ command: 'pnpm test', exitCode: 0 }],
        }),
      );
      expect(out.done).toBe(task.id);
      expect(taskDag.get(task.id)?.evidenceFailures).toBeFalsy();
      daemon.orgs.delete('alpha');
    });

    // A boss poking org_task_done on someone else's task is refused, but it
    // is not the assignee failing to produce evidence — it must not burn the
    // assignee's budget of attempts.
    it('does not count a refusal aimed at a role that is not the assignee', () => {
      const { daemon, taskDag, task } = setup(true);
      expect(failedCheck(daemon, task.id, 'boss').error).toMatch(/assigned to "dev"/);
      expect(failedCheck(daemon, task.id, 'boss').error).toMatch(/assigned to "dev"/);
      expect(failedCheck(daemon, task.id, 'boss').error).toMatch(/assigned to "dev"/);
      expect(taskDag.get(task.id)?.evidenceFailures).toBeFalsy();
      expect(taskDag.get(task.id)?.status).not.toBe('failed');
      daemon.orgs.delete('alpha');
    });

    it('honours a configured cap', () => {
      const { daemon, taskDag, task } = setup(true, 1);
      const out = failedCheck(daemon, task.id);
      expect(out.escalated).toBe(task.id);
      expect(out.attempts).toBe(1);
      expect(taskDag.get(task.id)?.status).toBe('failed');
      daemon.orgs.delete('alpha');
    });
  });
});

/**
 * #319: with `run_config.session_scope: 'task'` a role's model session is keyed
 * per task and resumed per task, so a session resumed for a FOLLOW-UP task
 * still carries the previous, already-closed task in its context. Closing that
 * remembered id used to SUCCEED — `markRunning()` is a no-op on a terminal task
 * and `complete()` had no terminal guard — so `notify_task_creator` sent the
 * creator a second "[task:<already-closed id>] DONE" while the task the role
 * was actually working stayed 'running'. Observed twice on the 2.15.6 release
 * run (cli-qa's task-5 → task-7 follow-up).
 */
describe('dagCompleteTask: a resumed session cannot re-close an already-closed task (#319)', () => {
  let tmp = '';
  afterEach(async () => {
    await sealBuses();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function setup() {
    tmp = mkdtempSync(join(tmpdir(), 'org-stale-close-'));
    const daemon = new OrgDaemon(tmp);
    const bus = openBus(tmp);
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const dev = makeAgent();
    const boss = makeAgent();
    const taskDag = new TaskDag();
    const running: RunningOrg = {
      def: {
        ...minimalDef('alpha'),
        roles: [{ id: 'boss' }, { id: 'dev', reports_to: 'boss' }],
        run_config: { notify_task_creator: true, session_scope: 'task' },
      } as unknown as OrgDef,
      run: 'run-1',
      bus,
      agents: new Map([
        ['dev', dev],
        ['boss', boss],
      ]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: 'boss',
      glossary: [],
      respawning: new Set(),
      taskDag,
    };
    daemon.orgs.set('alpha', running);
    return { daemon, taskDag, dev, boss, events, running };
  }

  it('refuses the stale id, sends no second DONE, and names the task actually open', async () => {
    const { daemon, taskDag, boss, events, running } = setup();
    const first = taskDag.add('ROUND1 CLI QA', 'dev', []);
    first.createdBy = 'boss';
    dispatchReadyTasks(daemon, 'alpha', running);
    expect(JSON.parse(dagCompleteTask(daemon, 'alpha', 'dev', first.id, 'round 1 done')).done).toBe(
      first.id,
    );

    // The evidence gap is filed as a follow-up and dispatched: the role's
    // session is resumed FOR THAT TASK, with the closed one still in context.
    const followUp = taskDag.add('fill the ROUND1 evidence gap', 'dev', []);
    followUp.createdBy = 'boss';
    dispatchReadyTasks(daemon, 'alpha', running);
    expect(taskDag.get(followUp.id)?.status).toBe('running');
    await settleDispatch();
    const beforeBoss = boss.mailbox.serialize().queue.length;

    const out = JSON.parse(
      dagCompleteTask(daemon, 'alpha', 'dev', first.id, 'orphan-reaping logs attached'),
    );

    expect(out.done).toBeUndefined();
    expect(out.error).toMatch(/already done/i);
    expect(out.error).toContain(followUp.id);
    // The follow-up is untouched — it must not look closed by a stale notice.
    expect(taskDag.get(followUp.id)?.status).toBe('running');
    expect(events.filter((e) => e.reason === 'task-done')).toHaveLength(1);
    expect(events.find((e) => e.reason === 'task-already-closed')).toBeTruthy();

    await settleDispatch();
    const delivered = boss.mailbox.serialize().queue.slice(beforeBoss).join('\n');
    expect(delivered).not.toContain(`[task:${first.id}] DONE`);
    daemon.orgs.delete('alpha');
  });

  it('tags the DONE notice with the completed task, not the other open one', async () => {
    const { daemon, taskDag, boss, running } = setup();
    const first = taskDag.add('ROUND1 CLI QA', 'dev', []);
    first.createdBy = 'boss';
    const followUp = taskDag.add('fill the ROUND1 evidence gap', 'dev', []);
    followUp.createdBy = 'boss';
    dispatchReadyTasks(daemon, 'alpha', running);

    expect(
      JSON.parse(dagCompleteTask(daemon, 'alpha', 'dev', followUp.id, 'gap filled')).done,
    ).toBe(followUp.id);

    await settleDispatch();
    const delivered = boss.mailbox.serialize().queue.join('\n');
    expect(delivered).toContain(`[task:${followUp.id}] DONE`);
    expect(delivered).not.toContain(`[task:${first.id}] DONE`);
    daemon.orgs.delete('alpha');
  });
});
