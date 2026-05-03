import type { HealthScore, VitalSigns, VitalSignsSnapshot } from './vital-signs-snapshot.js';

export type TrendDirection = 'improving' | 'declining' | 'stable';
export const STABLE_BAND = 0.5;

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

export function trendDirection(
  current: number,
  previous: number,
  isHigherBetter = false
): TrendDirection {
  const delta = current - previous;
  if (Math.abs(delta) <= STABLE_BAND) {
    return 'stable';
  }
  if (isHigherBetter) {
    return delta > 0 ? 'improving' : 'declining';
  }
  return delta < 0 ? 'improving' : 'declining';
}

export function makeTrendMetric(
  current: number,
  previous: number,
  isHigherBetter = false
): TrendMetric {
  return {
    current,
    previous,
    delta: current - previous,
    direction: trendDirection(current, previous, isHigherBetter),
  };
}

export function computeTrend(
  current: VitalSigns,
  currentScore: HealthScore,
  previous: VitalSignsSnapshot
): HealthTrend {
  const prev = previous.vitalSigns;
  const prevScore = previous.healthScore;
  return {
    healthScore: makeTrendMetric(currentScore.value, prevScore.value, true),
    deadCodePct: makeTrendMetric(current.deadCodePct, prev.deadCodePct, false),
    duplicationPct: makeTrendMetric(current.duplicationPct, prev.duplicationPct, false),
    complexityHighPct: makeTrendMetric(current.complexityHighPct, prev.complexityHighPct, false),
    complexityCriticalPct: makeTrendMetric(
      current.complexityCriticalPct,
      prev.complexityCriticalPct,
      false
    ),
    hotspotDensity: makeTrendMetric(current.hotspotDensity, prev.hotspotDensity, false),
    busFactor: makeTrendMetric(current.busFactor, prev.busFactor, true),
    unusedDepsPct: makeTrendMetric(current.unusedDepsPct, prev.unusedDepsPct, false),
    maintainabilityIndex: makeTrendMetric(
      current.maintainabilityIndex,
      prev.maintainabilityIndex,
      true
    ),
  };
}
