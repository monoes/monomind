export interface HealthFileCounts {
    complexityModerate: number;
    complexityHigh: number;
    complexityCritical: number;
    crapModerate: number;
    crapHigh: number;
    crapCritical: number;
}
export interface HealthBaselineData {
    counts: Map<string, HealthFileCounts>;
}
export interface HealthFinding {
    filePath: string;
    kind: 'complexity_moderate' | 'complexity_high' | 'complexity_critical' | 'crap_moderate' | 'crap_high' | 'crap_critical';
    functionName?: string;
    line?: number;
}
export declare function buildHealthBaseline(findings: HealthFinding[], root: string): HealthBaselineData;
export declare function filterNewHealthFindings(current: HealthFinding[], baseline: HealthBaselineData, root: string): HealthFinding[];
//# sourceMappingURL=health-baseline.d.ts.map