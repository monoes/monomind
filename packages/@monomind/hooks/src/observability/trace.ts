/**
 * Distributed Trace Hierarchy — Task 12
 *
 * Core data models and TraceStore using JSON-lines (append-only) storage.
 * No native dependencies — pure Node.js file I/O.
 *
 * Append-only pattern:
 *  - trace-start / trace-end records in traces.jsonl
 *  - span-start / span-end records in spans.jsonl
 *  - tool-call records in tool-calls.jsonl
 *
 * On read, start/end records are merged by ID to reconstruct full objects.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface ToolCallEvent {
  toolCallId: string;
  spanId: string;
  traceId: string;
  tool: string;
  input: unknown;
  output?: unknown;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  error?: string;
}

export interface AgentSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  agentSlug: string;
  startedAt: string;
  endedAt?: string;
  tokenUsage?: TokenUsage;
  toolCalls: ToolCallEvent[];
  retryCount: number;
  status: 'running' | 'success' | 'error';
  errorMessage?: string;
}

export interface Trace {
  traceId: string;
  sessionId: string;
  taskDescription: string;
  startedAt: string;
  endedAt?: string;
  spans: AgentSpan[];
  status: 'running' | 'success' | 'error';
}

// ---------------------------------------------------------------------------
// Internal record types (what gets written to JSONL)
// ---------------------------------------------------------------------------

interface TraceStartRecord {
  type: 'trace-start';
  traceId: string;
  sessionId: string;
  taskDescription: string;
  startedAt: string;
  status: 'running';
}

interface TraceEndRecord {
  type: 'trace-end';
  traceId: string;
  endedAt: string;
  status: 'success' | 'error';
}

interface SpanStartRecord {
  type: 'span-start';
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  agentSlug: string;
  startedAt: string;
  retryCount: number;
  status: 'running';
}

interface SpanEndRecord {
  type: 'span-end';
  spanId: string;
  endedAt: string;
  status: 'success' | 'error';
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  errorMessage?: string;
}

interface ToolCallRecord {
  type: 'tool-call';
  toolCallId: string;
  spanId: string;
  traceId: string;
  tool: string;
  input: unknown;
  output?: unknown;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  error?: string;
}

type TraceRecord = TraceStartRecord | TraceEndRecord;
type SpanRecord = SpanStartRecord | SpanEndRecord;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line) as T);
}

function appendJsonl(filePath: string, record: unknown): void {
  writeFileSync(filePath, JSON.stringify(record) + '\n', { encoding: 'utf-8', flag: 'a' });
}

// ---------------------------------------------------------------------------
// TraceStore
// ---------------------------------------------------------------------------

export class TraceStore {
  private readonly tracesFile: string;
  private readonly spansFile: string;
  private readonly toolCallsFile: string;

  /** In-memory cache of active (running) traces for fast lookup */
  private activeTraces = new Map<string, Trace>();
  /** In-memory cache of active spans */
  private activeSpans = new Map<string, AgentSpan>();

  constructor(dirPath: string) {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    this.tracesFile = join(dirPath, 'traces.jsonl');
    this.spansFile = join(dirPath, 'spans.jsonl');
    this.toolCallsFile = join(dirPath, 'tool-calls.jsonl');
  }

  // -----------------------------------------------------------------------
  // Trace lifecycle
  // -----------------------------------------------------------------------

  startTrace(traceId: string, sessionId: string, taskDescription: string): Trace {
    const now = new Date().toISOString();
    const record: TraceStartRecord = {
      type: 'trace-start',
      traceId,
      sessionId,
      taskDescription,
      startedAt: now,
      status: 'running',
    };
    appendJsonl(this.tracesFile, record);

    const trace: Trace = {
      traceId,
      sessionId,
      taskDescription,
      startedAt: now,
      spans: [],
      status: 'running',
    };
    this.activeTraces.set(traceId, trace);
    return trace;
  }

  endTrace(traceId: string, status: 'success' | 'error'): void {
    const record: TraceEndRecord = {
      type: 'trace-end',
      traceId,
      endedAt: new Date().toISOString(),
      status,
    };
    appendJsonl(this.tracesFile, record);
    this.activeTraces.delete(traceId);
  }

  // -----------------------------------------------------------------------
  // Span lifecycle
  // -----------------------------------------------------------------------

  startSpan(span: Omit<AgentSpan, 'toolCalls' | 'status'> & { status?: 'running' }): AgentSpan {
    const full: AgentSpan = { ...span, toolCalls: [], status: 'running' };
    const record: SpanStartRecord = {
      type: 'span-start',
      spanId: span.spanId,
      traceId: span.traceId,
      parentSpanId: span.parentSpanId,
      agentSlug: span.agentSlug,
      startedAt: span.startedAt,
      retryCount: span.retryCount,
      status: 'running',
    };
    appendJsonl(this.spansFile, record);
    this.activeSpans.set(span.spanId, full);
    return full;
  }

  endSpan(
    spanId: string,
    status: 'success' | 'error',
    tokenUsage?: TokenUsage,
    errorMessage?: string,
  ): void {
    const record: SpanEndRecord = {
      type: 'span-end',
      spanId,
      endedAt: new Date().toISOString(),
      status,
      inputTokens: tokenUsage?.inputTokens,
      outputTokens: tokenUsage?.outputTokens,
      costUsd: tokenUsage?.costUsd,
      errorMessage,
    };
    appendJsonl(this.spansFile, record);
    this.activeSpans.delete(spanId);
  }

  // -----------------------------------------------------------------------
  // Tool calls
  // -----------------------------------------------------------------------

  recordToolCall(event: ToolCallEvent): void {
    const record: ToolCallRecord = { type: 'tool-call', ...event };
    appendJsonl(this.toolCallsFile, record);
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getTrace(traceId: string): Trace | undefined {
    // 1. Reconstruct trace from JSONL
    const traceRecords = readJsonl<TraceRecord>(this.tracesFile);
    let trace: Trace | undefined;

    for (const r of traceRecords) {
      if (r.type === 'trace-start' && r.traceId === traceId) {
        trace = {
          traceId: r.traceId,
          sessionId: r.sessionId,
          taskDescription: r.taskDescription,
          startedAt: r.startedAt,
          spans: [],
          status: r.status,
        };
      } else if (r.type === 'trace-end' && r.traceId === traceId && trace) {
        trace.endedAt = r.endedAt;
        trace.status = r.status;
      }
    }

    if (!trace) return undefined;

    // 2. Reconstruct spans
    const spanRecords = readJsonl<SpanRecord>(this.spansFile);
    const spanMap = new Map<string, AgentSpan>();

    for (const r of spanRecords) {
      if (r.type === 'span-start' && r.traceId === traceId) {
        spanMap.set(r.spanId, {
          spanId: r.spanId,
          traceId: r.traceId,
          parentSpanId: r.parentSpanId,
          agentSlug: r.agentSlug,
          startedAt: r.startedAt,
          retryCount: r.retryCount,
          toolCalls: [],
          status: r.status,
        });
      } else if (r.type === 'span-end') {
        const span = spanMap.get(r.spanId);
        if (span) {
          span.endedAt = r.endedAt;
          span.status = r.status;
          if (r.inputTokens !== undefined || r.outputTokens !== undefined) {
            span.tokenUsage = {
              inputTokens: r.inputTokens ?? 0,
              outputTokens: r.outputTokens ?? 0,
              costUsd: r.costUsd,
            };
          }
          span.errorMessage = r.errorMessage;
        }
      }
    }

    // 3. Attach tool calls to spans
    const toolRecords = readJsonl<ToolCallRecord>(this.toolCallsFile);
    for (const tc of toolRecords) {
      if (tc.traceId !== traceId) continue;
      const span = spanMap.get(tc.spanId);
      if (span) {
        const { type: _type, ...event } = tc;
        span.toolCalls.push(event as ToolCallEvent);
      }
    }

    trace.spans = Array.from(spanMap.values());
    return trace;
  }

  listRecentTraces(limit = 20): Omit<Trace, 'spans'>[] {
    const records = readJsonl<TraceRecord>(this.tracesFile);
    const traceMap = new Map<string, Omit<Trace, 'spans'>>();

    for (const r of records) {
      if (r.type === 'trace-start') {
        traceMap.set(r.traceId, {
          traceId: r.traceId,
          sessionId: r.sessionId,
          taskDescription: r.taskDescription,
          startedAt: r.startedAt,
          status: r.status,
        });
      } else if (r.type === 'trace-end') {
        const t = traceMap.get(r.traceId);
        if (t) {
          t.endedAt = r.endedAt;
          t.status = r.status;
        }
      }
    }

    return Array.from(traceMap.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Database adapter (for LatencyReporter — Task 13)
  // -----------------------------------------------------------------------

  get database(): { querySpans: (windowHours: number) => { agent_slug: string; started_at: string; ended_at: string }[] } {
    return {
      querySpans: (windowHours: number) => {
        const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();
        const spanRecords = readJsonl<SpanRecord>(this.spansFile);
        const spanMap = new Map<string, { agent_slug: string; started_at: string; ended_at?: string }>();

        for (const r of spanRecords) {
          if (r.type === 'span-start') {
            if (r.startedAt >= cutoff) {
              spanMap.set(r.spanId, {
                agent_slug: r.agentSlug,
                started_at: r.startedAt,
              });
            }
          } else if (r.type === 'span-end') {
            const s = spanMap.get(r.spanId);
            if (s) {
              s.ended_at = r.endedAt;
            }
          }
        }

        return Array.from(spanMap.values()).filter(
          (s): s is { agent_slug: string; started_at: string; ended_at: string } =>
            s.ended_at !== undefined,
        );
      },
    };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  close(): void {
    // No-op for file-based storage
  }
}
