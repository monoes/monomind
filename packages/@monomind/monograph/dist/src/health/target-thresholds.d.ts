export type ExtendedRecommendationCategory = 'UrgentChurnComplexity' | 'BreakCircularDependency' | 'SplitHighImpact' | 'RemoveDeadCode' | 'ExtractComplexFunctions' | 'ExtractDependencies' | 'AddTestCoverage' | 'ReduceFanIn' | 'ReduceFanOut' | 'SplitLargeFile' | 'ExtractModule';
export interface CategoryMeta {
    label: string;
    compactLabel: string;
    priority: number;
}
export declare const RECOMMENDATION_CATEGORIES: Record<ExtendedRecommendationCategory, CategoryMeta>;
export interface TargetThresholds {
    fanInP95: number;
    fanInP75: number;
    fanOutP95: number;
    fanOutP90: number;
    complexityP90: number;
    locP90: number;
    churnP75: number;
}
export interface MetricSample {
    fanIn: number[];
    fanOut: number[];
    complexity: number[];
    loc: number[];
    churnScore: number[];
}
export declare function computeTargetThresholds(sample: MetricSample): TargetThresholds;
export declare function labelForCategory(cat: ExtendedRecommendationCategory): string;
export declare function compactLabelForCategory(cat: ExtendedRecommendationCategory): string;
//# sourceMappingURL=target-thresholds.d.ts.map