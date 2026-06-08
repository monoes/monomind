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
//# sourceMappingURL=risk-profile.d.ts.map