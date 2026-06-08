import type { MonographDb } from '../storage/db.js';
export type RecommendationCategory = 'UrgentChurnComplexity' | 'BreakCircularDependency' | 'SplitHighImpact' | 'RemoveDeadCode' | 'ExtractComplexFunctions' | 'ExtractDependencies' | 'AddTestCoverage';
export type EffortEstimate = 'Low' | 'Medium' | 'High';
export type TargetConfidence = 'High' | 'Medium' | 'Low';
export interface RefactoringTarget {
    nodeId: string;
    filePath: string;
    priorityScore: number;
    efficiency: number;
    category: RecommendationCategory;
    effort: EffortEstimate;
    confidence: TargetConfidence;
    evidence: string[];
}
export interface RefactoringTargetsResult {
    targets: RefactoringTarget[];
    totalAnalyzed: number;
}
export declare function computeRefactoringTargets(db: MonographDb): RefactoringTargetsResult;
export interface ContributingFactor {
    metric: string;
    value: number;
    threshold: number;
    detail: string;
}
export interface EvidenceFunction {
    name: string;
    startLine: number;
    cognitiveComplexity: number;
}
export interface TargetEvidence {
    unusedExportsCount: number;
    complexFunctions: EvidenceFunction[];
    cyclePath: string[];
    contributingFactors: ContributingFactor[];
}
export interface PriorityRule {
    name: string;
    description: string;
    weight: number;
    /** Returns a 0-1 score contribution or null if the rule doesn't apply. */
    evaluate: (factors: Record<string, number>) => number | null;
}
export declare const PRIORITY_RULE_WEIGHTS: {
    readonly densityWeight: 30;
    readonly hotspotWeight: 25;
    readonly deadCodeWeight: 20;
    readonly fanInWeight: 15;
    readonly fanOutWeight: 10;
};
/** Normalize a raw metric value against a threshold to a 0-1 score. */
export declare function normalizeMetric(value: number, threshold: number): number;
/** Compute a 0-100 composite priority score for a refactoring target. */
export declare function computeTargetPriority(factors: {
    densityScore: number;
    hotspotScore: number;
    deadCodeScore: number;
    fanInRaw: number;
    fanOutRaw: number;
    fanInThreshold: number;
    fanOutThreshold: number;
}): number;
/** Apply named priority rules in priority order, returning the first match's score or null. */
export declare function tryMatchPriorityRules(rules: PriorityRule[], factors: Record<string, number>): {
    rule: PriorityRule;
    score: number;
} | null;
//# sourceMappingURL=targets.d.ts.map