export type TrendDirection = 'improving' | 'declining' | 'stable';
export declare function trendArrow(d: TrendDirection): string;
export declare function trendColor(d: TrendDirection): string;
export interface TrendCount {
    value: number;
    total: number;
}
export interface TrendMetric {
    name: string;
    label: string;
    previous: number;
    current: number;
    delta: number;
    direction: TrendDirection;
    unit: string;
    previousCount?: TrendCount;
    currentCount?: TrendCount;
}
export interface TrendPoint {
    timestamp: string;
    gitSha?: string;
    score?: number;
    grade?: string;
    coverageModel?: string;
    snapshotSchemaVersion?: number;
}
export interface HealthTrend {
    comparedTo: TrendPoint;
    metrics: TrendMetric[];
    snapshotsLoaded: number;
    overallDirection: TrendDirection;
}
export declare function computeOverallDirection(metrics: TrendMetric[]): TrendDirection;
export declare function formatTrendMetric(m: TrendMetric): string;
//# sourceMappingURL=trend-types.d.ts.map