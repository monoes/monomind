function rowToNode(row) {
    return {
        id: row['id'],
        label: row['label'],
        name: row['name'],
        normLabel: row['norm_label'] ?? '',
        filePath: row['file_path'],
        startLine: row['start_line'],
        endLine: row['end_line'],
        communityId: row['community_id'],
        isExported: row['is_exported'] === 1,
        language: row['language'],
        properties: row['properties'] ? JSON.parse(row['properties']) : undefined,
    };
}
// ── Shared edge query helper ──────────────────────────────────────────────────
function queryEdges(db, nodeId, direction, relationFilter) {
    // outbound: source_id = nodeId → join target_id
    // inbound:  target_id = nodeId → join source_id
    const [idCol, joinCol] = direction === 'outbound'
        ? ['source_id', 'target_id']
        : ['target_id', 'source_id'];
    const sql = relationFilter
        ? `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.${joinCol} WHERE e.${idCol} = ? AND e.relation = ? LIMIT 50`
        : `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.${joinCol} WHERE e.${idCol} = ? LIMIT 50`;
    const params = relationFilter ? [nodeId, relationFilter] : [nodeId];
    const rows = db.prepare(sql).all(...params);
    return rows.map(row => ({
        node: rowToNode(row),
        relation: row['relation'],
        confidence: row['confidence'],
        confidenceScore: row['confidence_score'] ?? 1,
        direction,
    }));
}
export function getMonographNeighbors(db, input) {
    const nodeRow = db
        .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
        .get(input.name);
    if (!nodeRow)
        return { node: null, neighbors: [] };
    const node = rowToNode(nodeRow);
    const neighbors = [
        ...queryEdges(db, node.id, 'outbound', input.relationFilter),
        ...(input.includeInbound ? queryEdges(db, node.id, 'inbound', input.relationFilter) : []),
    ];
    return { node, neighbors };
}
//# sourceMappingURL=neighbors.js.map