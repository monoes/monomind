export interface RiskProfile {
    low: number;
    medium: number;
    high: number;
    veryHigh: number;
}
export declare function computeSizeRiskProfile(lineCounts: number[]): RiskProfile;
export declare function computeInterfacingRiskProfile(paramCounts: number[]): RiskProfile;
export declare function computeCouplingConcentration(fanInScores: number[]): {
    p95: number;
    highPct: number;
};
//# sourceMappingURL=risk-profile.d.ts.map