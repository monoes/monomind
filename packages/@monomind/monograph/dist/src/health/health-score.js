export const HOTSPOT_SCORE_THRESHOLD = 50;
export const MI_DENSITY_MIN_LINES = 50;
export function computeHealthScore(vs, totalFiles) {
    const p = {
        deadCode: Math.min(15, vs.deadCodePct * 0.15),
        duplication: Math.min(15, vs.duplicationPct * 0.15),
        complexityHigh: Math.min(10, vs.complexityHighPct * 0.10),
        complexityCritical: Math.min(10, vs.complexityCriticalPct * 0.20),
        crapHigh: Math.min(10, vs.crapHighPct * 0.10),
        crapCritical: Math.min(10, vs.crapCriticalPct * 0.20),
        hotspotDensity: Math.min(10, vs.hotspotDensity * 0.10),
        couplingConcentration: Math.min(5, vs.couplingHighPct * 0.05),
        busFactor: Math.min(10, vs.busFactorRisk * 10),
        largeFunctions: Math.min(5, vs.largeFunctionsPct * 0.10),
        unusedDeps: Math.min(5, Math.min(vs.unusedDepCount, 10) * 0.5),
    };
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    const value = Math.max(0, Math.round(100 - total));
    return { value, grade: letterGradeFromScore(value), penalties: p };
}
export function letterGradeFromScore(score) {
    if (score >= 90)
        return 'A';
    if (score >= 75)
        return 'B';
    if (score >= 60)
        return 'C';
    if (score >= 40)
        return 'D';
    return 'F';
}
//# sourceMappingURL=health-score.js.map