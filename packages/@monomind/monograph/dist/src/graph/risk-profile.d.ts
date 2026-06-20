import type { MonographDb } from '../storage/db.js';
export interface SizeBin {
    label: string;
    min: number;
    max: number;
    count: number;
    percentage: number;
}
export interface RiskProfileReport {
    functionSizeDistribution: SizeBin[];
    paramCountDistribution: SizeBin[];
    riskSummary: {
        largeFunction: number;
        longParamList: number;
        highRisk: number;
    };
    p50loc: number;
    p90loc: number;
    p95loc: number;
}
export declare function computeRiskProfile(db: MonographDb): RiskProfileReport;
/**
 * Format a RiskProfileReport as structured text with distribution tables for LLM navigation.
 *
 * @param report - RiskProfileReport from computeRiskProfile()
 * @returns structured text suitable for LLM consumption
 */
export declare function formatRiskProfile(report: RiskProfileReport): string;
//# sourceMappingURL=risk-profile.d.ts.map