/**
 * A cancel must not overtake the task it cancels. A dispatch is held for the
 * coalescing window (longer while its skill suggestion resolves) but the
 * cancel notice went straight to the mailbox, so the assignee could read
 * "CANCELLED" for a task it had not been given, then receive the task and
 * start it. A task the assignee never received is now withdrawn from the
 * window without a notice, and a cancelled task is not delivered.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import {
  DISPATCH_COALESCE_MS,
  dagCancelTask,
  dagCreateTask,
  nudgeOpenTasksAtTurnEnd,
} from '../../src/orgrt/decisions.js';
import { holdTaskLine, resolveHeld, settleHeld, withdrawHeldTask } from '../../src/orgrt/dispatch-hold.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession, type SessionOpts } from '../../src/orgrt/session.js';
import { TaskProcesses, cancelNotice } from '../../src/orgrt/task-cancel.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { type BusEvent, OrgDefSchema } from '../../src/orgrt/types.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function setup() {
  const def = OrgDefSchema.parse({
    name: 'o',
    roles: [{ id: 'boss' }, { id: 'dev', reports_to: 'boss' }],
  });
  const bus = new OrgBus('o', 'r', tmp('cancel-dispatch-'));
  const events: BusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const boxes = { boss: new Mailbox(), dev: new Mailbox() };
  const running = {
    def,
    taskDag: new TaskDag(),
    bus,
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
  const create = (title: string, deps: string[] = []) =>
    JSON.parse(dagCreateTask(daemon, 'o', 'boss', title, 'dev', deps)).id as string;
  return { running, daemon, boxes, drain, events, create };
}

describe('cancelling a task its assignee has not received', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('withdraws the held dispatch and sends no notice', () => {
    const { daemon, boxes, drain, events, create } = setup();
    const id = create('fix the retry');
    dagCancelTask(daemon, 'o', 'boss', id, 'moot');
    expect(drain(boxes.dev)).toEqual([]); // no notice ahead of the task
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev)).toEqual([]); // and no task after it
    expect(events.find((e) => e.reason === 'task-cancel-notified')).toBeUndefined();
    expect(events.find((e) => e.reason === 'task-cancel-withdrawn')?.data).toMatchObject({
      taskId: id,
      assignee: 'dev',
    });
  });

  it('keeps the other tasks held in the same window', () => {
    const { daemon, boxes, drain, create } = setup();
    const keep = create('write the docs');
    const drop = create('fix the retry');
    dagCancelTask(daemon, 'o', 'boss', drop);
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    const got = drain(boxes.dev);
    expect(got).toHaveLength(1);
    expect(got[0]).toContain(`[task:${keep}] write the docs`);
    expect(got[0]).not.toContain(`[task:${drop}]`);
  });

  it('does not wake the assignee for a task that was never dispatched', () => {
    const { daemon, boxes, drain, events, create } = setup();
    const first = create('build');
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    drain(boxes.dev);
    const later = create('ship', [first]); // pending on `first`
    dagCancelTask(daemon, 'o', 'boss', later);
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev)).toEqual([]);
    expect(events.find((e) => e.reason === 'task-cancel-notified')).toBeUndefined();
  });
});

describe('cancelling a task its assignee already has', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('MONOMIND_JEV_URL', '');
    vi.stubEnv('TYPESAFE_API_KEY', '');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('sends the notice and drops a held follow-up for the cancelled task', () => {
    const { daemon, running, boxes, drain, create } = setup();
    const id = create('fix the retry');
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev)[0]).toContain(`[task:${id}] fix the retry`);
    nudgeOpenTasksAtTurnEnd(running, 'dev'); // "STILL OPEN" is now held
    dagCancelTask(daemon, 'o', 'boss', id, 'moot');
    vi.advanceTimersByTime(DISPATCH_COALESCE_MS + 1);
    expect(drain(boxes.dev)).toEqual([cancelNotice(id, 'boss', 'moot')]);
  });
});

describe('a cancel that lands while the process is starting', () => {
  it('ends the process even though it came before the listener was attached', async () => {
    const def = OrgDefSchema.parse({
      name: 'x',
      run_config: { session_scope: 'task' },
      roles: [{ id: 'boss' }, { id: 'fixer', reports_to: 'boss' }],
    });
    const bus = new OrgBus('x', 'run-1', tmp('cancel-start-'));
    const mailbox = new Mailbox();
    mailbox.push('[task:task-4] FIX r4');
    const procs = new TaskProcesses();
    const signals: boolean[] = [];
    const runner = {
      run: async function* (args: any) {
        signals.push(args.signal.aborted);
        const it = args.prompt[Symbol.asyncIterator]();
        await it.next();
        if (signals.length > 1) mailbox.close();
        yield { type: 'result', subtype: 'success', session_id: `s-${signals.length}` };
      },
    };
    let starts = 0;
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
      // The cancel arrives while the session is still being set up.
      buildProviderTools: async () => {
        if (starts++ === 0) procs.stop('task-4', cancelNotice('task-4', 'boss'));
        return { tools: [], close() {} };
      },
    } as unknown as SessionOpts;
    await runAgentSession(opts);
    expect(signals[0]).toBe(true);
  });
});

describe('a dispatch still resolving its skill suggestion', () => {
  it('is withdrawn by a cancel that lands while it resolves', async () => {
    const running = { taskDag: new TaskDag() } as any;
    let resolve!: (s: string) => void;
    const slow = new Promise<string>((r) => {
      resolve = r;
    });
    const entry = { lines: ['[task:task-1] docs', slow] as (string | Promise<string>)[], timer: 0 as any };
    holdTaskLine(running, entry, '[task:task-1] docs', 'task-1', false);
    holdTaskLine(running, entry, slow, 'task-2', false);
    const pending = resolveHeld(entry);
    expect(withdrawHeldTask(running, 'dev', 'task-2')).toEqual({ withdrawn: false, received: false });
    running.pendingDispatch = new Map([['dev', entry]]);
    expect(withdrawHeldTask(running, 'dev', 'task-2')).toEqual({ withdrawn: true, received: false });
    resolve('[task:task-2] fix');
    const { held, lines } = await pending;
    expect(settleHeld(running, entry, held, lines)).toEqual(['[task:task-1] docs']);
  });
});
