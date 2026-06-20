// Per-DB prepared statement cache to avoid re-parsing SQL on repeated calls
const stmtCache = new WeakMap();
function stmt(db, sql) {
    let dbCache = stmtCache.get(db);
    if (!dbCache) {
        dbCache = new Map();
        stmtCache.set(db, dbCache);
    }
    let s = dbCache.get(sql);
    if (!s) {
        s = db.prepare(sql);
        dbCache.set(sql, s);
    }
    return s;
}
/** Binary search: returns index of first element > value in a sorted ascending array. */
function upperBound(sorted, value) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid] <= value)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
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
    const fanInRows = stmt(db, 'SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id')
        .all();
    const fanOutRows = stmt(db, 'SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id')
        .all();
    const totalFiles = stmt(db, "SELECT COUNT(*) as n FROM nodes WHERE label = 'File'")
        .get().n;
    const fanInValues = fanInRows.map(r => r.c).sort((a, b) => a - b);
    const fanOutValues = fanOutRows.map(r => r.c).sort((a, b) => a - b);
    const p95FanIn = percentile(fanInValues, 95);
    // Use binary search instead of O(N) filter to count elements above p95 threshold
    const couplingHighCount = fanInValues.length - upperBound(fanInValues, p95FanIn);
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
    const nodeCount = stmt(db, 'SELECT COUNT(*) as n FROM nodes').get().n;
    const edgeCount = stmt(db, 'SELECT COUNT(*) as n FROM edges').get().n;
    const communityCount = stmt(db, "SELECT COUNT(DISTINCT community_id) as n FROM nodes WHERE community_id IS NOT NULL").get().n;
    const fileCount = stmt(db, "SELECT COUNT(*) as n FROM nodes WHERE label = 'File'")
        .get().n;
    const couplingProfile = computeCouplingProfile(db);
    return {
        nodeCount,
        edgeCount,
        communityCount,
        fileCount,
        couplingProfile,
    };
}
/** Format a GraphStatsSummary as structured text for LLM consumption. */
export function formatGraphStats(s) {
    const cp = s.couplingProfile;
    const lines = [
        `Graph Stats`,
        `  Nodes: ${s.nodeCount}  Edges: ${s.edgeCount}  Communities: ${s.communityCount}  Files: ${s.fileCount}`,
        `Coupling Profile (${cp.totalFiles} files)`,
        `  Fan-in p50/p75/p90/p95: ${cp.p50FanIn}/${cp.p75FanIn}/${cp.p90FanIn}/${cp.p95FanIn}`,
        `  High-coupling (>p95): ${cp.couplingHighPct}%`,
        `Fan-in Risk: low=${cp.fanInProfile.low}(${cp.fanInProfile.lowPct}%) med=${cp.fanInProfile.medium}(${cp.fanInProfile.mediumPct}%) high=${cp.fanInProfile.high}(${cp.fanInProfile.highPct}%) crit=${cp.fanInProfile.critical}(${cp.fanInProfile.criticalPct}%)`,
        `Fan-out Risk: low=${cp.fanOutProfile.low}(${cp.fanOutProfile.lowPct}%) med=${cp.fanOutProfile.medium}(${cp.fanOutProfile.mediumPct}%) high=${cp.fanOutProfile.high}(${cp.fanOutProfile.highPct}%) crit=${cp.fanOutProfile.critical}(${cp.fanOutProfile.criticalPct}%)`,
    ];
    return lines.join('\n');
}
//# sourceMappingURL=stats.js.map