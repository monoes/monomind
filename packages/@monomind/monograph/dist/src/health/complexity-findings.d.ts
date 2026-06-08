export type FindingSeverity = 'moderate' | 'high' | 'critical';
export type ExceededThreshold = 'cyclomatic' | 'cognitive' | 'both' | 'crap' | 'cyclomaticCrap' | 'cognitiveCrap' | 'all';
export type CoverageModel = 'staticBinary' | 'staticEstimated' | 'istanbul';
export type CoverageTier = 'none' | 'partial' | 'high';
export declare function coverageTierFromPct(pct: number): CoverageTier;
export interface HealthFinding {
    functionName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    cyclomatic: number;
    cognitive: number;
    crapScore: number;
    coveragePct: number;
    coverageTier: CoverageTier;
    severity: FindingSeverity;
    exceeded: ExceededThreshold;
    maintainabilityIndex: number;
}
export interface HealthSummary {
    totalFunctions: number;
    moderateCount: number;
    highCount: number;
    criticalCount: number;
    averageCrapScore: number;
    istanbulCoverageAvailable: boolean;
    coverageModel: CoverageModel;
    thresholdCyclomaticHigh: number;
    thresholdCyclomaticCritical: number;
    thresholdCognitiveHigh: number;
    thresholdCognitiveCritical: number;
    thresholdCrapHigh: number;
    thresholdCrapCritical: number;
}
export interface FileHealthScore {
    filePath: string;
    maintainabilityIndex: number;
    crapScore: number;
    fanIn: number;
    fanOut: number;
    severity: FindingSeverity | 'ok';
    findings: HealthFinding[];
}
export declare const DEFAULT_CYCLOMATIC_HIGH = 10;
export declare const DEFAULT_CYCLOMATIC_CRITICAL = 20;
export declare const DEFAULT_COGNITIVE_HIGH = 15;
export declare const DEFAULT_COGNITIVE_CRITICAL = 30;
export declare const DEFAULT_CRAP_HIGH = 30;
export declare const DEFAULT_CRAP_CRITICAL = 100;
export declare const COGNITIVE_EXTRACTION_THRESHOLD = 5;
export declare function classifyFindingSeverity(cyclomatic: number, cognitive: number, crap: number, opts?: {
    cyclomaticHigh?: number;
    cyclomaticCritical?: number;
    cognitiveHigh?: number;
    cognitiveCritical?: number;
    crapHigh?: number;
    crapCritical?: number;
}): FindingSeverity;
export declare function summarizeFindings(findings: HealthFinding[]): HealthSummary;
//# sourceMappingURL=complexity-findings.d.ts.map