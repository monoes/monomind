export type ChurnTrend = 'accelerating' | 'stable' | 'cooling';
export declare function computeChurnTrend(timestampsEpochSec: number[]): ChurnTrend;
export declare function churnTrendLabel(trend: ChurnTrend): string;
export declare function churnTrendFromFileSeries(fileTimestamps: number[][]): ChurnTrend;
//# sourceMappingURL=churn-trend.d.ts.map