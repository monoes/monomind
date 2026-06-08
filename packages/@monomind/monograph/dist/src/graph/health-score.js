export function letterGrade(score) {
    if (score >= 90)
        return 'A';
    if (score >= 80)
        return 'B';
    if (score >= 70)
        return 'C';
    if (score >= 60)
        return 'D';
    return 'F';
}
export function computeHealthScore(db) {
    // ── Total file nodes ──────────────────────────────────────────────────────
    const totalFilesRow = db.prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File'").get();
    const totalFiles = totalFilesRow.c;
    // ── Unreachable file nodes ────────────────────────────────────────────────
    const unreachableRow = db.prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File' AND properties LIKE '%\"unreachable\"%'").get();
    const unreachableFiles = unreachableRow.c;
    // ── Total nodes ───────────────────────────────────────────────────────────
    const totalNodesRow = db.prepare('SELECT COUNT(*) as c FROM nodes').get();
    const totalNodes = totalNodesRow.c;
    // ── p95 degree (god nodes) ────────────────────────────────────────────────
    const degreesRows = db.prepare(`
    SELECT source_id as node_id, COUNT(*) as deg FROM edges GROUP BY source_id
    UNION ALL
    SELECT target_id as node_id, COUNT(*) as deg FROM edges GROUP BY target_id
  `).all();
    // Sum degrees per node
    const degMap = new Map();
    for (const row of degreesRows) {
        degMap.set(row.node_id, (degMap.get(row.node_id) ?? 0) + row.deg);
    }
    const degrees = [...degMap.values()].sort((a, b) => a - b);
    const p95Index = Math.floor(degrees.length * 0.95);
    const p95Degree = degrees[p95Index] ?? 0;
    const godNodeCount = p95Degree > 0
        ? [...degMap.values()].filter(d => d > p95Degree).length
        : 0;
    // ── Circular edges (bidirectional import pairs) ───────────────────────────
    const totalEdgesRow = db.prepare('SELECT COUNT(*) as c FROM edges').get();
    const totalEdges = totalEdgesRow.c;
    const circularRow = db.prepare(`
    SELECT COUNT(*) as c FROM edges e1
    JOIN edges e2 ON e1.source_id = e2.target_id AND e1.target_id = e2.source_id
    WHERE e1.relation = 'IMPORTS' AND e2.relation = 'IMPORTS'
      AND e1.source_id < e1.target_id
  `).get();
    // Each circular pair is counted once; each pair has 2 edges contributing
    const circularEdges = circularRow.c * 2;
    // ── Hotspot files (churnScore > 0.5 in properties) ───────────────────────
    // Files where properties contain a churnScore > 0.5
    // We detect presence of churnScore via LIKE and then evaluate in JS
    const hotspotCandidates = db.prepare("SELECT properties FROM nodes WHERE label = 'File' AND properties LIKE '%churnScore%'").all();
    let hotspotCount = 0;
    for (const row of hotspotCandidates) {
        if (!row.properties)
            continue;
        try {
            const props = JSON.parse(row.properties);
            const churn = props['churnScore'];
            if (typeof churn === 'number' && churn > 0.5)
                hotspotCount++;
        }
        catch {
            // ignore malformed JSON
        }
    }
    // ── Isolated nodes (degree = 0) ───────────────────────────────────────────
    const isolatedRow = db.prepare(`
    SELECT COUNT(*) as c FROM nodes n
    WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
  `).get();
    const isolatedNodes = isolatedRow.c;
    // ── Cross-community edges ─────────────────────────────────────────────────
    const crossCommRow = db.prepare(`
    SELECT COUNT(*) as c FROM edges e
    JOIN nodes n1 ON n1.id = e.source_id
    JOIN nodes n2 ON n2.id = e.target_id
    WHERE n1.community_id IS NOT NULL
      AND n2.community_id IS NOT NULL
      AND n1.community_id != n2.community_id
  `).get();
    const crossCommunityEdges = crossCommRow.c;
    // ── Compute percentages ───────────────────────────────────────────────────
    const pct = (count, total) => total > 0 ? (count / total) * 100 : 0;
    const penalties = {
        unreachableFilePct: pct(unreachableFiles, totalFiles),
        godNodePct: pct(godNodeCount, totalNodes),
        circularEdgePct: pct(circularEdges, totalEdges),
        hotspotPct: pct(hotspotCount, totalFiles),
        isolatedNodePct: pct(isolatedNodes, totalNodes),
        crossCommunityEdgePct: pct(crossCommunityEdges, totalEdges),
    };
    // ── Score formula ─────────────────────────────────────────────────────────
    let score = 100;
    score -= Math.min(penalties.unreachableFilePct * 0.25, 25);
    score -= Math.min(penalties.godNodePct * 0.20, 20);
    score -= Math.min(penalties.circularEdgePct * 0.20, 20);
    score -= Math.min(penalties.hotspotPct * 0.15, 15);
    score -= Math.min(penalties.isolatedNodePct * 0.10, 10);
    score -= Math.min(penalties.crossCommunityEdgePct * 0.10, 10);
    score = Math.max(0, Math.round(score * 10) / 10);
    const grade = letterGrade(score);
    const fmt = (pct, penalty) => `${pct.toFixed(1)}% (-${penalty.toFixed(1)})`;
    const summary = [
        `Grade: ${grade} (score: ${score}/100)`,
        `Penalties:`,
        `  unreachable files: ${fmt(penalties.unreachableFilePct, Math.min(penalties.unreachableFilePct * 0.25, 25))}`,
        `  god nodes: ${fmt(penalties.godNodePct, Math.min(penalties.godNodePct * 0.20, 20))}`,
        `  circular edges: ${fmt(penalties.circularEdgePct, Math.min(penalties.circularEdgePct * 0.20, 20))}`,
        `  hotspot files: ${fmt(penalties.hotspotPct, Math.min(penalties.hotspotPct * 0.15, 15))}`,
        `  isolated nodes: ${fmt(penalties.isolatedNodePct, Math.min(penalties.isolatedNodePct * 0.10, 10))}`,
        `  cross-community edges: ${fmt(penalties.crossCommunityEdgePct, Math.min(penalties.crossCommunityEdgePct * 0.10, 10))}`,
    ].join('\n');
    return { score, grade, penalties, summary };
}
//# sourceMappingURL=health-score.js.map