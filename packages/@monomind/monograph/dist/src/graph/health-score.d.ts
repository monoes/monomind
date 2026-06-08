import type Database from 'better-sqlite3';
export interface HealthScorePenalties {
    unreachableFilePct: number;
    godNodePct: number;
    circularEdgePct: number;
    hotspotPct: number;
    isolatedNodePct: number;
    crossCommunityEdgePct: number;
}
export interface HealthScoreResult {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    penalties: HealthScorePenalties;
    summary: string;
}
export declare function letterGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F';
export declare function computeHealthScore(db: Database.Database): HealthScoreResult;
//# sourceMappingURL=health-score.d.ts.map