import Graph from 'graphology';
// Mirrors upstream graphify's _normalize_id: lowercase + collapse non-alphanumeric to underscores.
function normalizeId(s) {
    return s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}
/**
 * Build a graphology Graph from extracted nodes and edges.
 * Deduplicates nodes by id, merges parallel edges with higher weight.
 */
export function buildGraph(extraction) {
    const graph = new Graph({ type: 'directed', multi: false });
    // Add all nodes — merge attributes if already present (dedup by id)
    for (const node of extraction.nodes) {
        if (!graph.hasNode(node.id)) {
            graph.addNode(node.id, { ...node });
        }
        else {
            graph.mergeNodeAttributes(node.id, { ...node });
        }
    }
    // Build normalized ID lookup to remap mismatched edge endpoints before stubbing.
    const normToId = new Map();
    graph.forEachNode((id) => {
        normToId.set(normalizeId(id), id);
    });
    // Add edges — skip self-loops, remap via normalization, stub only true externals
    for (const edge of extraction.edges) {
        let src = edge.source;
        let tgt = edge.target;
        if (!graph.hasNode(src)) {
            const remapped = normToId.get(normalizeId(src));
            if (remapped) {
                src = remapped;
            }
            else {
                graph.addNode(src, { id: src, label: src, fileType: 'unknown', sourceFile: '' });
                normToId.set(normalizeId(src), src);
            }
        }
        if (!graph.hasNode(tgt)) {
            const remapped = normToId.get(normalizeId(tgt));
            if (remapped) {
                tgt = remapped;
            }
            else {
                graph.addNode(tgt, { id: tgt, label: tgt, fileType: 'unknown', sourceFile: '' });
                normToId.set(normalizeId(tgt), tgt);
            }
        }
        if (src === tgt)
            continue;
        try {
            graph.addEdge(src, tgt, {
                relation: edge.relation,
                confidence: edge.confidence,
                confidenceScore: edge.confidenceScore,
                weight: edge.weight ?? 1,
                sourceFile: edge.sourceFile,
                sourceLocation: edge.sourceLocation,
            });
        }
        catch {
            // Edge already exists — bump its weight
            const existing = graph.edge(src, tgt);
            if (existing) {
                const prev = graph.getEdgeAttribute(existing, 'weight') ?? 1;
                graph.setEdgeAttribute(existing, 'weight', prev + 1);
            }
        }
    }
    return graph;
}
//# sourceMappingURL=build.js.map