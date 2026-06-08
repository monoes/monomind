export interface QualityGateConfig {
    minScore?: number;
    failOnRegression?: boolean;
}
export type QualityGateStatus = 'pass' | 'fail' | 'warn';
export interface QualityGateResult {
    status: QualityGateStatus;
    score: number;
    minScore?: number;
    failures: string[];
    warnings: string[];
}
export declare function evaluateQualityGate(score: number, grade: string, gate: QualityGateConfig, regressions?: Array<{
    metric: string;
    baseline: number;
    current: number;
}>): QualityGateResult;
export declare function formatQualityGateResult(result: QualityGateResult): string;
//# sourceMappingURL=quality-gate.d.ts.map