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
});
