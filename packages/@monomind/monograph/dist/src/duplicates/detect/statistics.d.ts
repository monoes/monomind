import type { RawGroup } from './extraction.js';
export interface PipelineDuplicationStats {
    totalFiles: number;
    filesWithClones: number;
    totalTokens: number;
    duplicatedTokens: number;
    totalLines: number;
    duplicatedLines: number;
    cloneGroups: number;
    cloneInstances: number;
    duplicationPct: number;
}
export declare function computePipelineStats(groups: RawGroup[], allFileIds: number[], totalTokens: number, totalLines: number, fileLineCount: (fileId: number, offset: number, length: number) => number): PipelineDuplicationStats;
//# sourceMappingURL=statistics.d.ts.map