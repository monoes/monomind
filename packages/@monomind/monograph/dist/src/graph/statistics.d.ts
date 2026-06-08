import type { MonographDb } from '../storage/db.js';
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
/**
 * Average shortest path length across all reachable node pairs (i, j) where i ≠ j.
 * Computed using BFS from each node. Unreachable pairs are excluded from the average.
 */
export declare function averagePathLength(db: MonographDb): number;
/**
 * Graph diameter: the maximum shortest path length across all reachable node pairs.
 * Returns 0 for empty or single-node graphs.
 */
export declare function graphDiameter(db: MonographDb): number;
//# sourceMappingURL=statistics.d.ts.map