export type CoverageTier = 'none' | 'partial' | 'high';
export declare const HIGH_COVERAGE_WATERMARK = 70;
export declare function coverageTierFromPct(pct: number): CoverageTier;
export type ExceededThreshold = 'cyclomatic' | 'cognitive' | 'both' | 'crap' | 'cyclomatic_crap' | 'cognitive_crap' | 'all';
export declare function exceededThresholdFromBools(cyclomatic: boolean, cognitive: boolean, crap: boolean): ExceededThreshold;
export declare function includesCyclomatic(t: ExceededThreshold): boolean;
export declare function includesCognitive(t: ExceededThreshold): boolean;
export declare function includesCrap(t: ExceededThreshold): boolean;
export type FindingSeverity = 'moderate' | 'high' | 'critical';
export declare const DEFAULT_CRAP_HIGH = 50;
export declare const DEFAULT_CRAP_CRITICAL = 100;
export declare const DEFAULT_COGNITIVE_HIGH = 25;
export declare const DEFAULT_COGNITIVE_CRITICAL = 40;
export declare const DEFAULT_CYCLOMATIC_HIGH = 30;
export declare const DEFAULT_CYCLOMATIC_CRITICAL = 50;
export interface FindingSeverityOpts {
    cognitive: number;
    cyclomatic: number;
    crap?: number;
    cognitiveHigh?: number;
    cognitiveCritical?: number;
    cyclomaticHigh?: number;
    cyclomaticCritical?: number;
}
export declare function computeFindingSeverity(opts: FindingSeverityOpts): FindingSeverity;
//# sourceMappingURL=scores.d.ts.map