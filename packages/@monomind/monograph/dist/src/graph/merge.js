// ── In-memory merge ────────────────────────────────────────────────────────────
/**
 * Merge two sets of nodes and edges into a single deduplicated set.
 *
 * @param base   - The base graph (nodes + edges).
 * @param incoming - The graph to merge in.
 * @param options  - Conflict resolution strategy.
 * @returns Merged nodes + edges, plus per-type counters.
 */
export function mergeGraphs(base, incoming, options = {}) {
    const strategy = options.onConflict ?? 'skip';
    const nodeMap = new Map(base.nodes.map(n => [n.id, n]));
    const edgeMap = new Map(base.edges.map(e => [e.id, e]));
    let nodesAdded = 0;
    let nodesSkipped = 0;
    let edgesAdded = 0;
    let edgesSkipped = 0;
    for (const node of incoming.nodes) {
        if (nodeMap.has(node.id)) {
            if (strategy === 'replace') {
                nodeMap.set(node.id, node);
                nodesAdded++;
            }
            else {
                nodesSkipped++;
            }
        }
        else {
            nodeMap.set(node.id, node);
            nodesAdded++;
        }
    }
    for (const edge of incoming.edges) {
        if (edgeMap.has(edge.id)) {
            if (strategy === 'replace') {
                edgeMap.set(edge.id, edge);
                edgesAdded++;
            }
            else {
                edgesSkipped++;
            }
        }
        else {
            edgeMap.set(edge.id, edge);
            edgesAdded++;
        }
    }
    return {
        nodes: Array.from(nodeMap.values()),
        edges: Array.from(edgeMap.values()),
        nodesAdded,
        nodesSkipped,
        edgesAdded,
        edgesSkipped,
    };
}
// ── DB-backed merge ────────────────────────────────────────────────────────────
/**
 * Merge incoming nodes and edges into an existing MonographDb.
 *
 * Nodes are inserted via INSERT OR IGNORE (skip) or INSERT OR REPLACE (replace).
 * Edges are handled the same way.
 *
 * @param targetDb  - The destination database.
 * @param incoming  - The graph data to merge in.
 * @param options   - Conflict resolution strategy.
 * @returns Per-type counters.
 */
export function mergeGraphIntoDb(targetDb, incoming, options = {}) {
    const strategy = options.onConflict ?? 'skip';
    const orClause = strategy === 'replace' ? 'OR REPLACE' : 'OR IGNORE';
    const insertNode = targetDb.prepare(`INSERT ${orClause} INTO nodes
       (id, label, name, norm_label, file_path, start_line, end_line, community_id, is_exported, language, properties)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertEdge = targetDb.prepare(`INSERT ${orClause} INTO edges
       (id, source_id, target_id, relation, confidence, confidence_score, reason, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    let nodesAdded = 0;
    let nodesSkipped = 0;
    let edgesAdded = 0;
    let edgesSkipped = 0;
    const nodeExists = targetDb.prepare('SELECT 1 FROM nodes WHERE id = ?');
    const edgeExists = targetDb.prepare('SELECT 1 FROM edges WHERE id = ?');
    const mergeAll = targetDb.transaction(() => {
        for (const n of incoming.nodes) {
            const exists = !!nodeExists.get(n.id);
            insertNode.run(n.id, n.label, n.name, n.normLabel, n.filePath ?? null, n.startLine ?? null, n.endLine ?? null, n.communityId ?? null, n.isExported ? 1 : 0, n.language ?? null, n.properties ? JSON.stringify(n.properties) : null);
            if (exists) {
                strategy === 'replace' ? nodesAdded++ : nodesSkipped++;
            }
            else {
                nodesAdded++;
            }
        }
        for (const e of incoming.edges) {
            const exists = !!edgeExists.get(e.id);
            insertEdge.run(e.id, e.sourceId, e.targetId, e.relation, e.confidence, e.confidenceScore, e.reason ?? null, null);
            if (exists) {
                strategy === 'replace' ? edgesAdded++ : edgesSkipped++;
            }
            else {
                edgesAdded++;
            }
        }
    });
    mergeAll();
    return { nodesAdded, nodesSkipped, edgesAdded, edgesSkipped };
}
//# sourceMappingURL=merge.js.map