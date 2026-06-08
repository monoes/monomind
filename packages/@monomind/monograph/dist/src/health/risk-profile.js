export function computeSizeRiskProfile(lineCounts) {
    const p = { low: 0, medium: 0, high: 0, veryHigh: 0 };
    for (const n of lineCounts) {
        if (n <= 15)
            p.low++;
        else if (n <= 30)
            p.medium++;
        else if (n <= 60)
            p.high++;
        else
            p.veryHigh++;
    }
    return p;
}
export function computeInterfacingRiskProfile(paramCounts) {
    const p = { low: 0, medium: 0, high: 0, veryHigh: 0 };
    for (const n of paramCounts) {
        if (n <= 2)
            p.low++;
        else if (n <= 4)
            p.medium++;
        else if (n <= 6)
            p.high++;
        else
            p.veryHigh++;
    }
    return p;
}
export function computeCouplingConcentration(fanInScores) {
    if (fanInScores.length === 0)
        return { p95: 0, highPct: 0 };
    const sorted = [...fanInScores].sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Idx] ?? 0;
    const floor = Math.max(10, p95);
    const high = fanInScores.filter(s => s >= floor).length;
    const highPct = high / fanInScores.length;
    return { p95, highPct };
}
//# sourceMappingURL=risk-profile.js.map