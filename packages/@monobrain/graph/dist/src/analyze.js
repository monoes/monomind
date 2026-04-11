/**
 * Find the most connected nodes (god nodes) — core abstractions of the codebase.
 * Sorted by total degree (in + out), descending.
 */
export function godNodes(graph, topN = 15) {
    const nodes = [];
    graph.forEachNode((id, attrs) => {
        nodes.push({
            id,
            label: attrs.label || id,
            degree: graph.degree(id),
            community: attrs.community,
            sourceFile: attrs.sourceFile || '',
            neighbors: graph
                .neighbors(id)
                .slice(0, 8)
                .map((n) => graph.getNodeAttribute(n, 'label') || n),
        });
    });
    return nodes.sort((a, b) => b.degree - a.degree).slice(0, topN);
}
/**
 * Find surprising cross-community connections.
 * An edge is surprising when its endpoints belong to different communities.
 * Scored by the product of their degrees — high degree on both sides = high surprise.
 */
export function surprisingConnections(graph, topN = 20) {
    const surprises = [];
    graph.forEachEdge((_, attrs, source, target) => {
        const cu = graph.getNodeAttribute(source, 'community');
        const cv = graph.getNodeAttribute(target, 'community');
        if (cu !== undefined && cv !== undefined && cu !== cv) {
            surprises.push({
                from: graph.getNodeAttribute(source, 'label') || source,
                fromCommunity: cu,
                fromFile: graph.getNodeAttribute(source, 'sourceFile') || '',
                to: graph.getNodeAttribute(target, 'label') || target,
                toCommunity: cv,
                toFile: graph.getNodeAttribute(target, 'sourceFile') || '',
                relation: attrs.relation || '',
                confidence: attrs.confidence ?? 'AMBIGUOUS',
                score: graph.degree(source) * graph.degree(target),
            });
        }
    });
    return surprises.sort((a, b) => b.score - a.score).slice(0, topN);
}
/**
 * Compute high-level graph statistics.
 */
export function graphStats(graph, graphPath) {
    const confidence = {};
    const relations = {};
    const fileTypes = {};
    const commSet = new Set();
    graph.forEachEdge((_, attrs) => {
        const c = attrs.confidence || 'UNKNOWN';
        confidence[c] = (confidence[c] ?? 0) + 1;
        const r = attrs.relation || 'unknown';
        relations[r] = (relations[r] ?? 0) + 1;
    });
    graph.forEachNode((_, attrs) => {
        const ft = attrs.fileType || 'unknown';
        fileTypes[ft] = (fileTypes[ft] ?? 0) + 1;
        const c = attrs.community;
        if (c !== undefined)
            commSet.add(c);
    });
    const topRelations = Object.fromEntries(Object.entries(relations)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10));
    return {
        nodes: graph.order,
        edges: graph.size,
        communities: commSet.size,
        confidence: confidence,
        fileTypes,
        topRelations,
        isDirected: graph.type === 'directed',
        graphPath,
    };
}
/**
 * Build a complete GraphAnalysis object from an annotated graph.
 * Assumes community detection has already been run (nodes have `community` attribute).
 */
export function buildAnalysis(graph, graphPath) {
    // Reconstruct communities map from node attributes
    const communities = {};
    graph.forEachNode((id, attrs) => {
        const c = attrs.community;
        if (c !== undefined) {
            if (!communities[c])
                communities[c] = [];
            communities[c].push(id);
        }
    });
    return {
        godNodes: godNodes(graph),
        surprises: surprisingConnections(graph),
        communities,
        stats: graphStats(graph, graphPath),
    };
}
//# sourceMappingURL=analyze.js.map