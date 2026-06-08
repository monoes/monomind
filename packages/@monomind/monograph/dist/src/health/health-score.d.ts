export declare const HOTSPOT_SCORE_THRESHOLD = 50;
export declare const MI_DENSITY_MIN_LINES = 50;
export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export interface HealthScorePenalties {
    deadCode: number;
    duplication: number;
    complexityHigh: number;
    complexityCritical: number;
    crapHigh: number;
    crapCritical: number;
    hotspotDensity: number;
    couplingConcentration: number;
    busFactor: number;
    largeFunctions: number;
    unusedDeps: number;
}
export interface HealthScore {
    value: number;
    grade: HealthGrade;
    penalties: HealthScorePenalties;
}
export interface VitalSignsInput {
    deadCodePct: number;
    duplicationPct: number;
    complexityHighPct: number;
    complexityCriticalPct: number;
    crapHighPct: number;
    crapCriticalPct: number;
    hotspotDensity: number;
    couplingHighPct: number;
    busFactorRisk: number;
    largeFunctionsPct: number;
    unusedDepCount: number;
}
export declare function computeHealthScore(vs: VitalSignsInput, totalFiles: number): HealthScore;
export declare function letterGradeFromScore(score: number): HealthGrade;
//# sourceMappingURL=health-score.d.ts.map