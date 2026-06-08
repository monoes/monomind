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
    return edges.filter(e => {
        if (options.relations && options.relations.length > 0) {
            if (!options.relations.includes(e.relation))
                return false;
        }
        if (options.confidences && options.confidences.length > 0) {
            if (!options.confidences.includes(e.confidence))
                return false;
        }
        if (options.minConfidenceScore !== undefined && e.confidenceScore < options.minConfidenceScore) {
            return false;
        }
        if (options.maxConfidenceScore !== undefined && e.confidenceScore > options.maxConfidenceScore) {
            return false;
        }
        return true;
    });
}
//# sourceMappingURL=edge-filter.js.map