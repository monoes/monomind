import type { MonographDb } from '../storage/db.js';
/**
 * Find all weakly connected components (WCCs) of the graph.
 *
 * Treats the directed graph as undirected: an edge A→B connects A and B
 * regardless of direction. Uses union-find (disjoint-set) for O(α·n) performance.
 *
 * @param db - The MonographDb instance
 * @returns Array of components; each component is an array of node ids.
 *          Sorted so the largest component comes first.
 */
export declare function weaklyConnectedComponents(db: MonographDb): string[][];
export interface WccStats {
    /** Total number of weakly connected components */
    componentCount: number;
    /** Size of the largest component */
    largestSize: number;
    /** Size of the smallest component */
    smallestSize: number;
    /** Mean component size */
    meanSize: number;
    /** Number of isolated nodes (component size = 1) */
    isolatedNodeCount: number;
}
/**
 * Lightweight summary statistics for all WCCs.
 * Does not materialise component arrays — returns aggregate numbers only.
 */
export declare function wccStats(db: MonographDb): WccStats;
/**
 * Format WCC results as structured text for LLM consumption.
 *
 * Resolves node IDs to names and file paths for the top-N largest components.
 * Small/isolated components are summarised in aggregate to avoid token waste.
 *
 * @param db - The MonographDb instance (for name resolution)
 * @param components - Result of weaklyConnectedComponents()
 * @param topN - Number of largest components to detail (default: 5)
 * @returns Structured text string suitable for LLM context injection
 */
export declare function formatWcc(db: MonographDb, components: string[][], topN?: number): string;
//# sourceMappingURL=wcc.d.ts.map