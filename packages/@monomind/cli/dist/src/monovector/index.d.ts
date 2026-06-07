/**
 * MonoVector Integration Module for Monomind CLI (lean)
 *
 * After the SONA / native / WASM teardown this module provides:
 * - Initialization state: createInitState()
 * - Keyword-based task routing: createKeywordRouter()
 * - Route recommendation→outcome records: recordRoute(), joinOutcome(), accuracy
 * - AST diff classification: DiffClassifier
 *
 * @module @monomind/cli/monovector
 */
export { createInitState, type InitState, type InitStatus } from './init-state.js';
export { recordRoute, joinOutcome, joinLatestUnresolved, readOutcomes, computeRoutingAccuracy, computeAdherence, type RouteOutcomeRecord, type RoutingAccuracy, } from './route-outcomes.js';
export { DiffClassifier, createDiffClassifier, analyzeDiff, analyzeDiffSync, assessFileRisk, assessOverallRisk, classifyDiff, suggestReviewers, getGitDiffNumstat, getGitDiffNumstatAsync, clearDiffCache, clearAllDiffCaches, type DiffClassification, type DiffHunk, type DiffChange, type FileDiff, type DiffAnalysis, type DiffClassifierConfig, type DiffFile, type RiskLevel, type FileRisk, type OverallRisk, type DiffAnalysisResult, } from './diff-classifier.js';
/** A single alternative route suggestion. */
export interface RouteAlternative {
    route: string;
    score?: number;
}
/** Statistics surfaced by the keyword router (stub fields for CLI display). */
export interface KeywordRouterStats {
    updateCount: number;
    qTableSize: number;
    stepCount: number;
    epsilon: number;
    avgTDError: number;
    useNative: number;
    [key: string]: unknown;
}
export interface KeywordRouter {
    route: (task: string, useExploration?: boolean) => Promise<RouteDecision>;
    initialize: () => Promise<void>;
    getStats: () => KeywordRouterStats;
    /** Record feedback; returns the TD-error (0 in the lean keyword stub). */
    update: (task: string, agentId: string, reward: number, nextTask?: string) => number;
    reset: () => void;
    export: () => unknown;
    import: (data: unknown) => void;
}
export interface RouteDecision {
    agentType: string;
    confidence: number;
    reasoning?: string;
    route: string;
    qValues?: number[];
    explored?: boolean;
    alternatives?: RouteAlternative[];
}
export interface KeywordRouterConfig {
    learningRate?: number;
    discountFactor?: number;
}
export declare function createKeywordRouter(_config?: KeywordRouterConfig): KeywordRouter;
//# sourceMappingURL=index.d.ts.map