import type { ExceededThreshold, FindingSeverity } from './scores.js';
import type { TrendDirection, TrendMetric, TrendPoint } from './trend-types.js';
export type HealthGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';
export declare const HOTSPOT_SCORE_THRESHOLD = 50;
export declare function letterGrade(score: number): HealthGradeLetter;
export interface HealthScorePenalties {
    complexity: number;
    duplication: number;
    deadCode: number;
    coupling: number;
    maintainability: number;
}
export interface HealthScore {
    score: number;
    grade: HealthGradeLetter;
    penalties: HealthScorePenalties;
}
export interface HealthFinding {
    path: string;
    name: string;
    line?: number;
    col?: number;
    cyclomatic?: number;
    cognitive?: number;
    lineCount?: number;
    paramCount?: number;
    exceeded?: ExceededThreshold;
    severity?: FindingSeverity;
    crap?: number;
    coveragePct?: number;
}
export interface FileScore {
    path: string;
    maintainabilityIndex?: number;
    fanIn?: number;
    fanOut?: number;
    deadCodeRatio?: number;
    complexityDensity?: number;
    crapMax?: number;
    crapAboveThreshold?: number;
}
export interface UnitSizeProfile {
    tiny: number;
    small: number;
    medium: number;
    large: number;
    huge: number;
}
export interface IssueCounts {
    unusedFiles: number;
    unusedExports: number;
    unusedTypes: number;
    privateTypeLeaks: number;
    unusedDependencies: number;
    unresolvedImports: number;
    circularDependencies: number;
    boundaryViolations: number;
}
export interface VitalSigns {
    deadFilePct: number;
    deadExportPct: number;
    avgCyclomatic: number;
    p90Cyclomatic: number;
    duplicationPct: number;
    hotspotCount: number;
    maintainabilityAvg: number;
    unusedDepCount: number;
    circularDepCount: number;
    counts: IssueCounts;
    unitSizeProfile: UnitSizeProfile;
    couplingHighPct: number;
}
export interface RuntimeCoverageEvidence {
    triggeredFiles: number;
    totalFiles: number;
    pct: number;
}
export type RuntimeCoverageVerdict = 'Sufficient' | 'Low' | 'Missing' | 'Unknown';
export interface RuntimeCoverageSummary {
    verdict: RuntimeCoverageVerdict;
    evidence?: RuntimeCoverageEvidence;
    message?: string;
}
export interface HealthTrend {
    comparedTo: TrendPoint;
    metrics: TrendMetric[];
    overallDirection: TrendDirection;
}
export interface HealthReport {
    score: HealthScore;
    findings: HealthFinding[];
    fileScores: FileScore[];
    vitalSigns?: VitalSigns;
    hotspots: HealthFinding[];
    trend?: HealthTrend;
    runtimeCoverage?: RuntimeCoverageSummary;
    generatedAt: string;
    root: string;
}
export declare function makeHealthScore(score: number, penalties?: Partial<HealthScorePenalties>): HealthScore;
export declare function computeVitalSigns(partial: Partial<VitalSigns>): VitalSigns;
export declare function formatVitalSigns(vs: VitalSigns): string[];
//# sourceMappingURL=health-report-types.d.ts.map