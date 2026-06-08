export interface CompactHealthFinding {
    path: string;
    line: number;
    name: string;
    cyclomatic: number;
    cognitive: number;
    severity: string;
    crap?: number;
    coveragePct?: number;
}
export interface CompactHotspot {
    path: string;
    score: number;
    commits: number;
    linesAdded: number;
    linesDeleted: number;
    complexityDensity: number;
    fanIn: number;
    trend: string;
}
export interface CompactHealthScore {
    score: number;
    grade: string;
}
export interface CompactVitalSigns {
    totalLoc?: number;
    avgCyclomatic: number;
    p90Cyclomatic: number;
    deadFilePct?: number;
    deadExportPct?: number;
    maintainabilityAvg?: number;
    hotspotCount?: number;
    circularDepCount?: number;
    unusedDepCount?: number;
}
export interface CompactHealthTrend {
    overallDirection: string;
    metrics: Array<{
        name: string;
        previous: number;
        current: number;
        delta: number;
        direction: string;
    }>;
}
export interface CompactHealthReport {
    root: string;
    healthScore?: CompactHealthScore;
    vitalSigns?: CompactVitalSigns;
    findings?: CompactHealthFinding[];
    hotspots?: CompactHotspot[];
    healthTrend?: CompactHealthTrend;
}
export interface CompactCloneGroup {
    instances: Array<{
        file: string;
        startLine: number;
        endLine: number;
        tokenCount?: number;
    }>;
}
export interface CompactDuplicationReport {
    root: string;
    cloneGroups: CompactCloneGroup[];
}
export declare function buildHealthCompactLines(report: CompactHealthReport): string[];
export declare function buildDuplicationCompactLines(report: CompactDuplicationReport): string[];
//# sourceMappingURL=compact-health.d.ts.map