export type RuntimeCoverageVerdict = 'SafeToDelete' | 'ReviewRequired' | 'CoverageUnavailable' | 'LowTraffic' | 'Active' | 'Unknown';
export type RuntimeCoverageRiskBand = 'Critical' | 'High' | 'Medium' | 'Low';
export type RuntimeCoverageAction = 'Delete' | 'Review' | 'Keep' | 'Monitor';
export interface RuntimeSignal {
    filePath: string;
    requestsPerDay?: number;
    lastSeenDaysAgo?: number;
}
export interface RuntimeCoverageReportVerdict {
    path: string;
    staticVerdict: 'unused' | 'used' | 'unknown';
    runtimeVerdict: RuntimeCoverageVerdict;
    riskBand: RuntimeCoverageRiskBand;
    recommendedAction: RuntimeCoverageAction;
}
export declare function classifyRuntimeVerdict(signal: RuntimeSignal | undefined): RuntimeCoverageVerdict;
export declare function classifyRiskBand(staticVerdict: string, runtimeVerdict: RuntimeCoverageVerdict): RuntimeCoverageRiskBand;
export declare function recommendAction(riskBand: RuntimeCoverageRiskBand, runtimeVerdict: RuntimeCoverageVerdict): RuntimeCoverageAction;
export declare function classifyRuntimeCoverage(path: string, staticVerdict: 'unused' | 'used' | 'unknown', signal?: RuntimeSignal): RuntimeCoverageReportVerdict;
//# sourceMappingURL=runtime-coverage.d.ts.map