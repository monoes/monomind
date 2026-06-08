export interface FileScoreOutput {
    complexityModerate: number;
    complexityHigh: number;
    complexityCritical: number;
    crapModerate: number;
    crapHigh: number;
    crapCritical: number;
    functionCount: number;
    fileLoc: number;
}
export interface AnalysisCountsSnapshot {
    counts: Map<string, FileScoreOutput>;
}
export declare function buildAnalysisCountsSnapshot(fileScores: Array<{
    filePath: string;
} & FileScoreOutput>): AnalysisCountsSnapshot;
export declare function countsFor(snapshot: AnalysisCountsSnapshot, roots: string[]): AnalysisCountsSnapshot;
export declare function serializeSnapshot(snapshot: AnalysisCountsSnapshot): Record<string, FileScoreOutput>;
export declare function deserializeSnapshot(data: Record<string, FileScoreOutput>): AnalysisCountsSnapshot;
//# sourceMappingURL=analysis-counts-snapshot.d.ts.map