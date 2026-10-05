// packages/@monomind/cli/__tests__/orgrt/documents/scheduled-sections.test.ts
// A sections org may run on a schedule. No carry-forward is needed: every scheduled start is a fresh run
// with its own run id and its own document store (docs/<run>/), and it goes through startOrg like a manual
// start, so the host preflight, the eval gate and the daemon lock apply unchanged. Real OrgDaemon, stub
// queryFn (no model), the real OrgScheduler and the scheduled-iteration body `org serve` runs per tick.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { setHostProbes } from '../../../src/orgrt/documents/preflight.js';
import { OrgScheduler } from '../../../src/orgrt/scheduler.js';
import { auditScheduledTick, runScheduledIteration } from '../../../src/orgrt/scheduled-run.js';
import { sectionsRaw } from '../support/sections-defs.js';
import { FINDINGS, SOURCE } from '../support/doc-defs.js';

const OK = { available: true };
const NO = (why: string) => ({ available: false, reason: why });
const NAME = 'sec-org';
const protectedHost = () => setHostProbes({ mask: OK, sandbox: OK });

/** A general-availability sections org on a schedule; `max_run` bounds each iteration. */
const scheduled = (patch: (r: Record<string, any>) => void = () => {}) =>
  sectionsRaw((r) => {
    delete r.run_config.experimental;
    r.schedule = '1h';
    r.run_config.max_run = '1s';
    patch(r);
  });

const queryFn = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

let root: string;
const daemons: OrgDaemon[] = [];
const schedulers: OrgScheduler[] = [];
const mk = (raw: Record<string, any>, opts: Record<string, unknown> = {}): OrgDaemon => {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const d = new OrgDaemon(root, {
    queryFn: queryFn as any,
    forward: false,
    stopWaitMs: 100,
    bossRestartBackoffMs: [600_000],
    ...opts,
  });
  daemons.push(d);
  return d;
};
const docsDirs = (): string[] => {
  const dir = join(root, '.monomind/orgs', NAME, 'docs');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const audit = (): Array<Record<string, any>> => {
  const f = join(root, '.monomind/orgs', NAME, 'schedule-audit.jsonl');
  return existsSync(f)
    ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
};
const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  for (let i = 0; i < ms / 10 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error('condition not reached');
};

beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sched-sections-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  protectedHost();
});
afterEach(async () => {
  setHostProbes(undefined);
  for (const s of schedulers.splice(0)) s.stop();
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a scheduled start of a sections org', () => {
  it('on a protected host runs with a fresh run id and an empty document store, then stops and frees the lock', async () => {
    const d = mk(scheduled());
    const iteration = runScheduledIteration(d, NAME, 3_600_000);
    await until(() => d.getOrg(NAME) !== undefined);
    const running = d.getOrg(NAME)!;
    expect(running.documents?.dir).toBe(join(root, '.monomind/orgs', NAME, 'docs', running.run));
    expect(running.documents?.store.list()).toEqual([]);
    expect(d.daemonLocks.size).toBe(1);
    await iteration;
    expect(d.getOrg(NAME)).toBeUndefined();
    expect(d.daemonLocks.size).toBe(0);
  });

  it('on an unprotected host is refused by the preflight and audited: nothing starts, no lock is left', async () => {
    setHostProbes({ mask: NO('no bwrap'), sandbox: OK });
    const d = mk(scheduled());
    await runScheduledIteration(d, NAME, 3_600_000); // a refused tick must not throw out of the scheduler
    expect(d.getOrg(NAME)).toBeUndefined();
    expect(d.startingOrgs.has(NAME)).toBe(false);
    expect(d.daemonLocks.size).toBe(0);
    expect(docsDirs()).toEqual([]);
    const refused = audit().filter((e) => e.event === 'scheduled-start-refused');
    expect(refused).toHaveLength(1);
    expect(refused[0].msg).toMatch(/authority mask.*no bwrap/);
    // the refusal left no stale lock behind: the same org starts once the host is protected
    protectedHost();
    await runScheduledIteration(d, NAME, 3_600_000);
    expect(docsDirs()).toHaveLength(1);
    expect(d.daemonLocks.size).toBe(0);
  });

  it('an eval-mode org is refused by the eval gate on a tick, and audited', async () => {
    const d = mk(scheduled((r) => (r.run_config.experimental = 'eval')));
    await runScheduledIteration(d, NAME, 3_600_000);
    expect(d.getOrg(NAME)).toBeUndefined();
    expect(d.daemonLocks.size).toBe(0);
    expect(audit().filter((e) => e.event === 'scheduled-start-refused')[0]?.msg).toMatch(/eval harness/);
  });

  it('two consecutive scheduled runs do not see each other\'s documents', async () => {
    const d = mk(scheduled());
    const first = runScheduledIteration(d, NAME, 3_600_000);
    await until(() => d.getOrg(NAME) !== undefined);
    const run1 = d.getOrg(NAME)!;
    const receipt = await run1.documents!.forRole('researcher').publish({ type: 'findings', body: FINDINGS, evidence: SOURCE });
    expect(receipt).toMatchObject({ ok: true });
    expect(run1.documents!.store.list()).toHaveLength(1);
    await first;

    const second = runScheduledIteration(d, NAME, 3_600_000);
    await until(() => d.getOrg(NAME) !== undefined);
    const run2 = d.getOrg(NAME)!;
    expect(run2.run).not.toBe(run1.run);
    expect(run2.documents!.dir).not.toBe(run1.documents!.dir);
    expect(run2.documents!.store.list()).toEqual([]);
    await second;
    expect(docsDirs()).toEqual([run1.run, run2.run].sort());
  });

  it('a tick while an out-of-band run is live is skipped and audited: no second run, no second lock, the run is not stopped', async () => {
    const d = mk(scheduled());
    const running = await d.startOrg(NAME);
    const start = vi.spyOn(d, 'startOrg');
    await runScheduledIteration(d, NAME, 3_600_000);
    expect(start).not.toHaveBeenCalled();
    expect(d.getOrg(NAME)).toBe(running);
    expect(d.daemonLocks.size).toBe(1);
    expect(docsDirs()).toEqual([running.run]);
    expect(audit().map((e) => e.event)).toContain('scheduled-tick-skipped');
    expect(running.busEvents().some((e) => e.reason === 'scheduled-tick-skipped')).toBe(true);
  });
});

describe('the scheduler around a sections org', () => {
  const tickRunner = (d: OrgDaemon, intervalMs: number) => {
    const s = new OrgScheduler(
      (name, ms) => runScheduledIteration(d, name, ms),
      (name) => auditScheduledTick(d, name, 'scheduled-tick-deferred', 'a tick landed mid-run'),
    );
    schedulers.push(s);
    return { s, intervalMs };
  };

  it('a daemon that was down at the due time starts the org once on its next tick, not once per missed interval', async () => {
    const d = mk(scheduled());
    const start = vi.spyOn(d, 'startOrg');
    const { s } = tickRunner(d, 3000);
    // last run ended five intervals ago: due now, exactly as org serve registers it
    s.add(NAME, 3000, true, 5 * 3000 + 1);
    await until(() => start.mock.calls.length >= 1);
    await new Promise((r) => setTimeout(r, 1800)); // the 1s run is over; no catch-up of the missed intervals
    s.stop();
    expect(start).toHaveBeenCalledTimes(1);
    expect(docsDirs()).toHaveLength(1);
  });

  it('a tick landing mid-run starts no second run, no second lock and no second store, and is audited', async () => {
    const d = mk(scheduled((r) => (r.run_config.max_run = '2s')));
    const start = vi.spyOn(d, 'startOrg');
    const { s } = tickRunner(d, 300);
    s.add(NAME, 300, true);
    await until(() => audit().filter((e) => e.event === 'scheduled-tick-deferred').length >= 2);
    expect(d.getOrg(NAME)).toBeDefined();
    expect(start).toHaveBeenCalledTimes(1);
    expect(d.daemonLocks.size).toBe(1);
    expect(docsDirs()).toHaveLength(1);
    s.stop(); // the deferred ticks are dropped with it; the run in flight ends at its own deadline
    await until(() => d.getOrg(NAME) === undefined, 6000);
    expect(start).toHaveBeenCalledTimes(1);
    await until(() => d.daemonLocks.size === 0); // the lock is released once the stop has flushed
  });
});

describe('a boss crash during a scheduled run', () => {
  it('the restarted run is still bounded by the tick: the iteration follows it to its deadline', async () => {
    const d = mk(scheduled((r) => (r.run_config.max_run = '3s')), { bossRestartBackoffMs: [100] });
    const iteration = runScheduledIteration(d, NAME, 3_600_000);
    await until(() => d.getOrg(NAME) !== undefined);
    const first = d.getOrg(NAME)!;
    d.scheduleBossRestart(NAME);
    await until(() => d.getOrg(NAME) !== undefined && d.getOrg(NAME) !== first);
    await until(() => !d.restarting.has(NAME));
    const second = d.getOrg(NAME)!;
    expect(second.run).not.toBe(first.run);
    // the old tick must still be waiting on the restarted run, not have stopped (or abandoned) it
    let settled = false;
    void iteration.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    expect(d.getOrg(NAME)).toBe(second);
    await iteration;
    expect(d.getOrg(NAME)).toBeUndefined();
    expect(d.daemonLocks.size).toBe(0);
  });
});
