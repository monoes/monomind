import Graph from 'graphology';
export function loadGraphFromEdges(edges) {
    const graph = new Graph({ multi: true, type: 'directed' });
    for (const edge of edges) {
        if (!graph.hasNode(edge.sourceId))
            graph.addNode(edge.sourceId);
        if (!graph.hasNode(edge.targetId))
            graph.addNode(edge.targetId);
        try {
            graph.addEdge(edge.sourceId, edge.targetId, {
                id: edge.id, relation: edge.relation,
                confidence: edge.confidence, confidenceScore: edge.confidenceScore,
            });
        }
        catch { /* duplicate edge */ }
    }
    return graph;
}
export function loadGraphFromDb(db) {
    const nodes = db.prepare('SELECT id FROM nodes').all();
    const edges = db.prepare('SELECT * FROM edges').all();
    const graph = new Graph({ multi: true, type: 'directed' });
    for (const n of nodes) {
        if (!graph.hasNode(n.id))
            graph.addNode(n.id);
    }
    for (const e of edges) {
        if (!graph.hasNode(e.source_id))
            graph.addNode(e.source_id);
        if (!graph.hasNode(e.target_id))
            graph.addNode(e.target_id);
        try {
            graph.addEdge(e.source_id, e.target_id, {
                id: e.id, relation: e.relation,
                confidence: e.confidence, confidenceScore: e.confidence_score,
            });
        }
        catch { /* skip */ }
    }
    return graph;
}
//# sourceMappingURL=loader.js.map