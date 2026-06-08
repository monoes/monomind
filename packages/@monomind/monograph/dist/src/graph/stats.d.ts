import type Database from 'better-sqlite3';
export type RiskBin = 'low' | 'medium' | 'high' | 'critical';
export interface RiskProfile {
    low: number;
    medium: number;
    high: number;
    critical: number;
    lowPct: number;
    mediumPct: number;
    highPct: number;
    criticalPct: number;
}
export interface CouplingProfile {
    p50FanIn: number;
    p75FanIn: number;
    p90FanIn: number;
    p95FanIn: number;
    couplingHighPct: number;
    fanInProfile: RiskProfile;
    fanOutProfile: RiskProfile;
    totalFiles: number;
}
export interface GraphStatsSummary {
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
    fileCount: number;
    couplingProfile: CouplingProfile;
}
/**
 * Compute full coupling profile from SQLite.
 */
export declare function computeCouplingProfile(db: Database.Database): CouplingProfile;
/**
 * Quick stats summary (extends existing stats from monograph_stats MCP tool).
 */
export declare function computeGraphStats(db: Database.Database): GraphStatsSummary;
//# sourceMappingURL=stats.d.ts.map