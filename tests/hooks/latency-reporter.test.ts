/**
 * Tests for LatencyReporter — Task 13
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LatencyReporter } from '../../packages/@monomind/hooks/src/observability/latency-reporter.js';
import { TraceStore } from '../../packages/@monomind/hooks/src/observability/trace.js';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Helper: write span records directly to the JSONL file so we control
 * exact started_at / ended_at values (bypassing Date.now() in endSpan).
 */
function writeSpans(
  dir: string,
  spans: { spanId: string; agentSlug: string; startMs: number; endMs: number }[],
): void {
  const lines: string[] = [];
  const traceId = 'trace-test';

  // Write a trace-start record so the store is valid
  const tracesFile = join(dir, 'traces.jsonl');
  writeFileSync(tracesFile, JSON.stringify({
    type: 'trace-start',
    traceId,
    sessionId: 'sess-1',
    taskDescription: 'test',
    startedAt: new Date(spans[0]?.startMs ?? Date.now()).toISOString(),
    status: 'running',
  }) + '\n');

  for (const s of spans) {
    lines.push(JSON.stringify({
      type: 'span-start',
      spanId: s.spanId,
      traceId,
      agentSlug: s.agentSlug,
      startedAt: new Date(s.startMs).toISOString(),
      retryCount: 0,
      status: 'running',
    }));
    lines.push(JSON.stringify({
      type: 'span-end',
      spanId: s.spanId,
      endedAt: new Date(s.endMs).toISOString(),
      status: 'success',
    }));
  }
  writeFileSync(join(dir, 'spans.jsonl'), lines.join('\n') + '\n');
}

describe('LatencyReporter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'latency-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty report when no spans exist', () => {
    const store = new TraceStore(tempDir);
    const reporter = new LatencyReporter(store, []);
    const report = reporter.report(24);

    expect(report.agents).toHaveLength(0);
    expect(report.alerts).toHaveLength(0);
    expect(report.windowHours).toBe(24);
    expect(report.generatedAt).toBeGreaterThan(0);
  });

  it('computes p50/p95/p99 correctly from known data', () => {
    const now = Date.now();
    // 20 spans for "test-agent" with latencies 10, 20, 30, ..., 200 ms
    const spans = Array.from({ length: 20 }, (_, i) => ({
      spanId: `span-${i}`,
      agentSlug: 'test-agent',
      startMs: now - 60_000 + i * 100,
      endMs: now - 60_000 + i * 100 + (i + 1) * 10,
    }));
    writeSpans(tempDir, spans);

    const store = new TraceStore(tempDir);
    const reporter = new LatencyReporter(store, []);
    const report = reporter.report(1);

    expect(report.agents).toHaveLength(1);
    const stats = report.agents[0];
    expect(stats.agentSlug).toBe('test-agent');
    expect(stats.sampleCount).toBe(20);

    // Latencies: 10, 20, 30, ..., 200
    // Sorted: [10, 20, 30, ..., 200]
    // p50 = ceil(0.50 * 20) - 1 = 9 => sorted[9] = 100
    expect(stats.p50Ms).toBe(100);
    // p95 = ceil(0.95 * 20) - 1 = 18 => sorted[18] = 190
    expect(stats.p95Ms).toBe(190);
    // p99 = ceil(0.99 * 20) - 1 = 19 => sorted[19] = 200
    expect(stats.p99Ms).toBe(200);
    expect(stats.maxMs).toBe(200);

    // avg = (10+20+...+200)/20 = (20*210/2)/20 = 105
    expect(stats.avgMs).toBe(105);
  });

  it('generates alert when p95 exceeds threshold', () => {
    const now = Date.now();
    const spans = Array.from({ length: 20 }, (_, i) => ({
      spanId: `span-${i}`,
      agentSlug: 'slow-agent',
      startMs: now - 60_000 + i * 100,
      endMs: now - 60_000 + i * 100 + (i + 1) * 10,
    }));
    writeSpans(tempDir, spans);

    const store = new TraceStore(tempDir);
    const reporter = new LatencyReporter(store, [
      { agentSlug: 'slow-agent', p95ThresholdMs: 100 },
    ]);
    const report = reporter.report(1);

    // p95 = 190, threshold = 100 => alert
    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0].agentSlug).toBe('slow-agent');
    expect(report.alerts[0].metric).toBe('p95');
    expect(report.alerts[0].observedMs).toBe(190);
    expect(report.alerts[0].thresholdMs).toBe(100);
  });

  it('sorts agents by p95 descending', () => {
    const now = Date.now();
    // Fast agent: 10ms latency each
    const fastSpans = Array.from({ length: 5 }, (_, i) => ({
      spanId: `fast-${i}`,
      agentSlug: 'fast-agent',
      startMs: now - 60_000 + i * 100,
      endMs: now - 60_000 + i * 100 + 10,
    }));
    // Slow agent: 500ms latency each
    const slowSpans = Array.from({ length: 5 }, (_, i) => ({
      spanId: `slow-${i}`,
      agentSlug: 'slow-agent',
      startMs: now - 60_000 + i * 100,
      endMs: now - 60_000 + i * 100 + 500,
    }));
    writeSpans(tempDir, [...fastSpans, ...slowSpans]);

    const store = new TraceStore(tempDir);
    const reporter = new LatencyReporter(store, []);
    const report = reporter.report(1);

    expect(report.agents).toHaveLength(2);
    expect(report.agents[0].agentSlug).toBe('slow-agent');
    expect(report.agents[1].agentSlug).toBe('fast-agent');
  });

  it('reportAgent returns undefined for unknown agent', () => {
    const store = new TraceStore(tempDir);
    const reporter = new LatencyReporter(store, []);
    expect(reporter.reportAgent('nonexistent')).toBeUndefined();
  });

  it('reportAgent returns stats for a known agent', () => {
    const now = Date.now();
    const spans = Array.from({ length: 5 }, (_, i) => ({
      spanId: `span-${i}`,
      agentSlug: 'my-agent',
      startMs: now - 60_000,
      endMs: now - 60_000 + 50,
    }));
    writeSpans(tempDir, spans);

    const store = new TraceStore(tempDir);
    const reporter = new LatencyReporter(store, []);
    const stats = reporter.reportAgent('my-agent', 1);

    expect(stats).toBeDefined();
    expect(stats!.agentSlug).toBe('my-agent');
    expect(stats!.sampleCount).toBe(5);
    expect(stats!.p50Ms).toBe(50);
  });

  it('wildcard threshold matches all agents', () => {
    const now = Date.now();
    const spansA = Array.from({ length: 10 }, (_, i) => ({
      spanId: `a-${i}`,
      agentSlug: 'agent-a',
      startMs: now - 60_000 + i * 50,
      endMs: now - 60_000 + i * 50 + 300,
    }));
    const spansB = Array.from({ length: 10 }, (_, i) => ({
      spanId: `b-${i}`,
      agentSlug: 'agent-b',
      startMs: now - 60_000 + i * 50,
      endMs: now - 60_000 + i * 50 + 400,
    }));
    writeSpans(tempDir, [...spansA, ...spansB]);

    const store = new TraceStore(tempDir);
    const reporter = new LatencyReporter(store, [
      { agentSlug: '*', p95ThresholdMs: 100 },
    ]);
    const report = reporter.report(1);

    // Both agents exceed 100ms threshold, so 2 alerts
    const p95Alerts = report.alerts.filter((a) => a.metric === 'p95');
    expect(p95Alerts).toHaveLength(2);
    const slugs = p95Alerts.map((a) => a.agentSlug).sort();
    expect(slugs).toEqual(['agent-a', 'agent-b']);
  });

  it('critical severity when p95 > 2x threshold', () => {
    const now = Date.now();
    // All spans have 500ms latency
    const spans = Array.from({ length: 10 }, (_, i) => ({
      spanId: `span-${i}`,
      agentSlug: 'critical-agent',
      startMs: now - 60_000 + i * 50,
      endMs: now - 60_000 + i * 50 + 500,
    }));
    writeSpans(tempDir, spans);

    const store = new TraceStore(tempDir);
    // p95 = 500, threshold = 200 => 500 > 200*2 => critical
    const reporter = new LatencyReporter(store, [
      { agentSlug: 'critical-agent', p95ThresholdMs: 200 },
    ]);
    const report = reporter.report(1);

    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0].severity).toBe('critical');
  });

  it('warning severity when p95 > threshold but <= 2x', () => {
    const now = Date.now();
    // All spans have 150ms latency
    const spans = Array.from({ length: 10 }, (_, i) => ({
      spanId: `span-${i}`,
      agentSlug: 'warn-agent',
      startMs: now - 60_000 + i * 50,
      endMs: now - 60_000 + i * 50 + 150,
    }));
    writeSpans(tempDir, spans);

    const store = new TraceStore(tempDir);
    // p95 = 150, threshold = 100 => 150 <= 200 => warning
    const reporter = new LatencyReporter(store, [
      { agentSlug: 'warn-agent', p95ThresholdMs: 100 },
    ]);
    const report = reporter.report(1);

    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0].severity).toBe('warning');
  });

  it('checks p99 threshold when specified', () => {
    const now = Date.now();
    // Latencies: 10, 20, ..., 200 ms (20 spans)
    const spans = Array.from({ length: 20 }, (_, i) => ({
      spanId: `span-${i}`,
      agentSlug: 'p99-agent',
      startMs: now - 60_000 + i * 100,
      endMs: now - 60_000 + i * 100 + (i + 1) * 10,
    }));
    writeSpans(tempDir, spans);

    const store = new TraceStore(tempDir);
    // p99 = 200, p99Threshold = 150 => alert
    const reporter = new LatencyReporter(store, [
      { agentSlug: 'p99-agent', p95ThresholdMs: 999, p99ThresholdMs: 150 },
    ]);
    const report = reporter.report(1);

    const p99Alerts = report.alerts.filter((a) => a.metric === 'p99');
    expect(p99Alerts).toHaveLength(1);
    expect(p99Alerts[0].observedMs).toBe(200);
    expect(p99Alerts[0].thresholdMs).toBe(150);
  });

  it('createLatencyReporter factory works', async () => {
    const { createLatencyReporter } = await import(
      '../../packages/@monomind/hooks/src/observability/latency-reporter.js'
    );
    const store = new TraceStore(tempDir);
    const reporter = createLatencyReporter(store, []);
    expect(reporter).toBeInstanceOf(LatencyReporter);
    const report = reporter.report(1);
    expect(report.agents).toHaveLength(0);
  });
});
