/**
 * Agent Specialization Scorer (Task 39)
 *
 * JSONL-based per-agent-per-task-type scoring with time-decay.
 * Enables monomind to prefer historically successful agents for specific task types.
 */
import type { SpecializationScore, ScoreUpdate } from '../../../shared/src/types/specialization.js';
/**
 * JSONL-based specialization scorer.
 *
 * Stores one JSON object per line in the configured file path.
 * Each line represents a SpecializationScore for a unique agent+taskType pair.
 * On update, the entire file is rewritten to maintain a single record per pair.
 */
export declare class SpecializationScorer {
    private readonly filePath;
    constructor(filePath: string);
    private readAll;
    private writeAll;
    /**
     * Record an outcome for a given agent+taskType pair.
     *
     * Updates running averages for latency and quality, recalculates
     * successRate, applies time-decay, and persists the result.
     */
    recordOutcome(update: ScoreUpdate): SpecializationScore;
    /**
     * Get the score for a specific agent+taskType pair, or null if not found.
     * Recalculates decay on read.
     */
    getScore(agentSlug: string, taskType: string): SpecializationScore | null;
    /**
     * Get top N candidates for a task type from the given list of slugs,
     * sorted by effectiveScore descending.
     */
    getTopCandidates(taskType: string, slugs: string[], topN?: number): SpecializationScore[];
    /**
     * Return the best candidate slug for a task type.
     * Falls back to the first candidate if no scores exist.
     */
    topCandidate(taskType: string, candidates: string[]): string;
    /**
     * Get all scores for a given agent across all task types.
     */
    getAllScores(agentSlug: string): SpecializationScore[];
    /**
     * Reset scores for an agent. If taskType is provided, only that
     * pair is removed; otherwise all scores for the agent are removed.
     *
     * @returns The number of records deleted.
     */
    resetScores(agentSlug: string, taskType?: string): number;
}
//# sourceMappingURL=specialization-scorer.d.ts.map