import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordModelOutcome,
  readModelOutcomes,
  computeModelStats,
  type ModelOutcomeRecord,
} from '../../src/monovector/model-outcomes.js';

function rec(over: Partial<ModelOutcomeRecord>): ModelOutcomeRecord {
  return {
    ts: Date.now(),
    task: 'fix typo',
    model: 'haiku',
    outcome: 'success',
    ...over,
  };
}

describe('model-outcomes ledger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'model-outcomes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends a real record to model-outcomes.jsonl', async () => {
    await recordModelOutcome(dir, rec({ task: 'implement auth', model: 'opus', outcome: 'success' }));

    const raw = readFileSync(join(dir, 'model-outcomes.jsonl'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.task).toBe('implement auth');
    expect(parsed.model).toBe('opus');
    expect(parsed.outcome).toBe('success');
  });

  it('reads back multiple appended records', async () => {
    await recordModelOutcome(dir, rec({ model: 'haiku', outcome: 'success' }));
    await recordModelOutcome(dir, rec({ model: 'sonnet', outcome: 'failure' }));
    await recordModelOutcome(dir, rec({ model: 'opus', outcome: 'escalated' }));

    const all = await readModelOutcomes(dir);
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.model)).toEqual(['haiku', 'sonnet', 'opus']);
  });

  it('computeModelStats aggregates counts and success rates across models', async () => {
    await recordModelOutcome(dir, rec({ model: 'haiku', outcome: 'success', quality: 0.9 }));
    await recordModelOutcome(dir, rec({ model: 'haiku', outcome: 'success', quality: 0.8 }));
    await recordModelOutcome(dir, rec({ model: 'haiku', outcome: 'failure' }));
    await recordModelOutcome(dir, rec({ model: 'opus', outcome: 'success', quality: 1.0 }));

    const stats = await computeModelStats(dir);

    expect(stats.totalDecisions).toBe(4);
    expect(stats.modelDistribution).toEqual({ haiku: 3, opus: 1 });
    expect(stats.successRate).toBeCloseTo(3 / 4);
    expect(stats.byModel.haiku).toEqual({ count: 3, successRate: 2 / 3 });
    expect(stats.byModel.opus).toEqual({ count: 1, successRate: 1 });
    // avg of 0.9, 0.8, 1.0
    expect(stats.avgQuality).toBeCloseTo((0.9 + 0.8 + 1.0) / 3);
  });

  it('computeModelStats reports empty aggregates with no records', async () => {
    const stats = await computeModelStats(dir);
    expect(stats.totalDecisions).toBe(0);
    expect(stats.modelDistribution).toEqual({});
    expect(stats.successRate).toBeNull();
    expect(stats.avgQuality).toBeNull();
  });
});
