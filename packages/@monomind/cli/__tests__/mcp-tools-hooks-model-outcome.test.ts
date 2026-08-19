/**
 * IN-8/10 regression: `hooks model-outcome` used to be a placebo (it
 * returned `{ recorded: true }` without persisting anything) and
 * `hooks model-stats` was a stub that always reported `available: false`.
 *
 * This test proves model-outcome appends a real record to
 * `.monomind/neural/model-outcomes.jsonl`, and that model-stats reads it
 * back and computes real aggregates — closing the loop between writer and
 * reader.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hooksModelOutcome, hooksModelStats } from '../src/mcp-tools/hooks-intelligence.js';

describe('hooks_model-outcome / hooks_model-stats', () => {
  let projectDir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mm-model-outcome-'));
    prevCwd = process.env.MONOMIND_CWD;
    process.env.MONOMIND_CWD = projectDir;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = prevCwd;
  });

  it('reports unavailable before any outcome has been recorded', async () => {
    const stats = (await hooksModelStats.handler({})) as Record<string, unknown>;
    expect(stats.available).toBe(false);
  });

  it('appends a real record to model-outcomes.jsonl', async () => {
    const result = (await hooksModelOutcome.handler({
      task: 'implement auth flow',
      model: 'sonnet',
      outcome: 'success',
    })) as Record<string, unknown>;

    expect(result.recorded).toBe(true);

    const ledgerPath = join(projectDir, '.monomind', 'neural', 'model-outcomes.jsonl');
    expect(existsSync(ledgerPath)).toBe(true);
    const lines = readFileSync(ledgerPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.model).toBe('sonnet');
    expect(rec.outcome).toBe('success');
    expect(rec.task).toBe('implement auth flow');
  });

  it('model-stats reads back multiple recorded outcomes and computes real aggregates', async () => {
    await hooksModelOutcome.handler({ task: 't1', model: 'haiku', outcome: 'success' });
    await hooksModelOutcome.handler({ task: 't2', model: 'haiku', outcome: 'success' });
    await hooksModelOutcome.handler({ task: 't3', model: 'haiku', outcome: 'failure' });
    await hooksModelOutcome.handler({ task: 't4', model: 'opus', outcome: 'success' });

    const stats = (await hooksModelStats.handler({})) as Record<string, unknown>;

    expect(stats.available).toBe(true);
    expect(stats.totalDecisions).toBe(4);
    expect(stats.modelDistribution).toEqual({ haiku: 3, opus: 1 });
    expect(stats.successRate).toBeCloseTo(3 / 4);
    expect((stats.byModel as Record<string, { count: number; successRate: number | null }>).haiku).toEqual({
      count: 3,
      successRate: 2 / 3,
    });
  });

  it('derives outcome from a verifier exit_code when provided, overriding the raw outcome field', async () => {
    await hooksModelOutcome.handler({
      task: 'run typecheck',
      model: 'sonnet',
      outcome: 'success', // would be success, but exit_code says otherwise
      verifier_type: 'tsc',
      exit_code: 1,
    });

    const stats = (await hooksModelStats.handler({})) as Record<string, unknown>;
    expect(stats.successRate).toBe(0);
  });
});
