export type AnalysisEffort = 'low' | 'medium' | 'high';
export interface EffortProfile {
    runChurn: boolean;
    runOwnership: boolean;
    runHotspots: boolean;
    runFileScores: boolean;
    runSuffixArray: boolean;
    runCrossReference: boolean;
    maxFilesForExpensiveAnalysis: number;
}
export declare function getEffortProfile(effort?: AnalysisEffort): EffortProfile;
export declare function parseEffort(s: string): AnalysisEffort;
//# sourceMappingURL=effort.d.ts.map