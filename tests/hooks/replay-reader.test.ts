import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ReplayReader } from '../../packages/@monomind/hooks/src/observability/replay-reader.js';
import { TraceStore } from '../../packages/@monomind/hooks/src/observability/trace.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ReplayReader', () => {
  let store: TraceStore;
  let reader: ReplayReader;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'replay-test-'));
    store = new TraceStore(tempDir);
    reader = new ReplayReader(store);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds chronological timeline from trace with spans and tool calls', () => {
    store.startTrace('t1', 'sess1', 'test task');

    store.startSpan({
      spanId: 's1',
      traceId: 't1',
      agentSlug: 'coder',
      startedAt: '2026-01-01T00:00:01.000Z',
      retryCount: 0,
    });
    store.recordToolCall({
      toolCallId: 'tc1',
      spanId: 's1',
      traceId: 't1',
      tool: 'Read',
      input: { file: 'a.ts' },
      output: 'contents',
      startedAt: '2026-01-01T00:00:02.000Z',
      endedAt: '2026-01-01T00:00:03.000Z',
      latencyMs: 1000,
    });
    store.endSpan('s1', 'success', { inputTokens: 100, outputTokens: 50 });

    store.startSpan({
      spanId: 's2',
      traceId: 't1',
      agentSlug: 'tester',
      startedAt: '2026-01-01T00:00:04.000Z',
      retryCount: 0,
    });
    store.recordToolCall({
      toolCallId: 'tc2',
      spanId: 's2',
      traceId: 't1',
      tool: 'Bash',
      input: { cmd: 'npm test' },
      output: 'pass',
      startedAt: '2026-01-01T00:00:05.000Z',
      endedAt: '2026-01-01T00:00:06.000Z',
      latencyMs: 1000,
    });
    store.endSpan('s2', 'success', { inputTokens: 200, outputTokens: 80 });

    store.endTrace('t1', 'success');

    const timeline = reader.buildTimeline('t1');

    // Verify chronological ordering
    for (let i = 1; i < timeline.events.length; i++) {
      expect(timeline.events[i].timestampMs).toBeGreaterThanOrEqual(
        timeline.events[i - 1].timestampMs,
      );
    }

    // Verify span.start comes before tool.call which comes before span.end
    const kinds = timeline.events.map((e) => e.kind);
    const s1Start = kinds.indexOf('span.start');
    const firstToolCall = kinds.indexOf('tool.call');
    const s1End = kinds.indexOf('span.end');
    expect(s1Start).toBeLessThan(firstToolCall);
    expect(firstToolCall).toBeLessThan(s1End);

    expect(timeline.totalSpans).toBe(2);
    expect(timeline.totalToolCalls).toBe(2);
    expect(timeline.status).toBe('success');
  });

  it('fromSpanId filters out earlier events', () => {
    store.startTrace('t1', 'sess1', 'test task');

    store.startSpan({
      spanId: 's1',
      traceId: 't1',
      agentSlug: 'coder',
      startedAt: '2026-01-01T00:00:01.000Z',
      retryCount: 0,
    });
    store.endSpan('s1', 'success', { inputTokens: 100, outputTokens: 50 });

    store.startSpan({
      spanId: 's2',
      traceId: 't1',
      agentSlug: 'tester',
      startedAt: '2026-01-01T00:00:10.000Z',
      retryCount: 0,
    });
    store.endSpan('s2', 'success', { inputTokens: 200, outputTokens: 80 });

    store.endTrace('t1', 'success');

    const timeline = reader.buildTimeline('t1', 's2');

    // First span events should be excluded (startedAt < cutoff)
    const spanIds = timeline.events
      .filter((e) => e.spanId !== undefined)
      .map((e) => e.spanId);
    expect(spanIds).not.toContain('s1');
    expect(spanIds).toContain('s2');
    expect(timeline.totalSpans).toBe(1);
  });

  it('throws when trace not found', () => {
    expect(() => reader.buildTimeline('nonexistent')).toThrow('Trace not found');
  });

  it('throws when fromSpanId not in trace', () => {
    store.startTrace('t1', 'sess1', 'task');
    store.endTrace('t1', 'success');
    expect(() => reader.buildTimeline('t1', 'bad-span')).toThrow('Span not found');
  });

  it('aggregates totalInputTokens across all spans', () => {
    store.startTrace('t1', 'sess1', 'token task');

    store.startSpan({
      spanId: 's1',
      traceId: 't1',
      agentSlug: 'coder',
      startedAt: '2026-01-01T00:00:01.000Z',
      retryCount: 0,
    });
    store.endSpan('s1', 'success', { inputTokens: 150, outputTokens: 60 });

    store.startSpan({
      spanId: 's2',
      traceId: 't1',
      agentSlug: 'tester',
      startedAt: '2026-01-01T00:00:02.000Z',
      retryCount: 0,
    });
    store.endSpan('s2', 'success', { inputTokens: 250, outputTokens: 90 });

    store.endTrace('t1', 'success');

    const timeline = reader.buildTimeline('t1');
    expect(timeline.totalInputTokens).toBe(400);
    expect(timeline.totalOutputTokens).toBe(150);
  });

  it('listTraces delegates to store', () => {
    store.startTrace('t1', 'sess1', 'task 1');
    store.startTrace('t2', 'sess1', 'task 2');
    const traces = reader.listTraces(10);
    expect(traces.length).toBeGreaterThanOrEqual(2);
  });

  it('handles trace with no spans', () => {
    store.startTrace('t1', 'sess1', 'empty task');
    store.endTrace('t1', 'success');
    const timeline = reader.buildTimeline('t1');
    expect(timeline.totalSpans).toBe(0);
    expect(timeline.totalToolCalls).toBe(0);
    expect(timeline.totalInputTokens).toBe(0);
    expect(timeline.totalOutputTokens).toBe(0);
    // At least trace.start and trace.end
    expect(timeline.events.length).toBeGreaterThanOrEqual(1);
    const kinds = timeline.events.map((e) => e.kind);
    expect(kinds).toContain('trace.start');
    expect(kinds).toContain('trace.end');
  });
});
