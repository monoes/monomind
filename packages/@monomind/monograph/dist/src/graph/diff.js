function buildDiffSummary(newNodes, removedNodes, newEdges, removedEdges, modifiedNodes) {
    const parts = [];
    if (newNodes.length > 0)
        parts.push(`${newNodes.length} new node${newNodes.length !== 1 ? 's' : ''}`);
    if (newEdges.length > 0)
        parts.push(`${newEdges.length} new edge${newEdges.length !== 1 ? 's' : ''}`);
    if (removedNodes.length > 0)
        parts.push(`${removedNodes.length} node${removedNodes.length !== 1 ? 's' : ''} removed`);
    if (removedEdges.length > 0)
        parts.push(`${removedEdges.length} edge${removedEdges.length !== 1 ? 's' : ''} removed`);
    if (modifiedNodes.length > 0)
        parts.push(`${modifiedNodes.length} node${modifiedNodes.length !== 1 ? 's' : ''} modified`);
    return parts.length > 0 ? parts.join(', ') : 'no changes';
}
export function diffSnapshots(before, after) {
    const beforeNodeIds = new Map(before.nodes.map(n => [n.id, n]));
    const afterNodeIds = new Map(after.nodes.map(n => [n.id, n]));
    // Key edges by sourceId+relation+targetId — stable across snapshots regardless of synthetic id
    const edgeKey = (e) => `${e.sourceId}|${e.relation}|${e.targetId}`;
    const beforeEdgeKeys = new Set(before.edges.map(edgeKey));
    const afterEdgeKeys = new Set(after.edges.map(edgeKey));
    const newNodes = after.nodes.filter(n => !beforeNodeIds.has(n.id));
    const removedNodes = before.nodes.filter(n => !afterNodeIds.has(n.id));
    const newEdges = after.edges.filter(e => !beforeEdgeKeys.has(edgeKey(e)));
    const removedEdges = before.edges.filter(e => !afterEdgeKeys.has(edgeKey(e)));
    const modifiedNodes = after.nodes
        .filter(n => beforeNodeIds.has(n.id))
        .filter(n => JSON.stringify(n) !== JSON.stringify(beforeNodeIds.get(n.id)))
        .map(n => ({ before: beforeNodeIds.get(n.id), after: n }));
    return {
        newNodes,
        removedNodes,
        newEdges,
        removedEdges,
        modifiedNodes,
        summary: buildDiffSummary(newNodes, removedNodes, newEdges, removedEdges, modifiedNodes),
    };
}
export function snapshotFromDb(db) {
    const rawNodes = db.prepare(`
    SELECT id, label, name,
      norm_label AS normLabel,
      file_path AS filePath,
      start_line AS startLine,
      end_line AS endLine,
      community_id AS communityId,
      is_exported AS isExported,
      language, properties
    FROM nodes
  `).all();
    const rawEdges = db.prepare(`
    SELECT id,
      source_id AS sourceId,
      target_id AS targetId,
      relation, confidence,
      confidence_score AS confidenceScore
    FROM edges
  `).all();
    const nodes = rawNodes.map(r => ({
        ...r,
        isExported: Boolean(r['isExported']),
    }));
    const edges = rawEdges;
    return { nodes, edges, capturedAt: new Date().toISOString() };
}
//# sourceMappingURL=diff.js.map