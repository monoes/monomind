/**
 * #329: a blocked task used to sleep until its `until` deadline with nothing
 * to wake it. In the 2.16.1 release run a builder blocked "until 11:00Z" on a
 * background `pnpm install` that finished four minutes later; its process was
 * idle-cycled and nothing resumed the task until an operator stepped in 28
 * minutes later. Nothing external (a background command's completion, a
 * Monitor event, npm propagation) reaches a blocked task, so the runtime now
 * re-checks it: every block wakes its assignee on a bounded interval until the
 * deadline or close. The next re-check time rides the task row, so it
 * survives process cycling and checkpoint resume.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockRecheckMs,
  DEFAULT_BLOCK_RECHECK_MINUTES,
  MAX_BLOCK_RECHECK_MINUTES,
  wakeDueBlockRechecks,
} from '../orgrt/block-recheck.js';
import type { OrgDaemon, RunningOrg } from '../orgrt/daemon.js';
import { dagBlockTask } from '../orgrt/decisions.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { buildOrgTools } from '../orgrt/session.js';
import { TaskDag } from '../orgrt/task-dag.js';
import { type BusEvent, OrgDefSchema, type OrgRole } from '../orgrt/types.js';

const T0 = Date.parse('2026-09-24T09:00:00Z');
const MIN = 60_000;

function fakeOrg(dag: TaskDag, runConfig: Record<string, unknown> = {}) {
  const events: BusEvent[] = [];
  const mailbox = new Mailbox();
  const running = {
    taskDag: dag,
    agents: new Map([['builder', { mailbox }]]),
    bus: { emit: (e: BusEvent) => events.push(e) },
    def: OrgDefSchema.parse({ name: 'o', roles: [{ id: 'builder' }], run_config: runConfig }),
  } as unknown as RunningOrg;
  const daemon = { orgs: new Map([['o', running]]) } as unknown as OrgDaemon;
  return { running, daemon, mailbox, events };
}

function queued(mailbox: Mailbox): string[] {
  return mailbox.serialize().queue;
}

function blockedDag(): { dag: TaskDag; id: string } {
  const dag = new TaskDag();
  const t = dag.add('Build and pack', 'builder');
  dag.markRunning(t.id);
  return { dag, id: t.id };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('#329 blocked-task re-check', () => {
  it('wakes the assignee once the interval passes, not before', () => {
    const { dag, id } = blockedDag();
    const org = fakeOrg(dag);
    const res = JSON.parse(
      dagBlockTask(org.daemon, 'o', 'builder', id, '2026-09-24T11:00:00Z', 'pnpm install'),
    );
    expect(res.status).toBe('blocked');
    expect(res.nextRecheck).toBe(new Date(T0 + DEFAULT_BLOCK_RECHECK_MINUTES * MIN).toISOString());

    vi.setSystemTime(T0 + 4 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now())).toEqual([]);
    expect(queued(org.mailbox)).toEqual([]);

    vi.setSystemTime(T0 + 5 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now()).map((t) => t.id)).toEqual([id]);
    const [msg] = queued(org.mailbox);
    expect(msg).toContain(`[task:${id}] still blocked`);
    expect(msg).toContain('pnpm install');
    expect(msg).toMatch(/org_task_done/);
    expect(msg).toMatch(/org_task_block/);
    expect(org.events.some((e) => e.reason === 'task-block-recheck')).toBe(true);
    // Still blocked: a re-check is a question, not an unblock.
    expect(dag.get(id)?.status).toBe('blocked');
  });

  it('keeps re-checking at the interval until the deadline', () => {
    const { dag, id } = blockedDag();
    const org = fakeOrg(dag, { block_recheck_minutes: 10 });
    dagBlockTask(org.daemon, 'o', 'builder', id, new Date(T0 + 35 * MIN).toISOString());
    const fired: number[] = [];
    for (let m = 1; m <= 40; m++) {
      vi.setSystemTime(T0 + m * MIN);
      if (wakeDueBlockRechecks(org.running, Date.now()).length) fired.push(m);
      dag.unblockExpired(Date.now());
    }
    expect(fired).toEqual([10, 20, 30]);
    expect(dag.get(id)?.status).toBe('running');
    expect(dag.get(id)?.recheckAt).toBeUndefined();
  });

  it('stops once the task is closed', () => {
    const { dag, id } = blockedDag();
    const org = fakeOrg(dag);
    dagBlockTask(org.daemon, 'o', 'builder', id, '2026-09-24T11:00:00Z');
    vi.setSystemTime(T0 + 5 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now())).toHaveLength(1);
    dag.complete(id, 'install finished');
    vi.setSystemTime(T0 + 60 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now())).toEqual([]);
  });

  it('survives checkpoint resume: the next re-check time rides the task row', () => {
    const { dag, id } = blockedDag();
    dagBlockTask(fakeOrg(dag).daemon, 'o', 'builder', id, '2026-09-24T11:00:00Z');
    const restored = TaskDag.fromJSON(JSON.parse(JSON.stringify(dag.toJSON())));
    const org = fakeOrg(restored);
    vi.setSystemTime(T0 + 3 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now())).toEqual([]);
    // The process was down across the due time: the first tick after resume fires.
    vi.setSystemTime(T0 + 7 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now()).map((t) => t.id)).toEqual([id]);
    vi.setSystemTime(T0 + 11 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now())).toEqual([]);
    vi.setSystemTime(T0 + 12 * MIN);
    expect(wakeDueBlockRechecks(org.running, Date.now())).toHaveLength(1);
  });

  it('schedules a block restored from a checkpoint written before re-checks existed', () => {
    const { dag, id } = blockedDag();
    dag.block(id, T0 + 120 * MIN, 'legacy');
    const row = dag.get(id)!;
    delete row.recheckAt;
    delete row.recheckEveryMs;
    const org = fakeOrg(TaskDag.fromJSON(JSON.parse(JSON.stringify(dag.toJSON()))));
    expect(wakeDueBlockRechecks(org.running, T0)).toEqual([]);
    expect(wakeDueBlockRechecks(org.running, T0 + 5 * MIN)).toHaveLength(1);
  });

  it('lets the role re-block a blocked task, restarting its re-check clock', () => {
    const { dag, id } = blockedDag();
    const org = fakeOrg(dag);
    dagBlockTask(org.daemon, 'o', 'builder', id, '2026-09-24T11:00:00Z');
    vi.setSystemTime(T0 + 5 * MIN);
    wakeDueBlockRechecks(org.running, Date.now());
    const res = JSON.parse(
      dagBlockTask(org.daemon, 'o', 'builder', id, '2026-09-24T12:00:00Z', 'npm propagation', 20),
    );
    expect(res.error).toBeUndefined();
    expect(dag.get(id)?.blockedReason).toBe('npm propagation');
    expect(dag.get(id)?.recheckAt).toBe(T0 + 25 * MIN);
  });

  it('bounds the interval: run_config default, a role request, and the cap', () => {
    expect(blockRecheckMs()).toBe(DEFAULT_BLOCK_RECHECK_MINUTES * MIN);
    expect(blockRecheckMs(15)).toBe(15 * MIN);
    expect(blockRecheckMs(15, 30)).toBe(30 * MIN);
    expect(blockRecheckMs(undefined, 10_000)).toBe(MAX_BLOCK_RECHECK_MINUTES * MIN);
    expect(blockRecheckMs(undefined, 0.01)).toBe(MIN);
  });

  it('validates run_config.block_recheck_minutes', () => {
    const parse = (v: unknown) =>
      OrgDefSchema.safeParse({
        name: 'o',
        roles: [{ id: 'builder' }],
        run_config: { block_recheck_minutes: v },
      });
    expect(parse(5).success).toBe(true);
    expect(parse(0).success).toBe(false);
    expect(parse(MAX_BLOCK_RECHECK_MINUTES + 1).success).toBe(false);
  });

  it('org_task_block says nothing external wakes a blocked task, and offers recheckAfterMinutes', () => {
    const tool = buildOrgTools({
      org: 'o',
      role: { id: 'builder', reports_to: 'boss' } as OrgRole,
      blockTask: () => '{}',
    } as never).find((t) => t.name === 'org_task_block');
    expect(tool?.description).toMatch(/Nothing external/);
    expect(tool?.description).toMatch(/foreground/);
    expect(Object.keys(tool?.schema ?? {})).toContain('recheckAfterMinutes');
  });
});
