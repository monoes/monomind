/**
 * org_task_cancel stops the assignee's work, not only the task's status. On
 * the 2.16.2 release run the coordinator cancelled task-25 while the fixer was
 * mid-turn on it; nothing told the fixer, which worked on for 25 minutes and
 * committed a fix that was later integrated after the final audit. Now the
 * assignee is told, its task-scoped process for that task is ended, and a
 * close of the cancelled task is refused as cancelled.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import type { AgentRuntime, RunningOrg } from '../../src/orgrt/daemon.js';
import { dagCancelTask, dagCompleteTask } from '../../src/orgrt/decisions.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { TaskProcesses, cancelNotice } from '../../src/orgrt/task-cancel.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { type BusEvent, OrgDefSchema } from '../../src/orgrt/types.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

describe('TaskProcesses', () => {
  it('ends only the live process of the cancelled task', () => {
    const procs = new TaskProcesses();
    const live = procs.track('task-4');
    expect(procs.stop('task-9', 'n')).toBe(false);
    expect(live.signal.aborted).toBe(false);
    expect(procs.stop('task-4', 'n')).toBe(true);
    expect(live.signal.aborted).toBe(true);
    expect((live.signal.reason as { notice: string }).notice).toBe('n');
    expect(procs.stop('task-4', 'n')).toBe(false); // once
  });

  it('does nothing once the process is gone', () => {
    const procs = new TaskProcesses();
    const live = procs.track('task-4');
    live.release();
    expect(procs.stop('task-4', 'n')).toBe(false);
    expect(live.signal.aborted).toBe(false);
  });
});

function org() {
  const bus = new OrgBus('x', 'run-1', tmp('cancel-bus-'));
  const events: BusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const agent = (): AgentRuntime =>
    ({
      mailbox: new Mailbox(),
      policy: {},
      done: Promise.resolve(),
      status: 'running',
      metrics: { tokens: 0, costUsd: 0 },
      taskProcesses: new TaskProcesses(),
    }) as unknown as AgentRuntime;
  const fixer = agent();
  const captain = agent();
  const taskDag = new TaskDag();
  const running = {
    def: OrgDefSchema.parse({
      name: 'x',
      run_config: { session_scope: 'task' },
      roles: [{ id: 'captain' }, { id: 'fixer', reports_to: 'captain' }],
    }),
    run: 'run-1',
    bus,
    agents: new Map([
      ['fixer', fixer],
      ['captain', captain],
    ]),
    busEvents: () => [],
    roleSlots: new Map(),
    bossRoleId: 'captain',
    glossary: [],
    respawning: new Set(),
    taskDag,
  } as unknown as RunningOrg;
  const daemon = { orgs: new Map([['x', running]]), root: tmp('cancel-root-') } as any;
  return { daemon, running, taskDag, fixer, captain, events };
}

describe('dagCancelTask tells the assignee', () => {
  it('ends the assignee’s process for the task; the session loop queues the notice', () => {
    const { daemon, taskDag, fixer, events } = org();
    const t = taskDag.add('FIX r4 2.16.2', 'fixer', []);
    taskDag.markRunning(t.id);
    const live = fixer.taskProcesses!.track(t.id);

    JSON.parse(dagCancelTask(daemon, 'x', 'captain', t.id, 'pre-existing in 2.16.1'));

    expect(live.signal.aborted).toBe(true);
    expect((live.signal.reason as { notice: string }).notice).toBe(
      cancelNotice(t.id, 'captain', 'pre-existing in 2.16.1'),
    );
    // Not pushed now: the dying process's stream must not take it.
    expect(fixer.mailbox.peek()).toBeUndefined();
    const e = events.find((x) => x.reason === 'task-cancel-notified');
    expect(e?.data).toMatchObject({ taskId: t.id, assignee: 'fixer', processStopped: true });
  });

  it('queues the notice at once when no process is on the task, and leaves another task’s process alone', () => {
    const { daemon, taskDag, fixer } = org();
    const other = taskDag.add('DOCS r1', 'fixer', []);
    const t = taskDag.add('FIX r4', 'fixer', []);
    taskDag.markRunning(t.id); // dispatched: a never-dispatched task needs no notice
    const live = fixer.taskProcesses!.track(other.id);

    dagCancelTask(daemon, 'x', 'captain', t.id, 'moot');

    expect(live.signal.aborted).toBe(false);
    expect(fixer.mailbox.peek()).toMatch(new RegExp(`^\\[task:${t.id}\\] CANCELLED .*stop now, do not commit or report further work for it`));
  });

  it('sends nothing to a role cancelling its own task', () => {
    const { daemon, taskDag, fixer, events } = org();
    const t = taskDag.add('FIX r4', 'fixer', []);
    const live = fixer.taskProcesses!.track(t.id);
    dagCancelTask(daemon, 'x', 'fixer', t.id);
    expect(live.signal.aborted).toBe(false);
    expect(fixer.mailbox.peek()).toBeUndefined();
    expect(events.find((x) => x.reason === 'task-cancel-notified')).toBeUndefined();
  });

  it('org_task_done on the cancelled task is refused as cancelled, not as reported long ago', () => {
    const { daemon, taskDag } = org();
    const t = taskDag.add('FIX r4', 'fixer', []);
    const next = taskDag.add('DOCS r1', 'fixer', []);
    dagCancelTask(daemon, 'x', 'captain', t.id, 'pre-existing in 2.16.1');

    const out = JSON.parse(dagCompleteTask(daemon, 'x', 'fixer', t.id, 'fixed in fdcea48c1'));

    expect(out.done).toBeUndefined();
    expect(out.error).toMatch(/was cancelled \(pre-existing in 2\.16\.1\)/);
    expect(out.error).toMatch(/do not commit, integrate or report further work for it/);
    expect(out.error).not.toMatch(/reported long ago/);
    expect(out.error).toContain(next.id);
    expect(taskDag.get(t.id)?.status).toBe('cancelled');
  });
});

describe('a cancelled task’s process, in the session loop', () => {
  /** Process 0 starts task-4 and hangs in a tool call until its signal
   *  aborts, as a real runner's child does; process 1 reads one message. */
  function setup() {
    const def = OrgDefSchema.parse({
      name: 'x',
      run_config: { session_scope: 'task' },
      roles: [{ id: 'boss' }, { id: 'fixer', reports_to: 'boss' }],
    });
    const bus = new OrgBus('x', 'run-1', tmp('cancel-sess-'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const mailbox = new Mailbox();
    mailbox.push('[task:task-4] FIX r4 2.16.2');
    const procs = new TaskProcesses();
    let inTool!: () => void;
    const busy = new Promise<void>((r) => {
      inTool = r;
    });
    const calls: { resume?: string; signal: AbortSignal; first?: string }[] = [];
    const runner = {
      run: async function* (args: any) {
        const call = calls.length;
        const it = args.prompt[Symbol.asyncIterator]();
        const first = await it.next();
        calls.push({ resume: args.resume, signal: args.signal, first: first.value?.message?.content });
        yield { type: 'assistant', text: 'working on the fix', session_id: 'sess-1' };
        if (call === 0) {
          inTool();
          await new Promise((_, reject) =>
            args.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            ),
          );
        }
        yield { type: 'result', subtype: 'success', session_id: 'sess-2' };
        mailbox.close();
      },
    };
    const opts = {
      org: 'x',
      role: def.roles[1],
      bus,
      policy: new PolicyEngine('fixer', {}, bus, '/tmp'),
      mailbox,
      cwd: '/tmp',
      def,
      deliver: async () => 'ok',
      runner,
      taskProcesses: procs,
    } as unknown as SessionOpts;
    return { opts, procs, busy, calls, events };
  }

  it('ends the process mid-tool, and the next process starts fresh with the notice', async () => {
    const { opts, procs, busy, calls, events } = setup();
    const done = runAgentSession(opts);
    await busy;
    const notice = cancelNotice('task-4', 'boss', 'moot');
    expect(procs.stop('task-4', notice)).toBe(true);
    await done;

    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].first).toBe(notice);
    expect(calls[1].resume).toBeUndefined();
    expect(events.filter((e) => e.reason === 'task-cancel-stopped')).toHaveLength(1);
    expect(events.filter((e) => e.reason === 'session-error')).toHaveLength(0);
  });
});
