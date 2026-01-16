import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TraceCollector } from '../../packages/@monobrain/cli/src/eval/trace-collector.js';
import { DatasetManager } from '../../packages/@monobrain/cli/src/eval/dataset-manager.js';
import { DatasetRunner } from '../../packages/@monobrain/cli/src/eval/dataset-runner.js';
import type { RecordTraceInput } from '../../packages/@monobrain/cli/src/eval/trace-collector.js';
import type { EvalTrace, EvalRunResult } from '../../packages/@monobrain/shared/src/types/eval.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TraceCollector', () => {
  let collector: TraceCollector;
  let tempDir: string;

  const makeInput = (overrides: Partial<RecordTraceInput> = {}): RecordTraceInput => ({
    agentSlug: 'coder',
    agentVersion: '1.0.0',
    taskDescription: 'Implement feature',
    taskInput: '{"type":"code"}',
    agentOutput: 'function hello() {}',
    retryCount: 0,
    outcome: 'success',
    latencyMs: 200,
    ...overrides,
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-test-'));
    collector = new TraceCollector(join(tempDir, 'eval-traces.jsonl'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('record() generates traceId and capturedAt', () => {
    const trace = collector.record(makeInput());
    expect(trace.traceId).toBeDefined();
    expect(typeof trace.traceId).toBe('string');
    expect(trace.traceId.length).toBeGreaterThan(0);
    expect(trace.capturedAt).toBeDefined();
    expect(new Date(trace.capturedAt).getTime()).not.toBeNaN();
  });

  it('record() persists trace to JSONL file', () => {
    collector.record(makeInput());
    const all = collector.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].agentSlug).toBe('coder');
  });

  it('autoReviewStatus returns pending for retryCount > 1', () => {
    const status = collector.autoReviewStatus(makeInput({ retryCount: 2 }));
    expect(status).toBe('pending');
  });

  it('autoReviewStatus returns pending for qualityScore < 0.6', () => {
    const status = collector.autoReviewStatus(makeInput({ qualityScore: 0.4 }));
    expect(status).toBe('pending');
  });

  it('autoReviewStatus returns pending for failure outcome', () => {
    const status = collector.autoReviewStatus(makeInput({ outcome: 'failure' }));
    expect(status).toBe('pending');
  });

  it('autoReviewStatus returns approved for clean trace', () => {
    const status = collector.autoReviewStatus(makeInput({ qualityScore: 0.9 }));
    expect(status).toBe('approved');
  });

  it('autoTag adds high-retry for retryCount > 1', () => {
    const tags = collector.autoTag(makeInput({ retryCount: 3 }));
    expect(tags).toContain('high-retry');
  });

  it('autoTag adds failure for failed outcome', () => {
    const tags = collector.autoTag(makeInput({ outcome: 'failure' }));
    expect(tags).toContain('failure');
  });

  it('autoTag adds timeout for timeout outcome', () => {
    const tags = collector.autoTag(makeInput({ outcome: 'timeout' }));
    expect(tags).toContain('timeout');
  });

  it('autoTag returns empty array for clean trace', () => {
    const tags = collector.autoTag(makeInput());
    expect(tags).toEqual([]);
  });

  it('getTracesPendingReview returns only pending traces', () => {
    collector.record(makeInput({ outcome: 'failure' })); // pending
    collector.record(makeInput({ qualityScore: 0.9 })); // approved
    collector.record(makeInput({ retryCount: 3 })); // pending

    const pending = collector.getTracesPendingReview();
    expect(pending).toHaveLength(2);
    expect(pending.every((t) => t.reviewStatus === 'pending')).toBe(true);
  });

  it('getTracesPendingReview respects limit', () => {
    collector.record(makeInput({ outcome: 'failure' }));
    collector.record(makeInput({ retryCount: 3 }));
    collector.record(makeInput({ outcome: 'failure' }));

    const pending = collector.getTracesPendingReview(2);
    expect(pending).toHaveLength(2);
  });
});

describe('DatasetManager', () => {
  let manager: DatasetManager;
  let collector: TraceCollector;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-ds-test-'));
    collector = new TraceCollector(join(tempDir, 'eval-traces.jsonl'));
    manager = new DatasetManager(
      join(tempDir, 'datasets.jsonl'),
      join(tempDir, 'dataset-entries.jsonl'),
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('createFromTraces creates dataset with correct metadata', () => {
    const t1 = collector.record({
      agentSlug: 'coder',
      agentVersion: '1.0.0',
      taskDescription: 'test',
      taskInput: '{}',
      agentOutput: 'out',
      retryCount: 0,
      outcome: 'success',
      latencyMs: 100,
    });

    const dataset = manager.createFromTraces({
      name: 'test-ds',
      description: 'A test dataset',
      traces: [t1],
    });

    expect(dataset.datasetId).toBeDefined();
    expect(dataset.name).toBe('test-ds');
    expect(dataset.entryCount).toBe(1);
    expect(dataset.agentSlugs).toContain('coder');
  });

  it('listDatasets returns all created datasets', () => {
    const t1 = collector.record({
      agentSlug: 'coder',
      agentVersion: '1.0.0',
      taskDescription: 'test',
      taskInput: '{}',
      agentOutput: 'out',
      retryCount: 0,
      outcome: 'success',
      latencyMs: 100,
    });

    manager.createFromTraces({ name: 'ds1', description: 'first', traces: [t1] });
    manager.createFromTraces({ name: 'ds2', description: 'second', traces: [t1] });

    const datasets = manager.listDatasets();
    expect(datasets).toHaveLength(2);
    expect(datasets.map((d) => d.name)).toEqual(['ds1', 'ds2']);
  });

  it('addTraceToDataset adds entry and increments count', () => {
    const t1 = collector.record({
      agentSlug: 'coder',
      agentVersion: '1.0.0',
      taskDescription: 'test',
      taskInput: '{}',
      agentOutput: 'out',
      retryCount: 0,
      outcome: 'success',
      latencyMs: 100,
    });

    const dataset = manager.createFromTraces({ name: 'ds', description: 'ds', traces: [t1] });
    manager.addTraceToDataset(dataset.datasetId, 'extra-trace-id');

    const updated = manager.listDatasets().find((d) => d.datasetId === dataset.datasetId);
    expect(updated!.entryCount).toBe(2);

    const entries = manager.getEntries(dataset.datasetId);
    expect(entries).toHaveLength(2);
  });
});

describe('DatasetRunner', () => {
  it('run computes correct stats', async () => {
    const runner = new DatasetRunner();
    const traces: EvalTrace[] = [
      {
        traceId: 't1', agentSlug: 'coder', agentVersion: '1.0.0',
        taskDescription: 'a', taskInput: '{}', agentOutput: 'out',
        retryCount: 0, outcome: 'success', latencyMs: 100,
        capturedAt: new Date().toISOString(), reviewStatus: 'approved', tags: [],
      },
      {
        traceId: 't2', agentSlug: 'coder', agentVersion: '1.0.0',
        taskDescription: 'b', taskInput: '{}', agentOutput: 'out',
        retryCount: 0, outcome: 'success', latencyMs: 200,
        capturedAt: new Date().toISOString(), reviewStatus: 'approved', tags: [],
      },
    ];

    const result = await runner.run({
      datasetId: 'ds1',
      agentVersion: '1.0.0',
      traces,
      agentRunner: async () => ({
        agentOutput: 'result',
        outcome: 'success',
        qualityScore: 0.9,
        latencyMs: 150,
      }),
    });

    expect(result.entriesTested).toBe(2);
    expect(result.passCount).toBe(2);
    expect(result.failCount).toBe(0);
    expect(result.avgQualityScore).toBe(0.9);
    expect(result.avgLatencyMs).toBe(150);
    expect(result.regressionDetected).toBe(false);
  });

  it('run detects regression when quality drops', async () => {
    const runner = new DatasetRunner();
    const traces: EvalTrace[] = [
      {
        traceId: 't1', agentSlug: 'coder', agentVersion: '1.0.0',
        taskDescription: 'a', taskInput: '{}', agentOutput: 'out',
        retryCount: 0, outcome: 'success', latencyMs: 100,
        capturedAt: new Date().toISOString(), reviewStatus: 'approved', tags: [],
      },
    ];

    const baseline: EvalRunResult = {
      runId: 'base-run',
      datasetId: 'ds1',
      runAt: new Date().toISOString(),
      agentVersion: '0.9.0',
      entriesTested: 1,
      passCount: 1,
      failCount: 0,
      avgQualityScore: 0.95,
      avgLatencyMs: 100,
      regressionDetected: false,
      regressionDetails: [],
    };

    const result = await runner.run({
      datasetId: 'ds1',
      agentVersion: '1.0.0',
      traces,
      agentRunner: async () => ({
        agentOutput: 'result',
        outcome: 'failure',
        qualityScore: 0.3,
        latencyMs: 500,
      }),
      baselineResult: baseline,
      regressionThreshold: 0.1,
    });

    expect(result.regressionDetected).toBe(true);
    expect(result.regressionDetails.length).toBeGreaterThan(0);
    expect(result.regressionDetails[0].delta).toBeGreaterThan(0);
    expect(result.failCount).toBe(1);
  });

  it('run handles mixed outcomes correctly', async () => {
    const runner = new DatasetRunner();
    const traces: EvalTrace[] = [
      {
        traceId: 't1', agentSlug: 'coder', agentVersion: '1.0.0',
        taskDescription: 'a', taskInput: '{}', agentOutput: 'out',
        retryCount: 0, outcome: 'success', latencyMs: 100,
        capturedAt: new Date().toISOString(), reviewStatus: 'approved', tags: [],
      },
      {
        traceId: 't2', agentSlug: 'tester', agentVersion: '1.0.0',
        taskDescription: 'b', taskInput: '{}', agentOutput: 'out',
        retryCount: 0, outcome: 'success', latencyMs: 200,
        capturedAt: new Date().toISOString(), reviewStatus: 'approved', tags: [],
      },
    ];

    let callIndex = 0;
    const result = await runner.run({
      datasetId: 'ds1',
      agentVersion: '1.0.0',
      traces,
      agentRunner: async () => {
        callIndex++;
        if (callIndex === 1) {
          return { agentOutput: 'ok', outcome: 'success', qualityScore: 0.8, latencyMs: 100 };
        }
        return { agentOutput: 'err', outcome: 'failure', qualityScore: 0.2, latencyMs: 300 };
      },
    });

    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.avgQualityScore).toBe(0.5);
    expect(result.avgLatencyMs).toBe(200);
  });
});
