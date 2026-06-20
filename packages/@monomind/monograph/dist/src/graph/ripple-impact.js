/**
 * Ripple / cascade impact analysis.
 *
 * Given a starting node, perform a multi-hop BFS through *directed* edges and
 * compute how far a change can propagate.  Each depth level is assigned a
 * decaying weight so that direct dependents (depth 1) contribute more to the
 * totalScore than transitive dependents.
 *
 * Default decay factor: 0.5 per hop (configurable).
 */
/**
 * Build a directed outgoing adjacency map from an edge list.
 *
 * Callers that run rippleImpact for multiple starting nodes on the same edge set
 * should build once and pass the map directly to `rippleImpactFromMap`.
 */
export function buildOutgoingMap(edges) {
    const outgoing = new Map();
    for (const { sourceId, targetId } of edges) {
        if (!outgoing.has(sourceId))
            outgoing.set(sourceId, []);
        outgoing.get(sourceId).push(targetId);
    }
    return outgoing;
}
/**
 * Compute the ripple impact of changing `startNodeId` using a pre-built
 * outgoing adjacency map.
 *
 * Use this variant when querying multiple start nodes on the same edge set —
 * build the map once with `buildOutgoingMap` and reuse it across calls.
 *
 * @param startNodeId  The node whose change we are propagating.
 * @param outgoing     Pre-built directed adjacency map (source → targets).
 * @param maxDepth     Maximum BFS depth (default 3).
 * @param decayFactor  Weight multiplier per depth level (default 0.5).
 */
export function rippleImpactFromMap(startNodeId, outgoing, maxDepth = 3, decayFactor = 0.5) {
    if (!outgoing.has(startNodeId)) {
        return { byDepth: {}, totalScore: 0 };
    }
    const visited = new Set([startNodeId]);
    const byDepth = {};
    let frontier = [startNodeId];
    let totalScore = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
        const nextFrontier = [];
        for (const node of frontier) {
            for (const neighbor of outgoing.get(node) ?? []) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    nextFrontier.push(neighbor);
                }
            }
        }
        if (nextFrontier.length === 0)
            break;
        byDepth[depth] = nextFrontier;
        totalScore += nextFrontier.length * Math.pow(decayFactor, depth);
        frontier = nextFrontier;
    }
    return { byDepth, totalScore };
}
/**
 * Compute the ripple impact of changing `startNodeId`.
 *
 * Builds the adjacency map from `edges` on each call. For repeated queries
 * over the same edge set, prefer `buildOutgoingMap` + `rippleImpactFromMap`.
 *
 * @param startNodeId  The node whose change we are propagating.
 * @param edges        Directed edges in the graph.
 * @param maxDepth     Maximum BFS depth (default 3).
 * @param decayFactor  Weight multiplier per depth level (default 0.5).
 */
export function rippleImpact(startNodeId, edges, maxDepth = 3, decayFactor = 0.5) {
    return rippleImpactFromMap(startNodeId, buildOutgoingMap(edges), maxDepth, decayFactor);
}
/**
 * Format ripple impact results as structured text for LLM consumption.
 */
export function formatRippleImpact(startNodeId, result, nodeLabels) {
    const depths = Object.keys(result.byDepth).map(Number).sort((a, b) => a - b);
    if (depths.length === 0) {
        return `No ripple impact found for: ${startNodeId} (isolated or leaf node)`;
    }
    const lines = [
        `Ripple impact of changing: ${startNodeId}`,
        `  Total score: ${result.totalScore.toFixed(3)} (weighted cascade depth)`,
    ];
    for (const depth of depths) {
        const nodes = result.byDepth[depth];
        lines.push(`  Depth ${depth} (${nodes.length} node${nodes.length === 1 ? '' : 's'}):`);
        for (const id of nodes) {
            const label = nodeLabels?.get(id);
            lines.push(`    - ${id}${label ? ` [${label}]` : ''}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=ripple-impact.js.map