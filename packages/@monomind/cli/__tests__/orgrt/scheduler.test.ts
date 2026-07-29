// packages/@monomind/cli/__tests__/orgrt/scheduler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { parseSchedule, OrgScheduler } from '../../src/orgrt/scheduler.js';

describe('parseSchedule', () => {
  it('parses "15m", "2h", numbers (minutes), null', () => {
    expect(parseSchedule('15m')).toBe(15 * 60_000);
    expect(parseSchedule('2h')).toBe(2 * 3_600_000);
    expect(parseSchedule(30)).toBe(30 * 60_000);
    expect(parseSchedule(null)).toBeNull();
  });
});

describe('OrgScheduler', () => {
  it('re-runs the org on its interval', async () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const s = new OrgScheduler(async name => { runs.push(name); });
    s.add('alpha', 60_000);
    await vi.advanceTimersByTimeAsync(60_000 * 2 + 10);
    expect(runs).toEqual(['alpha', 'alpha']);
    s.stop();
    vi.useRealTimers();
  });

  it('passes the interval to runFn so runs can be time-bounded', async () => {
    vi.useFakeTimers();
    const intervals: number[] = [];
    const s = new OrgScheduler(async (_name, intervalMs) => { intervals.push(intervalMs); });
    s.add('alpha', 60_000);
    await vi.advanceTimersByTimeAsync(60_000 + 10);
    expect(intervals).toEqual([60_000]);
    s.stop();
    vi.useRealTimers();
  });

  it('bounded run: a hung iteration completes via timeout and the next tick still fires', async () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    // Mimics serveAction's runFn: agents' done promises never resolve (the
    // deadlock scenario) but the run is raced against a max-run timeout.
    const neverDone = new Promise<never>(() => { /* agents never finish on their own */ });
    const s = new OrgScheduler(async (name, intervalMs) => {
      const maxMs = Math.min(intervalMs / 2, 600_000); // bound shorter than the interval
      await Promise.race([neverDone, new Promise<void>(r => setTimeout(r, maxMs))]);
      completed.push(name);
    });
    s.add('alpha', 60_000);
    // tick at 60s → bounded run finishes at 90s; tick at 120s → finishes at 150s
    await vi.advanceTimersByTimeAsync(60_000 * 2 + 30_000 + 10);
    expect(completed).toEqual(['alpha', 'alpha']);
    s.stop();
    vi.useRealTimers();
  });

  it('a run that overruns its interval starts the next one as soon as it ends', async () => {
    vi.useFakeTimers();
    const started: number[] = [];
    const ended: number[] = [];
    // 150s of work on a 60s interval: ticks at 60s and 120s both land mid-run.
    const s = new OrgScheduler(async () => {
      started.push(Date.now());
      await new Promise<void>(r => setTimeout(r, 150_000));
      ended.push(Date.now());
    });
    const t0 = Date.now();
    s.add('alpha', 60_000, true); // run #1 at t0, ends t0+150s

    await vi.advanceTimersByTimeAsync(150_000 + 50);
    // Both missed ticks coalesce into ONE catch-up, fired immediately on end —
    // not queued as two, and not deferred to the next 60s boundary (t0+180s).
    expect(started.length).toBe(2);
    expect(started[1] - t0).toBeLessThan(150_000 + 1_000);
    expect(ended.length).toBe(1);

    s.stop();
    vi.useRealTimers();
  });

  it('does not resurrect an org that was removed while its run was in flight', async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const s = new OrgScheduler(async name => {
      started.push(name);
      await new Promise<void>(r => setTimeout(r, 150_000));
    });
    s.add('alpha', 60_000, true);
    await vi.advanceTimersByTimeAsync(120_000); // ticks missed → pending set
    s.remove('alpha');                          // unscheduled mid-run
    await vi.advanceTimersByTimeAsync(120_000); // run ends; must NOT catch up
    expect(started).toEqual(['alpha']);
    s.stop();
    vi.useRealTimers();
  });

  it('resumes the remainder of the interval after a restart instead of resetting it', async () => {
    vi.useFakeTimers();
    const runs: number[] = [];
    const s = new OrgScheduler(async () => { runs.push(Date.now()); });
    const t0 = Date.now();
    // Restarted 40s into a 60s period: owed 20s, not a fresh 60s.
    s.add('alpha', 60_000, false, 40_000);

    await vi.advanceTimersByTimeAsync(19_000);
    expect(runs).toEqual([]);          // not yet
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runs.length).toBe(1);
    expect(runs[0] - t0).toBeLessThan(60_000); // would have been 60_000 before

    // and then settles into the steady cadence
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs.length).toBe(2);
    s.stop();
    vi.useRealTimers();
  });

  it('logs runFn errors instead of swallowing them silently', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = new OrgScheduler(async () => { throw new Error('boom'); });
    s.add('alpha', 60_000);
    await vi.advanceTimersByTimeAsync(60_000 + 10);
    expect(spy).toHaveBeenCalled();
    s.stop();
    spy.mockRestore();
    vi.useRealTimers();
  });
});
