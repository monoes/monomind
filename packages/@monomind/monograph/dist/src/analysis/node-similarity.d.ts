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
 */
export declare function buildNeighborMap(edges: SimilarityEdge[]): Map<string, Set<string>>;
/**
 * Compute the Jaccard similarity between two sets.
 * Returns 0 when both sets are empty.
 */
export declare function jaccardSimilarity(a: Set<string>, b: Set<string>): number;
/**
 * Find the k most similar nodes to `nodeId` by Jaccard neighbor overlap.
 *
 * Only nodes with score > 0 are returned (no shared neighbors → excluded).
 * Results are sorted descending by score.
 */
export declare function findSimilarNodes(nodeId: string, edges: SimilarityEdge[], k: number): SimilarNode[];
//# sourceMappingURL=node-similarity.d.ts.map