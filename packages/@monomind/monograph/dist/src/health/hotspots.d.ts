import type { ChurnResult } from '../analysis/churn.js';
export interface HotspotEntry {
    path: string;
    score: number;
    weightedCommits: number;
    complexityDensity: number;
    rank: number;
}
export interface HotspotSummary {
    count: number;
    topScore: number;
    meanScore: number;
}
export declare function isTestPath(path: string): boolean;
export declare function normalizeValue(value: number, max: number): number;
export declare function computeHotspotScore(weightedCommits: number, maxWeighted: number, density: number, maxDensity: number): number;
export declare function computeHotspots(churnResult: ChurnResult, complexityMap: Map<string, number>, minCommits?: number): {
    entries: HotspotEntry[];
    summary: HotspotSummary;
};
//# sourceMappingURL=hotspots.d.ts.map