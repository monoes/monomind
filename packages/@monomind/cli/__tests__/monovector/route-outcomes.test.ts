import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordRoute,
  joinOutcome,
  computeRoutingAccuracy,
  type RouteOutcomeRecord,
} from '../../src/monovector/route-outcomes.js';

function rec(over: Partial<RouteOutcomeRecord>): RouteOutcomeRecord {
  return {
    routeId: Math.random().toString(36).slice(2),
    ts: Date.now(),
    task: 'do a thing',
    recommendedAgent: 'coder',
    routingMethod: 'keyword',
    confidence: 0.5,
    learningMode: 'js',
    ...over,
  };
}

describe('computeRoutingAccuracy', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'route-acc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null accuracy with no outcome data', async () => {
    const acc = await computeRoutingAccuracy(dir, 100);
    expect(acc.accuracy).toBeNull();
    expect(acc.totalWithOutcome).toBe(0);
    expect(acc.byMode).toEqual({ native: null, js: null });
    expect(acc.recentVsPrior).toBeNull();
  });

  it('ignores records that have no measured outcome', async () => {
    await recordRoute(dir, rec({ routeId: 'r1' }));
    // r1 never joined → no measuredSuccess → not counted
    const acc = await computeRoutingAccuracy(dir, 100);
    expect(acc.totalWithOutcome).toBe(0);
    expect(acc.accuracy).toBeNull();
  });

  it('computes overall accuracy from joined outcomes', async () => {
    for (let i = 0; i < 4; i++) {
      const id = `r${i}`;
      await recordRoute(dir, rec({ routeId: id }));
      await joinOutcome(dir, id, { measuredSuccess: i < 3 }); // 3/4 succeed
    }
    const acc = await computeRoutingAccuracy(dir, 100);
    expect(acc.totalWithOutcome).toBe(4);
    expect(acc.accuracy).toBeCloseTo(0.75, 5);
  });

  it('splits accuracy by learning mode', async () => {
    // native: 2/2 succeed, js: 0/2 succeed
    await recordRoute(dir, rec({ routeId: 'n1', learningMode: 'native' }));
    await joinOutcome(dir, 'n1', { measuredSuccess: true });
    await recordRoute(dir, rec({ routeId: 'n2', learningMode: 'native' }));
    await joinOutcome(dir, 'n2', { measuredSuccess: true });
    await recordRoute(dir, rec({ routeId: 'j1', learningMode: 'js' }));
    await joinOutcome(dir, 'j1', { measuredSuccess: false });
    await recordRoute(dir, rec({ routeId: 'j2', learningMode: 'js' }));
    await joinOutcome(dir, 'j2', { measuredSuccess: false });

    const acc = await computeRoutingAccuracy(dir, 100);
    expect(acc.byMode.native).toBeCloseTo(1, 5);
    expect(acc.byMode.js).toBeCloseTo(0, 5);
  });

  it('reports a positive trend when recent half outperforms prior half', async () => {
    // prior half (first 4): all fail; recent half (last 4): all succeed
    for (let i = 0; i < 8; i++) {
      const id = `t${i}`;
      await recordRoute(dir, rec({ routeId: id }));
      await joinOutcome(dir, id, { measuredSuccess: i >= 4 });
    }
    const acc = await computeRoutingAccuracy(dir, 100);
    expect(acc.recentVsPrior).toBeCloseTo(1, 5); // 1.0 (recent) - 0.0 (prior)
  });

  it('respects the window by keeping only the most recent N with outcomes', async () => {
    for (let i = 0; i < 10; i++) {
      const id = `w${i}`;
      await recordRoute(dir, rec({ routeId: id }));
      // first 5 fail, last 5 succeed
      await joinOutcome(dir, id, { measuredSuccess: i >= 5 });
    }
    // window of 5 → only the last 5 (all success)
    const acc = await computeRoutingAccuracy(dir, 5);
    expect(acc.window).toBe(5);
    expect(acc.totalWithOutcome).toBe(5);
    expect(acc.accuracy).toBeCloseTo(1, 5);
  });
});
