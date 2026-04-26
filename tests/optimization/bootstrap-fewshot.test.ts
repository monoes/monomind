/**
 * Tests for BootstrapFewShot, QualityMetrics, and TraceQualityStore
 *
 * Uses vitest with --globals (describe/it/expect are global).
 */

import { describe, it, expect, vi } from 'vitest';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BootstrapFewShot } from '../../packages/@monomind/hooks/src/optimization/bootstrap-fewshot.js';
import { LLMJudgeMetric } from '../../packages/@monomind/hooks/src/optimization/quality-metric.js';
import { TraceQualityStore } from '../../packages/@monomind/hooks/src/optimization/trace-quality-store.js';
import type { TraceRecord, FewShotExample } from '../../packages/@monomind/hooks/src/optimization/bootstrap-fewshot.js';

function makeTrace(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    traceId: overrides.traceId ?? 'trace-1',
    agentSlug: overrides.agentSlug ?? 'test-agent',
    input: overrides.input ?? 'What is 2+2?',
    output: overrides.output ?? 'The answer is 4.',
    qualityScore: overrides.qualityScore ?? 0.9,
    createdAt: overrides.createdAt ?? new Date('2026-04-01'),
  };
}

// ===== BootstrapFewShot: selectExamples =====

describe('BootstrapFewShot.selectExamples', () => {
  it('selects top-K by quality', async () => {
    const fewShot = new BootstrapFewShot({ maxExamples: 2 });
    const traces: TraceRecord[] = [
      makeTrace({ traceId: 'a', qualityScore: 0.95, input: 'q1' }),
      makeTrace({ traceId: 'b', qualityScore: 0.85, input: 'q2' }),
      makeTrace({ traceId: 'c', qualityScore: 0.90, input: 'q3' }),
    ];

    const result = await fewShot.selectExamples(traces);

    expect(result).toHaveLength(2);
    expect(result[0].qualityScore).toBe(0.95);
    expect(result[1].qualityScore).toBe(0.90);
  });

  it('filters below min threshold', async () => {
    const fewShot = new BootstrapFewShot({ minQualityScore: 0.90 });
    const traces: TraceRecord[] = [
      makeTrace({ traceId: 'a', qualityScore: 0.95, input: 'q1' }),
      makeTrace({ traceId: 'b', qualityScore: 0.70, input: 'q2' }),
      makeTrace({ traceId: 'c', qualityScore: 0.85, input: 'q3' }),
    ];

    const result = await fewShot.selectExamples(traces);

    expect(result).toHaveLength(1);
    expect(result[0].qualityScore).toBe(0.95);
  });

  it('deduplicates identical inputs', async () => {
    const fewShot = new BootstrapFewShot({ deduplicateInputs: true });
    const traces: TraceRecord[] = [
      makeTrace({ traceId: 'a', qualityScore: 0.95, input: 'same question' }),
      makeTrace({ traceId: 'b', qualityScore: 0.90, input: 'same question' }),
      makeTrace({ traceId: 'c', qualityScore: 0.85, input: 'different question' }),
    ];

    const result = await fewShot.selectExamples(traces);

    expect(result).toHaveLength(2);
    // First occurrence kept (0.95), duplicate removed
    const inputs = result.map((r) => r.input);
    expect(inputs).toContain('same question');
    expect(inputs).toContain('different question');
  });

  it('returns empty for empty input', async () => {
    const fewShot = new BootstrapFewShot();
    const result = await fewShot.selectExamples([]);
    expect(result).toHaveLength(0);
  });
});

// ===== BootstrapFewShot: formatFewShotBlock =====

describe('BootstrapFewShot.formatFewShotBlock', () => {
  it('returns empty string for empty examples', () => {
    const fewShot = new BootstrapFewShot();
    expect(fewShot.formatFewShotBlock([])).toBe('');
  });

  it('includes numbered examples', () => {
    const fewShot = new BootstrapFewShot();
    const examples: FewShotExample[] = [
      { input: 'q1', output: 'a1', qualityScore: 0.95 },
      { input: 'q2', output: 'a2', qualityScore: 0.88 },
    ];

    const block = fewShot.formatFewShotBlock(examples);

    expect(block).toContain('## Few-Shot Examples');
    expect(block).toContain('### Example 1 (quality: 0.95)');
    expect(block).toContain('### Example 2 (quality: 0.88)');
    expect(block).toContain('q1');
    expect(block).toContain('a1');
    expect(block).toContain('q2');
    expect(block).toContain('a2');
  });
});

// ===== BootstrapFewShot: composePrompt =====

describe('BootstrapFewShot.composePrompt', () => {
  it('prepends few-shot before instructions', () => {
    const fewShot = new BootstrapFewShot();
    const examples: FewShotExample[] = [
      { input: 'q1', output: 'a1', qualityScore: 0.95 },
    ];

    const result = fewShot.composePrompt('You are a helpful agent.', examples);

    expect(result).toContain('## Few-Shot Examples');
    expect(result).toContain('---');
    expect(result).toContain('You are a helpful agent.');
    // Few-shot block comes before agent instructions
    const fewShotIdx = result.indexOf('## Few-Shot Examples');
    const agentIdx = result.indexOf('You are a helpful agent.');
    expect(fewShotIdx).toBeLessThan(agentIdx);
  });

  it('returns agent prompt as-is when no examples', () => {
    const fewShot = new BootstrapFewShot();
    const result = fewShot.composePrompt('You are a helpful agent.', []);
    expect(result).toBe('You are a helpful agent.');
  });
});

// ===== LLMJudgeMetric =====

describe('LLMJudgeMetric', () => {
  it('returns 0.0 for invalid JSON response', async () => {
    const mockHaiku = vi.fn().mockResolvedValue('not json at all');
    const metric = new LLMJudgeMetric(mockHaiku);

    const score = await metric.score('input', 'output');
    expect(score).toBe(0.0);
  });

  it('clamps score to [0, 1]', async () => {
    const mockHaiku = vi.fn().mockResolvedValue('{"score": 5.0, "reason": "great"}');
    const metric = new LLMJudgeMetric(mockHaiku);

    const score = await metric.score('input', 'output');
    expect(score).toBe(1.0);
  });

  it('clamps negative score to 0', async () => {
    const mockHaiku = vi.fn().mockResolvedValue('{"score": -0.5, "reason": "bad"}');
    const metric = new LLMJudgeMetric(mockHaiku);

    const score = await metric.score('input', 'output');
    expect(score).toBe(0.0);
  });
});

// ===== TraceQualityStore =====

describe('TraceQualityStore', () => {
  it('saves and queries by agent and quality', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tqs-'));
    const store = new TraceQualityStore(tmpDir);

    const record1 = makeTrace({ traceId: 't1', agentSlug: 'agent-a', qualityScore: 0.95 });
    const record2 = makeTrace({ traceId: 't2', agentSlug: 'agent-a', qualityScore: 0.60 });
    const record3 = makeTrace({ traceId: 't3', agentSlug: 'agent-b', qualityScore: 0.99 });

    store.saveScore(record1);
    store.saveScore(record2);
    store.saveScore(record3);

    // Query agent-a with minQuality 0.80
    const results = store.query('agent-a', new Date('2020-01-01'), 0.80);
    expect(results).toHaveLength(1);
    expect(results[0].traceId).toBe('t1');

    // Stats
    const stats = store.getStats('agent-a');
    expect(stats.count).toBe(2);
    expect(stats.avgQuality).toBeCloseTo(0.775, 2);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
