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
