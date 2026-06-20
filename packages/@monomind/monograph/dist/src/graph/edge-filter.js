// ── DB-backed filter ───────────────────────────────────────────────────────────
/**
 * Query edges from a MonographDb with optional relation / confidence filters.
 * All filters are combined with AND.
 */
export function filterEdges(db, options = {}) {
    const conditions = [];
    const params = [];
    if (options.relations && options.relations.length > 0) {
        const ph = options.relations.map(() => '?').join(',');
        conditions.push(`relation IN (${ph})`);
        params.push(...options.relations);
    }
    if (options.confidences && options.confidences.length > 0) {
        const ph = options.confidences.map(() => '?').join(',');
        conditions.push(`confidence IN (${ph})`);
        params.push(...options.confidences);
    }
    if (options.minConfidenceScore !== undefined) {
        conditions.push('confidence_score >= ?');
        params.push(options.minConfidenceScore);
    }
    if (options.maxConfidenceScore !== undefined) {
        conditions.push('confidence_score <= ?');
        params.push(options.maxConfidenceScore);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, source_id, target_id, relation, confidence, confidence_score, reason, evidence
               FROM edges ${where}`;
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({
        id: r.id,
        sourceId: r.source_id,
        targetId: r.target_id,
        relation: r.relation,
        confidence: r.confidence,
        confidenceScore: r.confidence_score,
        reason: r.reason ?? undefined,
    }));
}
// ── In-memory filter ───────────────────────────────────────────────────────────
/**
 * Filter an already-loaded array of edges in memory.
 * Useful when the caller already has edges and does not need a DB round-trip.
 */
export function filterEdgesInMemory(edges, options = {}) {
    // Convert arrays to Sets once before the loop for O(1) membership checks
    const relationSet = options.relations && options.relations.length > 0
        ? new Set(options.relations) : null;
    const confidenceSet = options.confidences && options.confidences.length > 0
        ? new Set(options.confidences) : null;
    const minScore = options.minConfidenceScore;
    const maxScore = options.maxConfidenceScore;
    return edges.filter(e => {
        if (relationSet && !relationSet.has(e.relation))
            return false;
        if (confidenceSet && !confidenceSet.has(e.confidence))
            return false;
        if (minScore !== undefined && e.confidenceScore < minScore)
            return false;
        if (maxScore !== undefined && e.confidenceScore > maxScore)
            return false;
        return true;
    });
}
// ── Formatting ─────────────────────────────────────────────────────────────────
/** Format a list of filtered edges as structured text for LLM consumption. */
export function formatFilteredEdges(edges) {
    if (edges.length === 0)
        return 'No edges match the filter.';
    const lines = [`Filtered edges (${edges.length}):`];
    for (const e of edges) {
        const score = e.confidenceScore !== undefined ? ` [${e.confidenceScore.toFixed(2)}]` : '';
        const reason = e.reason ? ` — ${e.reason}` : '';
        lines.push(`  ${e.sourceId} -[${e.relation}/${e.confidence}${score}]-> ${e.targetId}${reason}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=edge-filter.js.map