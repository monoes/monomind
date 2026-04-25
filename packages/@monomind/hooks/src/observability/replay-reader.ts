/**
 * Session Replay Reader — Task 14
 *
 * Builds chronological timelines from trace data for failure diagnosis.
 * Reads from TraceStore (JSONL-backed) and produces flat event streams.
 */

import type { TraceStore, Trace, AgentSpan, ToolCallEvent } from './trace.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TimelineEventKind =
  | 'trace.start'
  | 'trace.end'
  | 'span.start'
  | 'span.end'
  | 'tool.call'
  | 'tool.result';

export interface TimelineEvent {
  kind: TimelineEventKind;
  timestampMs: number;
  traceId: string;
  spanId?: string;
  toolCallId?: string;
  agentSlug?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
  tokens?: { input: number; output: number };
  error?: string;
  status?: string;
}

export interface ReplayTimeline {
  traceId: string;
  sessionId: string;
  taskDescription: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  events: TimelineEvent[];
  totalDurationMs: number;
  totalSpans: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// ---------------------------------------------------------------------------
// ReplayReader
// ---------------------------------------------------------------------------

export class ReplayReader {
  constructor(private readonly store: TraceStore) {}

  /**
   * Build a chronological timeline of events from a stored trace.
   *
   * @param traceId  - ID of the trace to replay
   * @param fromSpanId - If provided, only include events at or after this span's start time
   */
  buildTimeline(traceId: string, fromSpanId?: string): ReplayTimeline {
    const trace = this.store.getTrace(traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${traceId}`);
    }

    // Determine cutoff time if fromSpanId is specified
    let cutoffMs = 0;
    if (fromSpanId) {
      const targetSpan = trace.spans.find((s) => s.spanId === fromSpanId);
      if (!targetSpan) {
        throw new Error(`Span not found: ${fromSpanId}`);
      }
      cutoffMs = new Date(targetSpan.startedAt).getTime();
    }

    const events: TimelineEvent[] = [];

    // trace.start event
    const traceStartMs = new Date(trace.startedAt).getTime();
    if (traceStartMs >= cutoffMs) {
      events.push({
        kind: 'trace.start',
        timestampMs: traceStartMs,
        traceId: trace.traceId,
        status: trace.status,
      });
    }

    // Span and tool-call events
    // When fromSpanId is given, entire spans that started before the cutoff are excluded.
    for (const span of trace.spans) {
      const spanStartMs = new Date(span.startedAt).getTime();

      // Skip the entire span (and its tool calls) if it started before cutoff
      if (spanStartMs < cutoffMs) continue;

      events.push({
        kind: 'span.start',
        timestampMs: spanStartMs,
        traceId: trace.traceId,
        spanId: span.spanId,
        agentSlug: span.agentSlug,
        status: span.status,
      });

      // Tool calls within this span
      for (const tc of span.toolCalls) {
        const tcStartMs = new Date(tc.startedAt).getTime();

        events.push({
          kind: 'tool.call',
          timestampMs: tcStartMs,
          traceId: trace.traceId,
          spanId: span.spanId,
          toolCallId: tc.toolCallId,
          agentSlug: span.agentSlug,
          tool: tc.tool,
          input: tc.input,
        });

        // tool.result (uses endedAt if available)
        if (tc.endedAt) {
          const tcEndMs = new Date(tc.endedAt).getTime();
          events.push({
            kind: 'tool.result',
            timestampMs: tcEndMs,
            traceId: trace.traceId,
            spanId: span.spanId,
            toolCallId: tc.toolCallId,
            agentSlug: span.agentSlug,
            tool: tc.tool,
            output: tc.output,
            latencyMs: tc.latencyMs,
            error: tc.error,
          });
        }
      }

      // span.end event
      if (span.endedAt) {
        const spanEndMs = new Date(span.endedAt).getTime();
        events.push({
          kind: 'span.end',
          timestampMs: spanEndMs,
          traceId: trace.traceId,
          spanId: span.spanId,
          agentSlug: span.agentSlug,
          status: span.status,
          tokens: span.tokenUsage
            ? { input: span.tokenUsage.inputTokens, output: span.tokenUsage.outputTokens }
            : undefined,
          error: span.errorMessage,
        });
      }
    }

    // trace.end event
    if (trace.endedAt) {
      const traceEndMs = new Date(trace.endedAt).getTime();
      if (traceEndMs >= cutoffMs) {
        events.push({
          kind: 'trace.end',
          timestampMs: traceEndMs,
          traceId: trace.traceId,
          status: trace.status,
        });
      }
    }

    // Sort chronologically
    events.sort((a, b) => a.timestampMs - b.timestampMs);

    // Compute aggregates
    const totalSpans = trace.spans.filter(
      (s) => new Date(s.startedAt).getTime() >= cutoffMs,
    ).length;

    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const span of trace.spans) {
      if (new Date(span.startedAt).getTime() < cutoffMs) continue;
      totalToolCalls += span.toolCalls.length;
      if (span.tokenUsage) {
        totalInputTokens += span.tokenUsage.inputTokens;
        totalOutputTokens += span.tokenUsage.outputTokens;
      }
    }

    const startMs = new Date(trace.startedAt).getTime();
    const endMs = trace.endedAt ? new Date(trace.endedAt).getTime() : Date.now();

    return {
      traceId: trace.traceId,
      sessionId: trace.sessionId,
      taskDescription: trace.taskDescription,
      startedAt: startMs,
      endedAt: trace.endedAt ? endMs : undefined,
      status: trace.status,
      events,
      totalDurationMs: endMs - startMs,
      totalSpans,
      totalToolCalls,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  /**
   * List recent traces (delegates to TraceStore).
   */
  listTraces(limit = 20): Omit<Trace, 'spans'>[] {
    return this.store.listRecentTraces(limit);
  }
}
