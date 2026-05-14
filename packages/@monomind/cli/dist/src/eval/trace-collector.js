/**
 * TraceCollector - JSONL-based production trace collection (Task 33)
 */
import { randomUUID } from 'crypto';
import { appendFileSync, readFileSync, existsSync, statSync } from 'fs';
import { parseJsonl } from '../utils/parse-jsonl.js';
export class TraceCollector {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    /**
     * Determine auto review status based on trace quality signals.
     */
    autoReviewStatus(input) {
        if (input.retryCount > 1)
            return 'pending';
        if (input.qualityScore !== undefined && input.qualityScore < 0.6)
            return 'pending';
        if (input.outcome === 'failure')
            return 'pending';
        return 'approved';
    }
    /**
     * Auto-generate tags based on trace characteristics.
     */
    autoTag(input) {
        const tags = [];
        if (input.retryCount > 1)
            tags.push('high-retry');
        if (input.outcome === 'failure')
            tags.push('failure');
        if (input.outcome === 'timeout')
            tags.push('timeout');
        return tags;
    }
    /**
     * Record a trace, auto-generating traceId, capturedAt, reviewStatus, and tags.
     */
    record(input) {
        const trace = {
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
        // Defensive serialization — agent outputs may contain circular references
        // or BigInt; without this guard the writer crashes mid-trace.
        let serialized;
        try {
            serialized = JSON.stringify(trace);
        }
        catch {
            serialized = JSON.stringify({
                traceId: trace.traceId,
                agentSlug: trace.agentSlug,
                capturedAt: trace.capturedAt,
                reviewStatus: trace.reviewStatus,
                outcome: 'serialize_failed',
            });
        }
        appendFileSync(this.filePath, serialized + '\n', 'utf-8');
        return trace;
    }
    /**
     * Read all traces from the JSONL file.
     */
    readAll() {
        if (!existsSync(this.filePath))
            return [];
        const stat = statSync(this.filePath);
        if (stat.size > 256 * 1024 * 1024) {
            throw new Error(`Trace file exceeds 256MB (${stat.size} bytes). Run rotation/cleanup.`);
        }
        const content = readFileSync(this.filePath, 'utf-8').trim();
        if (!content)
            return [];
        return parseJsonl(content);
    }
    /**
     * Get traces pending review, with optional limit.
     */
    getTracesPendingReview(limit) {
        const all = this.readAll().filter((t) => t.reviewStatus === 'pending');
        if (limit !== undefined)
            return all.slice(0, limit);
        return all;
    }
}
//# sourceMappingURL=trace-collector.js.map