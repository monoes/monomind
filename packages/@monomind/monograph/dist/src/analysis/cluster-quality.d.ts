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
 */
export declare function silhouetteScore(memberships: Map<string, number>, edges: Edge[]): number;
/**
 * Compute Newman–Girvan modularity Q.
 *
 * Q = (1/2m) * Σ_{ij} [A_ij - k_i*k_j/(2m)] * δ(c_i, c_j)
 *
 * where m = total edge count, k_i = degree of node i, A_ij = adjacency.
 * Returns a value in (-0.5, 1].
 */
export declare function modularityScore(memberships: Map<string, number>, edges: Edge[]): number;
//# sourceMappingURL=cluster-quality.d.ts.map