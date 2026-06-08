import type Database from 'better-sqlite3';
export interface HotspotResult {
    nodeId: string;
    nodeName: string;
    filePath: string;
    label: string;
    communityId: number | null;
    /** Recency-weighted commit count (exponential decay, half-life 90 days) */
    churnScore: number;
    /** Raw commit count in the analysis window */
    rawCommitCount: number;
    /** Graph centrality: in+out degree */
    centralityScore: number;
    /** Combined hotspot score: churnScore * centralityScore */
    hotspotScore: number;
    /** Trend based on recent vs older half of window */
    trend: 'accelerating' | 'stable' | 'cooling';
    /** Last commit date for this file */
    lastCommitDate: string | null;
}
/**
 * Compute hotspot scores for all file nodes in the graph.
 * Combines recency-weighted git churn (half-life 90 days) with
 * graph centrality (in+out degree) to identify high-risk files.
 *
 * @param db - monograph database
 * @param projectDir - repo root (for git log)
 * @param options.windowDays - git log window (default 365)
 * @param options.limit - max results (default 20)
 * @param options.minCommits - filter files with fewer commits (default 2)
 */
export declare function computeHotspots(db: Database.Database, projectDir: string, options?: {
    windowDays?: number;
    limit?: number;
    minCommits?: number;
}): HotspotResult[];
//# sourceMappingURL=hotspots.d.ts.map