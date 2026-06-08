export type ChurnTrend = 'accelerating' | 'stable' | 'cooling';
export interface SinceDuration {
    raw: string;
    days: number;
}
export interface AuthorContribution {
    authorIdx: number;
    weightedCommits: number;
}
export interface FileChurn {
    path: string;
    totalCommits: number;
    weightedCommits: number;
    authors: AuthorContribution[];
    trend: ChurnTrend;
}
export interface ChurnResult {
    files: FileChurn[];
    authorPool: string[];
    since: SinceDuration;
}
export declare function parseSince(s: string): SinceDuration;
export declare function computeRecencyWeight(ageDays: number): number;
export declare function classifyChurnTrend(recentWeighted: number, olderWeighted: number): ChurnTrend;
export declare function analyzeChurn(root: string, since: SinceDuration | string): Promise<ChurnResult>;
//# sourceMappingURL=churn.d.ts.map