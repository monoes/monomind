/**
 * TraceCollector - JSONL-based production trace collection (Task 33)
 */
import { randomUUID } from 'crypto';
import { appendFileSync, readFileSync, existsSync } from 'fs';
import type { EvalTrace } from '../../../shared/src/types/eval.js';

export interface RecordTraceInput {
  agentSlug: string;
  agentVersion: string;
  taskDescription: string;
  taskInput: string;
  agentOutput: string;
  retryCount: number;
  qualityScore?: number;
  outcome: 'success' | 'failure' | 'timeout';
  latencyMs: number;
  tokenCount?: number;
  costUsd?: number;
  correctedOutput?: string;
}

export class TraceCollector {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Determine auto review status based on trace quality signals.
   */
  autoReviewStatus(input: RecordTraceInput): 'pending' | 'approved' {
    if (input.retryCount > 1) return 'pending';
    if (input.qualityScore !== undefined && input.qualityScore < 0.6) return 'pending';
    if (input.outcome === 'failure') return 'pending';
    return 'approved';
  }

  /**
   * Auto-generate tags based on trace characteristics.
   */
  autoTag(input: RecordTraceInput): string[] {
    const tags: string[] = [];
    if (input.retryCount > 1) tags.push('high-retry');
    if (input.outcome === 'failure') tags.push('failure');
    if (input.outcome === 'timeout') tags.push('timeout');
    return tags;
  }

  /**
   * Record a trace, auto-generating traceId, capturedAt, reviewStatus, and tags.
   */
  record(input: RecordTraceInput): EvalTrace {
    const trace: EvalTrace = {
      traceId: randomUUID(),
      agentSlug: input.agentSlug,
      agentVersion: input.agentVersion,
      taskDescription: input.taskDescription,
      taskInput: input.taskInput,
      agentOutput: input.agentOutput,
      retryCount: input.retryCount,
      qualityScore: input.qualityScore,
      outcome: input.outcome,
      latencyMs: input.latencyMs,
      tokenCount: input.tokenCount,
      costUsd: input.costUsd,
      capturedAt: new Date().toISOString(),
      reviewStatus: this.autoReviewStatus(input),
      correctedOutput: input.correctedOutput,
      tags: this.autoTag(input),
    };

    appendFileSync(this.filePath, JSON.stringify(trace) + '\n', 'utf-8');
    return trace;
  }

  /**
   * Read all traces from the JSONL file.
   */
  readAll(): EvalTrace[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line) as EvalTrace);
  }

  /**
   * Get traces pending review, with optional limit.
   */
  getTracesPendingReview(limit?: number): EvalTrace[] {
    const all = this.readAll().filter((t) => t.reviewStatus === 'pending');
    if (limit !== undefined) return all.slice(0, limit);
    return all;
  }
}
