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
export declare class TraceCollector {
    private filePath;
    constructor(filePath: string);
    /**
     * Determine auto review status based on trace quality signals.
     */
    autoReviewStatus(input: RecordTraceInput): 'pending' | 'approved';
    /**
     * Auto-generate tags based on trace characteristics.
     */
    autoTag(input: RecordTraceInput): string[];
    /**
     * Record a trace, auto-generating traceId, capturedAt, reviewStatus, and tags.
     */
    record(input: RecordTraceInput): EvalTrace;
    /**
     * Read all traces from the JSONL file.
     */
    readAll(): EvalTrace[];
    /**
     * Get traces pending review, with optional limit.
     */
    getTracesPendingReview(limit?: number): EvalTrace[];
}
//# sourceMappingURL=trace-collector.d.ts.map