import type { MonographDb } from '../storage/db.js';
/**
 * Evict the cached graph for a given DB instance (call after writes).
 */
export declare function invalidateGraphCache(db: MonographDb): void;
/**
 * Graph density: ratio of actual edges to maximum possible directed edges.
 * For a directed graph with n nodes: max = n * (n - 1).
 * Ignores self-loops.
 */
export declare function graphDensity(db: MonographDb): number;
/**
 * Average local clustering coefficient across all nodes.
 * For a directed graph, the local clustering coefficient of node v is:
 *   (triangles through v) / (directed_pairs through v)
 * where directed_pairs = k_in * k_out - mutual_pairs
 * We use the undirected approximation: treat edges as undirected, count triangles.
 */
export declare function clusteringCoefficient(db: MonographDb): number;
export interface PathStats {
    /** Average shortest path length across all reachable pairs (i ≠ j). */
    averagePathLength: number;
    /** Maximum shortest path length (diameter) across all reachable pairs. */
    diameter: number;
}
/**
 * Compute both average path length and graph diameter in a single BFS pass.
 * Unreachable pairs are excluded from averagePathLength.
 */
export declare function pathStats(db: MonographDb): PathStats;
/**
 * Average shortest path length across all reachable node pairs (i, j) where i ≠ j.
 * Computed using BFS from each node. Unreachable pairs are excluded from the average.
 *
 * @deprecated Prefer `pathStats(db).averagePathLength` to share BFS with `graphDiameter`.
 */
export declare function averagePathLength(db: MonographDb): number;
/**
 * Graph diameter: the maximum shortest path length across all reachable node pairs.
 * Returns 0 for empty or single-node graphs.
 *
 * @deprecated Prefer `pathStats(db).diameter` to share BFS with `averagePathLength`.
 */
export declare function graphDiameter(db: MonographDb): number;
//# sourceMappingURL=statistics.d.ts.map