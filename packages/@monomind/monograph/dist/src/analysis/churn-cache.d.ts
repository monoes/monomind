export interface CachedCommitEvent {
    timestamp: number;
    linesAdded: number;
    linesDeleted: number;
    authorIdx: number | null;
}
export interface CachedFileChurn {
    path: string;
    events: CachedCommitEvent[];
}
export interface ChurnCache {
    version: number;
    lastIndexedSha: string;
    gitAfter: string;
    files: CachedFileChurn[];
    shallowClone: boolean;
    authorPool: string[];
}
export interface CachedChurnResult {
    files: Map<string, {
        commits: number;
        linesAdded: number;
        linesDeleted: number;
        weightedCommits: number;
    }>;
    shallowClone: boolean;
    authorPool: string[];
    cacheHit: boolean;
}
export declare function analyzeChurnCached(root: string, gitAfter: string, cacheDir: string, noCache?: boolean): CachedChurnResult | null;
//# sourceMappingURL=churn-cache.d.ts.map