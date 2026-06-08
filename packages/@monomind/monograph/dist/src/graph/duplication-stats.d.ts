export interface DuplicationStats {
    totalFiles: number;
    filesWithClones: number;
    totalLines: number;
    duplicatedLines: number;
    totalTokens: number;
    duplicatedTokens: number;
    cloneGroups: number;
    cloneInstances: number;
    duplicationPct: number;
}
export interface CloneGroupInput {
    instances: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
        tokenCount?: number;
    }>;
}
export declare function computeDuplicationStats(groups: CloneGroupInput[], allFilePaths: string[], totalLines: number, totalTokens: number): DuplicationStats;
export declare function formatDuplicationStats(stats: DuplicationStats): string;
//# sourceMappingURL=duplication-stats.d.ts.map