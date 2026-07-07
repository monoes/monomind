/**
 * Cluster quality metrics: silhouette score and modularity score.
 *
 * References:
 *  - Silhouette: Rousseeuw (1987) — (b-a)/max(a,b) averaged over all nodes
 *  - Modularity: Newman & Girvan (2004) — Q = Σ[e_ii - a_i²]
 */
export type Edge = {
    sourceId: string;
    targetId: string;
};
/**
 * Compute the average silhouette score for the partitioning.
 * Returns a value in [-1, 1] where higher is better.
 *
 * Precomputes the communityMembers map once (O(N)) before the per-node loop,
 * reducing overall complexity from O(N²) to O(N + K*N) where K = community count.
 */
export declare function silhouetteScore(memberships: Map<string, number>, edges: Edge[]): number;
/**
 * Compute Newman–Girvan modularity Q using the community-level formula:
 *   Q = Σ_c [e_c / m - (a_c / 2m)²]
 * where e_c = intra-community edges, a_c = sum of degrees in community c, m = total edges.
 *
 * O(E + N) instead of O(N²).
 * Returns a value in (-0.5, 1].
 */
export declare function modularityScore(memberships: Map<string, number>, edges: Edge[]): number;
//# sourceMappingURL=cluster-quality.d.ts.map