// packages/@monomind/cli/__tests__/orgrt/lead-watch.test.ts
// Scripted (no model). The lead is told once when a role holding an open task
// never started or went silent; never for a role without an open task or one
// that is making progress; and not again once the lead reassigns.
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

let resourcesOk = true;
vi.mock('../../src/utils/resource-governor.js', () => ({
  checkResources: vi.fn(() => ({
    ok: resourcesOk,
    freeMemMB: 2000,
    freeMemPct: resourcesOk ? 80 : 5,
    sdkProcesses: 0,
    maxSdkProcesses: 10,
    reason: resourcesOk ? undefined : 'simulated pressure',
  })),
  waitForCapacity: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 50));
    return {
      ok: resourcesOk,
      freeMemMB: 2000,
      freeMemPct: resourcesOk ? 80 : 5,
      sdkProcesses: 0,
      maxSdkProcesses: 10,
      reason: resourcesOk ? undefined : 'simulated pressure',
    };
  }),
  getResourceLimits: vi.fn(() => ({ minFreeMemBytes: 0, maxSdkProcesses: 10, spawnStaggerMs: 0 })),
  configureResourceLimits: vi.fn(),
  reapOrphanedSdkProcesses: vi.fn(() => 0),
}));

const { OrgDaemon } = await import('../../src/orgrt/daemon.js');
const { dagCreateTask } = await import('../../src/orgrt/decisions.js');
const { LeadWatch, MAX_NOTICES, leadWatchConfig, isActionableAssignment } = await import(
  '../../src/orgrt/lead-watch.js'
);
type RoleSnapshot = import('../../src/orgrt/lead-watch.js').RoleSnapshot;

const TMP = process.env.TMPDIR ?? '/var/tmp';
const CFG = { notStartedMs: 90_000, silentMs: 180_000 };

const role = (over: Partial<RoleSnapshot> = {}): RoleSnapshot => ({
  id: 'worker-8',
  lead: 'lead',
  started: false,
  lastActivity: 0,
  waiting: false,
  openTasks: [{ id: 'task-29', title: 'answer m29', since: 0 }],
  ...over,
});

describe('LeadWatch (pure)', () => {
  it('B1: a role that never started is reported once, naming role, tasks, age and options', () => {
    const w = new LeadWatch(CFG);
    expect(w.tick([role()], 89_000)).toEqual([]); // not yet
    const [n] = w.tick([role()], 91_000);
    expect(n.lead).toBe('lead');
    expect(n.kind).toBe('not-started');
    expect(n.taskIds).toEqual(['task-29']);
    expect(n.text).toContain('worker-8');
    expect(n.text).toContain('task-29');
    expect(n.text).toContain('91s');
    expect(n.text).toContain('org_task');
    expect(n.text).toContain('org_task_cancel');
    expect(n.text).toContain('acknowledge');
    expect(w.tick([role()], 92_000)).toEqual([]); // once
  });

  it('B2: a silent role with an open task is reported once, then with backoff, capped', () => {
    const w = new LeadWatch(CFG);
    const silent = role({ started: true, lastActivity: 1_000 });
    expect(w.tick([silent], 100_000)).toEqual([]);
    expect(w.tick([silent], 182_000)).toHaveLength(1); // 180 s after its last event
    expect(w.tick([silent], 200_000)).toEqual([]);
    expect(w.tick([silent], 182_000 + 2 * 180_000 - 1_000)).toEqual([]); // inside the doubled gap
    expect(w.tick([silent], 182_000 + 2 * 180_000 + 1_000)).toHaveLength(1);
    const third = w.tick([silent], 182_000 + 2 * 180_000 + 1_000 + 4 * 180_000 + 1_000);
    expect(third).toHaveLength(1);
    expect(third[0].text).toContain('last notice');
    expect(w.tick([silent], 1e9)).toEqual([]); // MAX_NOTICES reached
    expect(MAX_NOTICES).toBe(3);
  });

  it('B2b: an episode ends when the role emits again, so a later silence is a new episode', () => {
    const w = new LeadWatch(CFG);
    expect(w.tick([role({ started: true, lastActivity: 0 })], 181_000)).toHaveLength(1);
    expect(w.tick([role({ started: true, lastActivity: 190_000 })], 200_000)).toEqual([]);
    expect(w.tick([role({ started: true, lastActivity: 190_000 })], 371_000)).toHaveLength(1);
  });

  it('B3: no message for a role without an open task, a working role, or a legitimate human wait', () => {
    const w = new LeadWatch(CFG);
    expect(w.tick([role({ openTasks: [] })], 1e9)).toEqual([]);
    expect(w.tick([role({ started: true, lastActivity: 1e9 - 10_000 })], 1e9)).toEqual([]);
    expect(w.tick([role({ started: true, lastActivity: 0, waiting: true })], 1e9)).toEqual([]);
    expect(w.tick([role({ lead: undefined })], 1e9)).toEqual([]); // nobody to tell
  });

  it('B3b: a silent clock starts at the task, not at a stale last event', () => {
    const w = new LeadWatch(CFG);
    const r = role({ started: true, lastActivity: 0, openTasks: [{ id: 't', title: 't', since: 500_000 }] });
    expect(w.tick([r], 600_000)).toEqual([]); // 100 s since the task arrived
    expect(w.tick([r], 681_000)).toHaveLength(1);
  });

  it('B4: a task the lead cancelled, re-created or acknowledged is never mentioned again', () => {
    const cancelled = new LeadWatch(CFG);
    expect(cancelled.tick([role()], 100_000)).toHaveLength(1);
    expect(cancelled.tick([role({ openTasks: [] })], 1e9)).toEqual([]); // cancel makes it terminal

    const reassigned = new LeadWatch(CFG);
    expect(reassigned.tick([role()], 100_000)).toHaveLength(1);
    reassigned.reassigned('task-29');
    expect(reassigned.tick([role()], 1e9)).toEqual([]);

    const acked = new LeadWatch(CFG);
    expect(acked.tick([role()], 100_000)).toHaveLength(1);
    acked.acknowledge('worker-8');
    expect(acked.tick([role()], 1e9)).toEqual([]);

    // a different task of the same role is still reported
    const other = new LeadWatch(CFG);
    other.tick([role()], 100_000);
    other.acknowledge('worker-8');
    const fresh = role({ openTasks: [{ id: 'task-30', title: 'answer m30', since: 100_000 }] });
    expect(other.tick([fresh], 1e9)).toHaveLength(1);
  });

  it('config: defaults 90 s / 180 s, overridable, false disables', () => {
    expect(leadWatchConfig({})).toEqual({ notStartedMs: 90_000, silentMs: 180_000 });
    expect(leadWatchConfig({ lead_watch: { silent_s: 5 } })).toEqual({
      notStartedMs: 90_000,
      silentMs: 5_000,
    });
    expect(leadWatchConfig({ lead_watch: false })).toBeNull();
  });
});

// Work handed out by org_send message, not by org_task (the sweep orgs): p1t worker-2 hung in one long Bash call at 143 s,
// held no task object, and the watch had nothing to watch.
describe('LeadWatch (pure), message-assigned work', () => {
  const msg = (since = 10_000) => ({ id: 'msg-1', title: 'Assignment: m5-m8', since, via: 'message' as const });
  const w2 = (over: Partial<RoleSnapshot> = {}) => role({ id: 'worker-2', openTasks: [], ...over });

  it('B1m: a role that was messaged an assignment and never started is reported once, naming the message', () => {
    const w = new LeadWatch(CFG);
    w.messageAssigned('worker-2', msg());
    expect(w.tick([w2()], 99_000)).toEqual([]); // 89 s since the message
    const [n] = w.tick([w2()], 101_000);
    expect(n).toMatchObject({ lead: 'lead', role: 'worker-2', kind: 'not-started', taskIds: ['msg-1'] });
    expect(n.text).toContain('Assignment: m5-m8');
    expect(n.text).toContain('91s');
    expect(w.tick([w2()], 102_000)).toEqual([]); // once
  });

  it('B2m: a started role that goes silent after its message (hung in one Bash call) is reported 180 s after its last event, with the same backoff and cap', () => {
    const w = new LeadWatch(CFG);
    w.messageAssigned('worker-2', msg());
    const hung = w2({ started: true, lastActivity: 143_000 });
    expect(w.tick([hung], 322_000)).toEqual([]);
    const [n] = w.tick([hung], 324_000);
    expect(n.kind).toBe('silent');
    expect(n.text).toContain('Assignment: m5-m8');
    expect(w.tick([hung], 400_000)).toEqual([]);
    expect(w.tick([hung], 324_000 + 2 * 180_000 + 1_000)).toHaveLength(1);
    expect(w.tick([hung], 324_000 + 2 * 180_000 + 1_000 + 4 * 180_000 + 1_000)).toHaveLength(1);
    expect(w.tick([hung], 1e9)).toEqual([]); // MAX_NOTICES
  });

  it('B2m: before its first event the silence runs from the message', () => {
    const w = new LeadWatch(CFG);
    w.messageAssigned('worker-2', msg(50_000));
    expect(w.tick([w2({ started: true, lastActivity: 0 })], 229_000)).toEqual([]);
    expect(w.tick([w2({ started: true, lastActivity: 0 })], 231_000)).toHaveLength(1);
  });

  it('B3m: a progressing role, a role with no message work, a human wait and a lead-less role are never reported', () => {
    const w = new LeadWatch(CFG);
    w.messageAssigned('worker-2', msg());
    expect(w.tick([w2({ started: true, lastActivity: 1e9 - 10_000 })], 1e9)).toEqual([]);
    expect(w.tick([w2({ started: true, lastActivity: 0, waiting: true })], 1e9)).toEqual([]);
    expect(w.tick([w2({ lead: undefined })], 1e9)).toEqual([]);
    expect(new LeadWatch(CFG).tick([w2({ started: true, lastActivity: 0 })], 1e9)).toEqual([]); // nothing assigned
  });

  it('B4m: a reply from the role, the lead acknowledging after a notice, or a reassignment ends it; a new assignment starts it again', () => {
    const replied = new LeadWatch(CFG);
    replied.messageAssigned('worker-2', msg());
    replied.messageReplied('worker-2'); // the role told its lead it is done
    expect(replied.tick([w2({ started: true, lastActivity: 20_000 })], 1e9)).toEqual([]);
    replied.messageAssigned('worker-2', { ...msg(2e9), id: 'msg-2' });
    expect(replied.tick([w2({ started: true, lastActivity: 2e9 })], 2e9 + 181_000)).toHaveLength(1);

    const acked = new LeadWatch(CFG);
    acked.messageAssigned('worker-2', msg());
    expect(acked.tick([w2({ started: true, lastActivity: 0 })], 200_000)).toHaveLength(1);
    expect(acked.acknowledge('worker-2')).toBe(true);
    expect(acked.tick([w2({ started: true, lastActivity: 0 })], 1e9)).toEqual([]);
    expect(acked.acknowledge('worker-2')).toBe(false); // nothing left to acknowledge

    const reassigned = new LeadWatch(CFG);
    reassigned.messageAssigned('worker-2', msg());
    expect(reassigned.tick([w2()], 101_000)).toHaveLength(1);
    reassigned.reassigned('msg-1');
    expect(reassigned.tick([w2()], 1e9)).toEqual([]);
  });

  it('a message and an open task of the same role are reported together, once', () => {
    const w = new LeadWatch(CFG);
    w.messageAssigned('worker-2', msg(0));
    const [n] = w.tick([w2({ openTasks: [{ id: 'task-9', title: 'x', since: 0 }] })], 91_000);
    expect(n.taskIds.sort()).toEqual(['msg-1', 'task-9']);
  });

  it('isActionableAssignment: an acknowledgement or a bare thanks is not an assignment, a real instruction is', () => {
    expect(isActionableAssignment('Assignment: m5-m8', 'Answer modules m5 to m8 from the code in corpus/. Write out/<module>/answers.json.')).toBe(true);
    expect(isActionableAssignment('Publish now', 'Publish module-sheets-w2 now with whatever you have.')).toBe(true);
    for (const body of ['ok', 'Ok, will do', 'hello', 'Thanks!', 'Got it, thanks', 'noted', 'Acknowledged.', 'received', 'ack', ''])
      expect(isActionableAssignment('Re: done', body)).toBe(false);
  });
});

const echoQuery = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] },
      };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

async function boot(runConfig: Record<string, unknown>) {
  const root = mkdtempSync(join(TMP, 'lw-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs/alpha.json'),
    JSON.stringify({
      name: 'alpha',
      goal: 'g',
      run_config: { idle_minutes: 0, ...runConfig },
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
        { id: 'idle', title: 'Idle', type: 'specialist', reports_to: 'boss' },
      ],
    }),
  );
  const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
  const running = await d.startOrg('alpha');
  const notices = () => running.busEvents().filter((e) => e.reason === 'lead-watch');
  const waitFor = async (pred: () => boolean, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms && !pred()) await new Promise((r) => setTimeout(r, 25));
    return pred();
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return { d, running, notices, waitFor, sleep };
}

describe('lead watch (daemon, scripted)', () => {
  it('B1: a role deferred by the resource governor (held at its concurrency slot) triggers one lead message; B4: cancelling stops it', async () => {
    resourcesOk = false;
    const t = await boot({ max_concurrent_agents: 1, lead_watch: { not_started_s: 0.3, silent_s: 600 } });
    // coder cannot start (no free slot), its task stays 'ready'
    const id = (JSON.parse(dagCreateTask(t.d, 'alpha', 'boss', 'answer m29', 'coder', [])) as any).id;
    expect(t.running.agents.has('coder')).toBe(false);
    expect(await t.waitFor(() => t.notices().length >= 1)).toBe(true);
    const first = t.notices()[0];
    expect(first.data).toMatchObject({ role: 'coder', kind: 'not-started', taskIds: [id] });
    await t.sleep(250);
    expect(t.notices()).toHaveLength(1); // once, not spamming
    // the lead received the message in its mailbox and acted on it (the echo session answers it)
    expect(t.running.busEvents().some((e) => e.from === 'boss' && /\[watch\] Role "coder"/.test(e.msg ?? ''))).toBe(true);
    // the lead cancels the task: nothing further, however long we wait
    t.d.dagCancelTask('alpha', 'boss', id, 'reassigned to idle');
    await t.sleep(1500);
    expect(t.notices()).toHaveLength(1);
    await t.d.stopAll();
    resourcesOk = true;
  }, 20_000);

  it('B3: a role with no task, or one that starts and keeps emitting, is never reported', async () => {
    resourcesOk = true;
    const t = await boot({ lead_watch: { not_started_s: 0.3, silent_s: 0.3 } });
    await t.d.deliver('alpha', 'boss', 'coder', 'hi', 'hello'); // spawns coder, no open task
    await t.sleep(900);
    expect(t.notices()).toHaveLength(0);
    // an open task on a live role that keeps producing events
    dagCreateTask(t.d, 'alpha', 'boss', 'busy work', 'coder', []);
    for (let i = 0; i < 6; i++) {
      t.running.bus.emit({ type: 'tool', from: 'coder', tool: 'Bash', decision: 'allow', data: { input: { command: 'ls' } } });
      await t.sleep(120);
    }
    expect(t.notices()).toHaveLength(0);
    await t.d.stopAll();
  }, 20_000);

  it('B2: a started role with an open task that then goes silent is reported once; lead_watch:false opts out', async () => {
    resourcesOk = true;
    const t = await boot({ lead_watch: { not_started_s: 60, silent_s: 0.4 } });
    await t.d.deliver('alpha', 'boss', 'coder', 'hi', 'hello');
    dagCreateTask(t.d, 'alpha', 'boss', 'long job', 'coder', []);
    expect(await t.waitFor(() => t.notices().length >= 1)).toBe(true);
    expect(t.notices()[0].data).toMatchObject({ role: 'coder', kind: 'silent' });
    await t.sleep(300);
    expect(t.notices()).toHaveLength(1);
    await t.d.stopAll();

    const off = await boot({ lead_watch: false });
    await off.d.deliver('alpha', 'boss', 'coder', 'hi', 'hello');
    dagCreateTask(off.d, 'alpha', 'boss', 'long job', 'coder', []);
    await off.sleep(800);
    expect(off.notices()).toHaveLength(0);
    await off.d.stopAll();
  }, 20_000);
});

describe('lead watch (daemon, scripted), message-assigned work', () => {
  const assign = (t: any, to = 'coder') =>
    t.d.deliver('alpha', 'boss', to, 'Assignment: m5-m8', 'Answer modules m5 to m8 from the code in corpus/ and publish when done.');

  it('B1m: a role that was messaged an assignment but cannot start triggers one lead message; B4m: the lead acknowledging stops it', async () => {
    resourcesOk = false;
    const t = await boot({ max_concurrent_agents: 1, lead_watch: { not_started_s: 0.3, silent_s: 600 } });
    void assign(t);
    expect(await t.waitFor(() => t.notices().length >= 1)).toBe(true);
    expect(t.notices()[0].data).toMatchObject({ role: 'coder', kind: 'not-started' });
    expect(t.running.busEvents().some((e) => e.from === 'boss' && /\[watch\] Role "coder".*Assignment: m5-m8/.test(e.msg ?? ''))).toBe(true);
    await t.sleep(250);
    expect(t.notices()).toHaveLength(1);
    void t.d.deliver('alpha', 'boss', 'coder', 'Status', 'Please send me a status line when you can.'); // the lead's reaction to the notice
    await t.sleep(1500);
    expect(t.notices()).toHaveLength(1);
    await t.d.stopAll();
    resourcesOk = true;
  }, 20_000);

  it('B2m: a started role that goes silent after its assignment message is reported once; lead_watch:false opts out', async () => {
    resourcesOk = true;
    const t = await boot({ lead_watch: { not_started_s: 60, silent_s: 0.4 } });
    await assign(t);
    expect(await t.waitFor(() => t.notices().length >= 1)).toBe(true);
    expect(t.notices()[0].data).toMatchObject({ role: 'coder', kind: 'silent' });
    await t.sleep(300);
    expect(t.notices()).toHaveLength(1);
    await t.d.stopAll();

    const off = await boot({ lead_watch: false });
    await assign(off);
    await off.sleep(800);
    expect(off.notices()).toHaveLength(0);
    await off.d.stopAll();
  }, 20_000);

  it('B3m: a role that keeps emitting, one that reported back to its lead, and the lead itself are never reported', async () => {
    resourcesOk = true;
    const t = await boot({ lead_watch: { not_started_s: 0.3, silent_s: 0.3 } });
    await assign(t, 'coder');
    for (let i = 0; i < 6; i++) {
      t.running.bus.emit({ type: 'tool', from: 'coder', tool: 'Bash', decision: 'allow', data: { input: { command: 'ls' } } });
      await t.sleep(120);
    }
    expect(t.notices()).toHaveLength(0);
    await assign(t, 'idle');
    await t.d.deliver('alpha', 'idle', 'boss', 'Done', 'Finished modules m5 to m8, published.'); // its reply
    await t.sleep(1200);
    expect(t.notices().filter((e) => e.data?.role === 'idle')).toHaveLength(0);
    await t.d.deliver('alpha', 'idle', 'boss', 'Hello', 'A message to the lead is not an assignment for the lead.');
    await t.sleep(1000);
    expect(t.notices().filter((e) => e.data?.role === 'boss')).toHaveLength(0);
    await t.d.stopAll();
  }, 25_000);
});
