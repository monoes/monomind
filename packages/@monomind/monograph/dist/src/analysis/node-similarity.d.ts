/**
 * Graph node similarity using Jaccard coefficient.
 *
 * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Two nodes are similar if they share many common neighbors.
 * This is useful for finding structurally equivalent nodes or
 * recommending related modules in a codebase graph.
 */
export type SimilarityEdge = {
    sourceId: string;
    targetId: string;
};
export interface SimilarNode {
    nodeId: string;
    score: number;
}
/**
 * Build an undirected neighbor map from an edge list.
 * Callers that invoke findSimilarNodes for multiple nodes on the same edge set
 * should build once and pass the map directly to findSimilarNodesFromMap.
 */
export declare function buildNeighborMap(edges: SimilarityEdge[]): Map<string, Set<string>>;
/**
 * Compute the Jaccard similarity between two sets.
 * Returns 0 when both sets are empty.
 */
export declare function jaccardSimilarity(a: Set<string>, b: Set<string>): number;
/**
 * Find the k most similar nodes to `nodeId` using a pre-built neighbor map.
 *
 * Use this variant when querying multiple nodes against the same edge set —
 * build the map once with `buildNeighborMap` and reuse it across calls.
 *
 * Only nodes with score > 0 are returned (no shared neighbors → excluded).
 * Results are sorted descending by score.
 */
export declare function findSimilarNodesFromMap(nodeId: string, neighborMap: Map<string, Set<string>>, k: number): SimilarNode[];
/**
 * Find the k most similar nodes to `nodeId` by Jaccard neighbor overlap.
 *
 * Builds the neighbor map from `edges` on each call. For repeated queries
 * over the same edge set, prefer `buildNeighborMap` + `findSimilarNodesFromMap`.
 *
 * Only nodes with score > 0 are returned (no shared neighbors → excluded).
 * Results are sorted descending by score.
 */
export declare function findSimilarNodes(nodeId: string, edges: SimilarityEdge[], k: number): SimilarNode[];
/**
 * Format similar-node results as structured text for LLM consumption.
 */
export declare function formatSimilarNodes(nodeId: string, results: SimilarNode[], nodeLabels?: Map<string, string>): string;
//# sourceMappingURL=node-similarity.d.ts.map