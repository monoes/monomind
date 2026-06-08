import type { HealthScore, VitalSigns, VitalSignsSnapshot } from './vital-signs-snapshot.js';
export type TrendDirection = 'improving' | 'declining' | 'stable';
export declare const STABLE_BAND = 0.5;
export interface TrendMetric {
    current: number;
    previous: number;
    delta: number;
    direction: TrendDirection;
}
export interface TrendCount {
    current: number;
    previous: number;
    delta: number;
    direction: TrendDirection;
}
export interface HealthTrend {
    healthScore: TrendMetric;
    deadCodePct: TrendMetric;
    duplicationPct: TrendMetric;
    complexityHighPct: TrendMetric;
    complexityCriticalPct: TrendMetric;
    hotspotDensity: TrendMetric;
    busFactor: TrendCount;
    unusedDepsPct: TrendMetric;
    maintainabilityIndex: TrendMetric;
}
export declare function trendDirection(current: number, previous: number, isHigherBetter?: boolean): TrendDirection;
export declare function makeTrendMetric(current: number, previous: number, isHigherBetter?: boolean): TrendMetric;
export declare function computeTrend(current: VitalSigns, currentScore: HealthScore, previous: VitalSignsSnapshot): HealthTrend;
//# sourceMappingURL=trends.d.ts.map