/**
 * Extract the induced subgraph for the given set of node ids.
 *
 * The induced subgraph contains:
 * - Only the nodes whose ids are in `nodeIds` (and exist in the DB)
 * - Only the edges where both source and target are in `nodeIds`
 *
 * @param db - The MonographDb instance
 * @param nodeIds - The subset of node ids to include
 * @returns An object with `nodes` and `edges` arrays
 */
// SQLite SQLITE_MAX_VARIABLE_NUMBER limit (32766). Edge query binds nodeIds once
// (source_id IN chunk), then filters target in-memory — full limit available per chunk.
const SQLITE_VAR_LIMIT = 32766;
export function extractInducedSubgraph(db, nodeIds) {
    if (nodeIds.length === 0)
        return { nodes: [], edges: [] };
    // Chunk helper to stay within SQLITE_MAX_VARIABLE_NUMBER
    function queryChunked(ids, chunkSize, query) {
        const results = [];
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const ph = chunk.map(() => '?').join(',');
            results.push(...query(ph, chunk));
        }
        return results;
    }
    const rawNodes = queryChunked(nodeIds, SQLITE_VAR_LIMIT, (ph, chunk) => db.prepare(`SELECT id, label, name, file_path, start_line, end_line, community_id, is_exported, language, properties
       FROM nodes WHERE id IN (${ph})`).all(...chunk));
    // For edges: query by source_id chunks (1 bind per row), then filter target in-memory.
    // Querying by both source+target would miss cross-chunk edges and requires 2× bind slots.
    const nodeSet = new Set(nodeIds);
    const rawEdges = queryChunked(nodeIds, SQLITE_VAR_LIMIT, (ph, chunk) => db.prepare(`SELECT id, source_id, target_id, relation, confidence, confidence_score, reason, evidence
       FROM edges WHERE source_id IN (${ph})`).all(...chunk).filter(e => nodeSet.has(e.target_id)));
    const nodes = rawNodes.map(n => ({
        id: n.id,
        label: n.label,
        name: n.name,
        normLabel: (n.norm_label ?? n.name ?? '').toLowerCase(),
        filePath: n.file_path ?? undefined,
        startLine: n.start_line ?? undefined,
        endLine: n.end_line ?? undefined,
        communityId: n.community_id ?? undefined,
        isExported: n.is_exported === 1,
        language: n.language ?? undefined,
        properties: n.properties ? JSON.parse(n.properties) : undefined,
    }));
    const edges = rawEdges.map(e => ({
        id: e.id,
        sourceId: e.source_id,
        targetId: e.target_id,
        relation: e.relation,
        confidence: e.confidence,
        confidenceScore: e.confidence_score,
        reason: e.reason ?? undefined,
    }));
    return { nodes, edges };
}
//# sourceMappingURL=subgraph.js.map