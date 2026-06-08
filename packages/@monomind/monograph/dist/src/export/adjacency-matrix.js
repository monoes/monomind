// ── Builder ────────────────────────────────────────────────────────────────────
/**
 * Build an adjacency matrix from a set of nodes and edges.
 *
 * Multi-edges (same source→target pair) are counted, so the matrix
 * contains edge-counts rather than simple 0/1 booleans.
 *
 * @param nodes - The node list (defines row/column order).
 * @param edges - The edge list.
 * @returns An AdjacencyMatrix with nodeIds, nodeNames, and the n×n matrix.
 */
export function buildAdjacencyMatrix(nodes, edges) {
    const nodeIds = nodes.map(n => n.id);
    const nodeNames = nodes.map(n => n.name);
    const indexMap = new Map(nodeIds.map((id, i) => [id, i]));
    const n = nodeIds.length;
    if (n > 5000) {
        throw new Error(`adjacency matrix would be ${n}×${n} (${n * n} cells). ` +
            'Pass a pre-filtered node list via the nodeIds parameter, or use a different export format.');
    }
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const edge of edges) {
        const si = indexMap.get(edge.sourceId);
        const ti = indexMap.get(edge.targetId);
        if (si !== undefined && ti !== undefined) {
            matrix[si][ti]++;
        }
    }
    return { nodeIds, nodeNames, matrix };
}
// ── DB-backed variant ──────────────────────────────────────────────────────────
/**
 * Build an adjacency matrix directly from a MonographDb.
 * Optionally restrict to a subset of node ids.
 */
export function buildAdjacencyMatrixFromDb(db, nodeIds) {
    let nodeRows;
    if (nodeIds && nodeIds.length > 0) {
        const ph = nodeIds.map(() => '?').join(',');
        nodeRows = db
            .prepare(`SELECT id, name FROM nodes WHERE id IN (${ph})`)
            .all(...nodeIds);
    }
    else {
        nodeRows = db.prepare('SELECT id, name FROM nodes').all();
    }
    const nodes = nodeRows.map(r => ({
        id: r.id,
        label: 'Function', // placeholder; only id/name needed here
        name: r.name,
        normLabel: r.name.toLowerCase(),
        isExported: false,
    }));
    const nodeIdSet = new Set(nodeRows.map(r => r.id));
    let edgeRows;
    if (nodeIds && nodeIds.length > 0) {
        const ph = nodeIds.map(() => '?').join(',');
        edgeRows = db
            .prepare(`SELECT source_id, target_id FROM edges WHERE source_id IN (${ph}) AND target_id IN (${ph})`)
            .all(...nodeIds, ...nodeIds);
    }
    else {
        edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all();
    }
    const edges = edgeRows
        .filter(r => nodeIdSet.has(r.source_id) && nodeIdSet.has(r.target_id))
        .map((r, i) => ({
        id: `e${i}`,
        sourceId: r.source_id,
        targetId: r.target_id,
        relation: 'REFERENCES',
        confidence: 'EXTRACTED',
        confidenceScore: 1,
    }));
    return buildAdjacencyMatrix(nodes, edges);
}
// ── CSV serialiser ─────────────────────────────────────────────────────────────
/**
 * Serialise an AdjacencyMatrix to a CSV string.
 * The first row and first column are node names (headers).
 */
export function adjacencyMatrixToCsv(am) {
    const escape = (s) => `"${s.replace(/"/g, '""')}"`;
    const header = ['', ...am.nodeNames.map(escape)].join(',');
    const rows = am.matrix.map((row, i) => [escape(am.nodeNames[i]), ...row.map(String)].join(','));
    return [header, ...rows].join('\n');
}
//# sourceMappingURL=adjacency-matrix.js.map