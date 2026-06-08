function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    const idx = Math.floor((p / 100) * sorted.length);
    return sorted[Math.min(idx, sorted.length - 1)];
}
function buildRiskProfile(values) {
    const total = values.length;
    let low = 0, medium = 0, high = 0, critical = 0;
    for (const v of values) {
        if (v < 5)
            low++;
        else if (v <= 15)
            medium++;
        else if (v <= 30)
            high++;
        else
            critical++;
    }
    const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
    return {
        low,
        medium,
        high,
        critical,
        lowPct: pct(low),
        mediumPct: pct(medium),
        highPct: pct(high),
        criticalPct: pct(critical),
    };
}
/**
 * Compute full coupling profile from SQLite.
 */
export function computeCouplingProfile(db) {
    const fanInRows = db.prepare('SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id').all();
    const fanOutRows = db.prepare('SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id').all();
    const totalFiles = db.prepare("SELECT COUNT(*) as n FROM nodes WHERE label = 'File'").get().n;
    const fanInValues = fanInRows.map(r => r.c).sort((a, b) => a - b);
    const fanOutValues = fanOutRows.map(r => r.c).sort((a, b) => a - b);
    const p95FanIn = percentile(fanInValues, 95);
    const couplingHighCount = fanInValues.filter(v => v > p95FanIn).length;
    const couplingHighPct = fanInValues.length > 0
        ? Math.round((couplingHighCount / fanInValues.length) * 100)
        : 0;
    return {
        p50FanIn: percentile(fanInValues, 50),
        p75FanIn: percentile(fanInValues, 75),
        p90FanIn: percentile(fanInValues, 90),
        p95FanIn,
        couplingHighPct,
        fanInProfile: buildRiskProfile(fanInValues),
        fanOutProfile: buildRiskProfile(fanOutValues),
        totalFiles,
    };
}
/**
 * Quick stats summary (extends existing stats from monograph_stats MCP tool).
 */
export function computeGraphStats(db) {
    const nodeCount = db.prepare('SELECT COUNT(*) as n FROM nodes').get().n;
    const edgeCount = db.prepare('SELECT COUNT(*) as n FROM edges').get().n;
    const communityCount = db.prepare("SELECT COUNT(DISTINCT community_id) as n FROM nodes WHERE community_id IS NOT NULL").get().n;
    const fileCount = db.prepare("SELECT COUNT(*) as n FROM nodes WHERE label = 'File'").get().n;
    const couplingProfile = computeCouplingProfile(db);
    return {
        nodeCount,
        edgeCount,
        communityCount,
        fileCount,
        couplingProfile,
    };
}
//# sourceMappingURL=stats.js.map