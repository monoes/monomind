/**
 * Graph node similarity using Jaccard coefficient.
 *
 * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Two nodes are similar if they share many common neighbors.
 * This is useful for finding structurally equivalent nodes or
 * recommending related modules in a codebase graph.
 */
/**
 * Build an undirected neighbor map from an edge list.
 */
export function buildNeighborMap(edges) {
    const neighbors = new Map();
    for (const { sourceId, targetId } of edges) {
        if (!neighbors.has(sourceId))
            neighbors.set(sourceId, new Set());
        if (!neighbors.has(targetId))
            neighbors.set(targetId, new Set());
        neighbors.get(sourceId).add(targetId);
        neighbors.get(targetId).add(sourceId);
    }
    return neighbors;
}
/**
 * Compute the Jaccard similarity between two sets.
 * Returns 0 when both sets are empty.
 */
export function jaccardSimilarity(a, b) {
    if (a.size === 0 && b.size === 0)
        return 0;
    let intersection = 0;
    for (const item of a) {
        if (b.has(item))
            intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}
/**
 * Find the k most similar nodes to `nodeId` by Jaccard neighbor overlap.
 *
 * Only nodes with score > 0 are returned (no shared neighbors → excluded).
 * Results are sorted descending by score.
 */
export function findSimilarNodes(nodeId, edges, k) {
    const neighborMap = buildNeighborMap(edges);
    const targetNeighbors = neighborMap.get(nodeId);
    if (!targetNeighbors || targetNeighbors.size === 0)
        return [];
    const results = [];
    for (const [candidate, candidateNeighbors] of neighborMap) {
        if (candidate === nodeId)
            continue;
        const score = jaccardSimilarity(targetNeighbors, candidateNeighbors);
        if (score > 0) {
            results.push({ nodeId: candidate, score });
        }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
}
//# sourceMappingURL=node-similarity.js.map