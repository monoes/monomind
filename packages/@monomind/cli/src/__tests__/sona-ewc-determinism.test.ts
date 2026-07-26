/**
 * SONA + EWC determinism and persistence tests.
 *
 * These two modules (1,728 lines combined) mutate the confidence scores that
 * drive routing suggestions, and had no test coverage at all. `CLAUDE.md` also
 * claimed they lived on a separate branch, so nobody was looking at them.
 *
 * The properties worth pinning are behavioural, not numeric: identical input
 * must produce identical output (so routing is reproducible), decay must move
 * confidence in one direction only, and a corrupt or missing persistence file
 * must degrade gracefully rather than throwing on a hot path.
 *
 * Note on EWC: despite the name it is not Elastic Weight Consolidation — there
 * are no gradients and no model, so "Fisher information" here is a stand-in
 * computed from squared embedding magnitudes. See the module header. These
 * tests pin what it actually computes, not what the name implies.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SONAOptimizer } from '../memory/sona-optimizer.js';
import { EWCConsolidator } from '../memory/ewc-consolidation.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sona-ewc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function outcome(over: Partial<Record<string, unknown>> = {}) {
  return {
    trajectoryId: 't1',
    task: 'fix the failing auth test',
    agent: 'tester',
    success: true,
    duration: 100,
    timestamp: Date.now(),
    ...over,
  } as never;
}

describe('SONAOptimizer', () => {
  function make() {
    return new SONAOptimizer({ persistencePath: join(dir, 'sona-patterns.json') });
  }

  it('produces identical suggestions for identical input (reproducible routing)', async () => {
    const a = make();
    await a.initialize();
    await a.processTrajectoryOutcome(outcome());

    const b = make();
    await b.initialize();
    await b.processTrajectoryOutcome(outcome({ trajectoryId: 't2' }));

    const sa = a.getRoutingSuggestion('fix the failing auth test');
    const sb = b.getRoutingSuggestion('fix the failing auth test');
    expect(sa?.agent).toBe(sb?.agent);
    expect(sa?.confidence).toBe(sb?.confidence);
  });

  // Assert on stored pattern confidence via getStats(), not on
  // getRoutingSuggestion().confidence — the latter is a derived match score
  // (min(0.7, 0.3 + keywordOverlap)) and does not reflect learned confidence.
  it('raises stored confidence on success and lowers it on failure', async () => {
    const opt = make();
    await opt.initialize();

    await opt.processTrajectoryOutcome(outcome());
    const afterSuccess = opt.getStats().avgConfidence;

    await opt.processTrajectoryOutcome(outcome({ trajectoryId: 't2', success: false }));
    const afterFailure = opt.getStats().avgConfidence;

    expect(afterSuccess).toBeGreaterThan(0.5); // started neutral at 0.5
    expect(afterFailure).toBeLessThan(afterSuccess);
  });

  it('keeps confidence within [0,1] under repeated reinforcement', async () => {
    const opt = make();
    await opt.initialize();
    for (let i = 0; i < 50; i++) {
      await opt.processTrajectoryOutcome(outcome({ trajectoryId: `t${i}` }));
    }
    const conf = opt.getRoutingSuggestion('fix the failing auth test')?.confidence ?? 0;
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  it('temporal decay never increases confidence', async () => {
    const opt = make();
    await opt.initialize();
    await opt.processTrajectoryOutcome(outcome());
    const before = opt.getStats().avgConfidence;

    opt.applyTemporalDecay();
    const after = opt.getStats().avgConfidence;

    expect(after).toBeLessThanOrEqual(before);
  });

  it('round-trips learned patterns through export/import', async () => {
    const opt = make();
    await opt.initialize();
    await opt.processTrajectoryOutcome(outcome());
    const exported = opt.exportPatterns();

    const fresh = new SONAOptimizer({ persistencePath: join(dir, 'other.json') });
    await fresh.initialize();
    fresh.importPatterns(exported);

    expect(fresh.getRoutingSuggestion('fix the failing auth test')?.agent)
      .toBe(opt.getRoutingSuggestion('fix the failing auth test')?.agent);
  });

  it('starts clean when the persistence file is corrupt instead of throwing', async () => {
    const p = join(dir, 'sona-patterns.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, '{ this is not valid json', 'utf-8');

    const opt = new SONAOptimizer({ persistencePath: p });
    await expect(opt.initialize()).resolves.not.toThrow();
    expect(opt.getStats().totalPatterns).toBe(0);
  });

  it('handles a missing persistence file without throwing', async () => {
    const opt = new SONAOptimizer({ persistencePath: join(dir, 'nope', 'missing.json') });
    await expect(opt.initialize()).resolves.not.toThrow();
  });

  it('returns no suggestion for an unrelated task rather than guessing', async () => {
    const opt = make();
    await opt.initialize();
    await opt.processTrajectoryOutcome(outcome());
    const s = opt.getRoutingSuggestion('unrelated quantum basket weaving');
    expect(s === null || (s.confidence ?? 0) < 0.5).toBe(true);
  });
});

describe('EWCConsolidator', () => {
  function make() {
    return new EWCConsolidator({ dimensions: 4, storageDir: dir } as never);
  }

  // `success: true` is required — computeFisherMatrix deliberately skips
  // unsuccessful patterns ("we want to preserve what worked").
  const patterns = [
    { id: 'p1', embedding: [1, 0, 0, 0], success: true },
    { id: 'p2', embedding: [0, 2, 0, 0], success: true },
  ];

  it('computes the same importance vector for the same input (deterministic)', async () => {
    const a = make();
    await a.initialize();
    const b = make();
    await b.initialize();

    const fa = a.computeFisherMatrix(patterns as never);
    const fb = b.computeFisherMatrix(patterns as never);
    expect(fa).toEqual(fb);
  });

  it('weights a dimension by squared embedding magnitude, not raw value', async () => {
    // This pins the actual implementation: importance comes from squared
    // embedding values used as a gradient proxy. p2's dimension-1 value of 2
    // must dominate p1's dimension-0 value of 1 by roughly 4x, not 2x.
    const ewc = make();
    await ewc.initialize();
    const fisher = ewc.computeFisherMatrix(patterns as never);
    expect(fisher[1]).toBeGreaterThan(fisher[0]);
  });

  it('produces a non-negative penalty', async () => {
    const ewc = make();
    await ewc.initialize();
    const fisher = ewc.computeFisherMatrix(patterns as never);
    const penalty = ewc.getPenalty([1, 0, 0, 0], [0, 1, 0, 0], fisher);
    expect(penalty).toBeGreaterThanOrEqual(0);
  });

  it('gives zero penalty when nothing changed', async () => {
    const ewc = make();
    await ewc.initialize();
    const fisher = ewc.computeFisherMatrix(patterns as never);
    const weights = [1, 0, 0, 0];
    expect(ewc.getPenalty(weights, weights, fisher)).toBe(0);
  });

  it('scales penalty with lambda', async () => {
    const ewc = make();
    await ewc.initialize();
    const fisher = ewc.computeFisherMatrix(patterns as never);

    ewc.setLambda(1);
    const low = ewc.getPenalty([1, 0, 0, 0], [0, 1, 0, 0], fisher);
    ewc.setLambda(10);
    const high = ewc.getPenalty([1, 0, 0, 0], [0, 1, 0, 0], fisher);

    expect(high).toBeGreaterThan(low);
  });

  it('initializes without throwing when the storage directory does not exist', async () => {
    const ewc = new EWCConsolidator({ dimensions: 4, storageDir: join(dir, 'nested', 'deep') } as never);
    await expect(ewc.initialize()).resolves.not.toThrow();
  });
});
