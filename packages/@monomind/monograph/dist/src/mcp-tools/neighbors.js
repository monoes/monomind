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
export function getMonographNeighbors(db, input) {
    const nodeRow = db
        .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
        .get(input.name);
    if (!nodeRow)
        return { node: null, neighbors: [] };
    const node = rowToNode(nodeRow);
    const neighbors = [];
    // Outbound edges
    const outboundSql = input.relationFilter
        ? `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? AND e.relation = ? LIMIT 50`
        : `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? LIMIT 50`;
    const outboundParams = input.relationFilter ? [node.id, input.relationFilter] : [node.id];
    const outboundRows = db.prepare(outboundSql).all(...outboundParams);
    for (const row of outboundRows) {
        neighbors.push({
            node: rowToNode(row),
            relation: row['relation'],
            confidence: row['confidence'],
            confidenceScore: row['confidence_score'] ?? 1,
            direction: 'outbound',
        });
    }
    // Inbound edges
    if (input.includeInbound) {
        const inboundSql = input.relationFilter
            ? `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.source_id WHERE e.target_id = ? AND e.relation = ? LIMIT 50`
            : `SELECT n.*, e.relation, e.confidence, e.confidence_score FROM nodes n JOIN edges e ON n.id = e.source_id WHERE e.target_id = ? LIMIT 50`;
        const inboundParams = input.relationFilter ? [node.id, input.relationFilter] : [node.id];
        const inboundRows = db.prepare(inboundSql).all(...inboundParams);
        for (const row of inboundRows) {
            neighbors.push({
                node: rowToNode(row),
                relation: row['relation'],
                confidence: row['confidence'],
                confidenceScore: row['confidence_score'] ?? 1,
                direction: 'inbound',
            });
        }
    }
    return { node, neighbors };
}
//# sourceMappingURL=neighbors.js.map