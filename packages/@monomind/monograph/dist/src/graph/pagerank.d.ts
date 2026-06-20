import type { MonographDb } from '../storage/db.js';
export interface PageRankOptions {
    /** Damping factor (probability of following an edge). Default: 0.85 */
    dampingFactor?: number;
    /** Maximum number of power-iteration steps. Default: 100 */
    maxIterations?: number;
    /** Convergence threshold (L1 norm delta). Default: 1e-6 */
    tolerance?: number;
}
/**
 * Evict cached statements and results for a given DB instance (call after writes).
 */
export declare function invalidatePageRankCache(db: MonographDb): void;
/**
 * Compute PageRank scores for all nodes using power iteration.
 *
 * Each node's score is initialized to 1/N (so scores sum to 1).
 * After convergence the scores still sum to ~1 (standard normalized PageRank).
 * Dangling nodes (out-degree 0) distribute their rank equally to all nodes.
 *
 * Results are cached for 5 seconds when the graph's node+edge counts are
 * unchanged, making repeated calls (e.g. during context preloading) free.
 *
 * @param db - The MonographDb instance
 * @param options - Optional tuning parameters
 * @returns Map of nodeId → PageRank score
 */
export declare function pageRank(db: MonographDb, options?: PageRankOptions): Map<string, number>;
//# sourceMappingURL=pagerank.d.ts.map