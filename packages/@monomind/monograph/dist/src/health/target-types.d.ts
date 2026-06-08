export interface TargetThresholds {
    fanInP95: number;
    fanInP75: number;
    fanInP25: number;
    fanOutP95: number;
    fanOutP90: number;
}
export type RecommendationCategory = 'UrgentChurnComplexity' | 'BreakCircularDependency' | 'SplitHighImpact' | 'RemoveDeadCode' | 'ExtractComplexFunctions' | 'ExtractDependencies' | 'AddTestCoverage';
export type ContributingFactor = 'HighChurn' | 'HighComplexity' | 'HighFanIn' | 'HighFanOut' | 'InCycle' | 'HasDeadCode' | 'LowCoverage' | 'HeavyDependencies';
export type EffortEstimate = 'Low' | 'Medium' | 'High' | 'VeryHigh';
export type Confidence = 'Low' | 'Medium' | 'High';
export interface RefactoringTarget {
    filePath: string;
    category: RecommendationCategory;
    priority: number;
    confidence: Confidence;
    effort: EffortEstimate;
    factors: ContributingFactor[];
    description: string;
    estimatedLines?: number;
}
export declare function computeEffortFromLines(lines: number): EffortEstimate;
export declare function computeConfidenceFromFactors(factorCount: number): Confidence;
//# sourceMappingURL=target-types.d.ts.map