// packages/@monomind/cli/__tests__/orgrt/lead-watch.test.ts
// Scripted (no model). The lead is told once when a role holding an open task
// never started or went silent; never for a role without an open task or one
// that is making progress; and not again once the lead reassigns.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const { LeadWatch, MAX_NOTICES, leadWatchConfig } = await import('../../src/orgrt/lead-watch.js');
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
