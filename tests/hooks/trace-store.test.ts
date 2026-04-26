import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TraceStore } from '../../packages/@monomind/hooks/src/observability/trace.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TraceStore', () => {
  let store: TraceStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'trace-test-'));
    store = new TraceStore(tempDir);
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a trace and retrieves it by id', () => {
    store.startTrace('t1', 'sess-1', 'do something');
    const trace = store.getTrace('t1');
    expect(trace).toBeDefined();
    expect(trace!.traceId).toBe('t1');
    expect(trace!.sessionId).toBe('sess-1');
    expect(trace!.taskDescription).toBe('do something');
    expect(trace!.status).toBe('running');
    expect(trace!.spans).toEqual([]);
  });

  it('startSpan/endSpan round-trips correctly', () => {
    store.startTrace('t2', 'sess-1', 'task');
    store.startSpan({
      spanId: 's1',
      traceId: 't2',
      agentSlug: 'coder',
      startedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
    });
    store.endSpan('s1', 'success', { inputTokens: 100, outputTokens: 50, costUsd: 0.01 });

    const trace = store.getTrace('t2');
    expect(trace!.spans).toHaveLength(1);
    const span = trace!.spans[0];
    expect(span.spanId).toBe('s1');
    expect(span.agentSlug).toBe('coder');
    expect(span.status).toBe('success');
    expect(span.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    expect(span.endedAt).toBeDefined();
  });

  it('recordToolCall stores latencyMs correctly', () => {
    store.startTrace('t3', 'sess-1', 'task');
    store.startSpan({
      spanId: 's2',
      traceId: 't3',
      agentSlug: 'coder',
      startedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
    });
    store.recordToolCall({
      toolCallId: 'tc1',
      spanId: 's2',
      traceId: 't3',
      tool: 'Read',
      input: { path: '/foo' },
      output: 'content',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.150Z',
      latencyMs: 150,
    });

    const trace = store.getTrace('t3');
    const tc = trace!.spans[0].toolCalls[0];
    expect(tc.latencyMs).toBe(150);
    expect(tc.tool).toBe('Read');
    expect(tc.output).toBe('content');
  });

  it('getTrace assembles nested spans and tool calls', () => {
    store.startTrace('t4', 'sess-1', 'complex task');
    store.startSpan({
      spanId: 'sp-a',
      traceId: 't4',
      agentSlug: 'architect',
      startedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 0,
    });
    store.startSpan({
      spanId: 'sp-b',
      traceId: 't4',
      parentSpanId: 'sp-a',
      agentSlug: 'coder',
      startedAt: '2026-01-01T00:00:01.000Z',
      retryCount: 1,
    });
    store.recordToolCall({
      toolCallId: 'tc-x',
      spanId: 'sp-b',
      traceId: 't4',
      tool: 'Edit',
      input: {},
      startedAt: '2026-01-01T00:00:01.000Z',
      endedAt: '2026-01-01T00:00:01.200Z',
      latencyMs: 200,
    });
    store.endSpan('sp-b', 'success');
    store.endSpan('sp-a', 'success');
    store.endTrace('t4', 'success');

    const trace = store.getTrace('t4');
    expect(trace!.status).toBe('success');
    expect(trace!.spans).toHaveLength(2);

    const coderSpan = trace!.spans.find((s) => s.agentSlug === 'coder');
    expect(coderSpan!.parentSpanId).toBe('sp-a');
    expect(coderSpan!.toolCalls).toHaveLength(1);
    expect(coderSpan!.retryCount).toBe(1);
  });

  it('listRecentTraces returns most recent first', async () => {
    store.startTrace('old', 'sess-1', 'old task');
    store.endTrace('old', 'success');
    // Ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    store.startTrace('new', 'sess-1', 'new task');

    const recent = store.listRecentTraces(10);
    expect(recent.length).toBe(2);
    // Most recent first (by startedAt descending)
    expect(recent[0].traceId).toBe('new');
    expect(recent[1].traceId).toBe('old');
  });

  it('endTrace updates status to success or error', () => {
    store.startTrace('t-ok', 'sess-1', 'will succeed');
    store.endTrace('t-ok', 'success');
    expect(store.getTrace('t-ok')!.status).toBe('success');

    store.startTrace('t-err', 'sess-1', 'will fail');
    store.endTrace('t-err', 'error');
    expect(store.getTrace('t-err')!.status).toBe('error');
  });

  it('getTrace returns undefined for unknown traceId', () => {
    expect(store.getTrace('nonexistent')).toBeUndefined();
  });

  it('querySpans returns spans within time window', () => {
    store.startTrace('t-q', 'sess-1', 'query test');
    const now = new Date().toISOString();
    store.startSpan({
      spanId: 'sq-1',
      traceId: 't-q',
      agentSlug: 'tester',
      startedAt: now,
      retryCount: 0,
    });
    store.endSpan('sq-1', 'success');

    // Old span (outside the 1-hour window)
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    store.startSpan({
      spanId: 'sq-old',
      traceId: 't-q',
      agentSlug: 'old-agent',
      startedAt: old,
      retryCount: 0,
    });
    store.endSpan('sq-old', 'success');

    const results = store.database.querySpans(1);
    expect(results.length).toBe(1);
    expect(results[0].agent_slug).toBe('tester');
  });
});
