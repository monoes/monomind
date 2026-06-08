export interface DistributionThresholds {
    fanInP95: number;
    fanInP75: number;
    fanInP25: number;
    fanOutP95: number;
    fanOutP90: number;
}
export declare const THRESHOLD_FLOORS: DistributionThresholds;
export interface FileTopologyScore {
    fanIn: number;
    fanOut: number;
}
/** Compute distribution thresholds from an array of per-file topology scores. */
export declare function computeDistributionThresholds(scores: FileTopologyScore[]): DistributionThresholds;
export declare function formatDistributionThresholds(t: DistributionThresholds): string;
//# sourceMappingURL=distribution-thresholds.d.ts.map