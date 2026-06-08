export const STABLE_BAND = 0.5;
export function trendDirection(current, previous, isHigherBetter = false) {
    const delta = current - previous;
    if (Math.abs(delta) <= STABLE_BAND) {
        return 'stable';
    }
    if (isHigherBetter) {
        return delta > 0 ? 'improving' : 'declining';
    }
    return delta < 0 ? 'improving' : 'declining';
}
export function makeTrendMetric(current, previous, isHigherBetter = false) {
    return {
        current,
        previous,
        delta: current - previous,
        direction: trendDirection(current, previous, isHigherBetter),
    };
}
export function computeTrend(current, currentScore, previous) {
    const prev = previous.vitalSigns;
    const prevScore = previous.healthScore;
    return {
        healthScore: makeTrendMetric(currentScore.value, prevScore.value, true),
        deadCodePct: makeTrendMetric(current.deadCodePct, prev.deadCodePct, false),
        duplicationPct: makeTrendMetric(current.duplicationPct, prev.duplicationPct, false),
        complexityHighPct: makeTrendMetric(current.complexityHighPct, prev.complexityHighPct, false),
        complexityCriticalPct: makeTrendMetric(current.complexityCriticalPct, prev.complexityCriticalPct, false),
        hotspotDensity: makeTrendMetric(current.hotspotDensity, prev.hotspotDensity, false),
        busFactor: makeTrendMetric(current.busFactor, prev.busFactor, true),
        unusedDepsPct: makeTrendMetric(current.unusedDepsPct, prev.unusedDepsPct, false),
        maintainabilityIndex: makeTrendMetric(current.maintainabilityIndex, prev.maintainabilityIndex, true),
    };
}
//# sourceMappingURL=trends.js.map