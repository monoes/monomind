export interface AnalysisCounts {
    totalExports: number;
    deadFiles: number;
    deadExports: number;
    unusedDeps: number;
    circularDeps: number;
    totalDeps: number;
    duplicateExports: number;
    boundaryViolations: number;
}
export declare const ZERO_ANALYSIS_COUNTS: AnalysisCounts;
export interface AnalysisResultsInput {
    unusedExports?: unknown[];
    deadFiles?: unknown[];
    unusedDependencies?: unknown[];
    circularDependencies?: unknown[];
    allDependencies?: unknown[];
    duplicateExports?: unknown[];
    boundaryViolations?: unknown[];
}
/** Compute aggregate counts from analysis results (all fields optional). */
export declare function computeAnalysisCounts(results: AnalysisResultsInput): AnalysisCounts;
/** Compute percentages from counts for use in vital signs. */
export declare function deadCodePct(counts: AnalysisCounts): number;
export declare function unusedDepsPct(counts: AnalysisCounts): number;
export declare function formatAnalysisCounts(counts: AnalysisCounts): string;
//# sourceMappingURL=analysis-counts.d.ts.map