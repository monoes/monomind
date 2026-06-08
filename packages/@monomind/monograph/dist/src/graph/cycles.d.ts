import type { MonographDb } from '../storage/db.js';
/**
 * Find ALL strongly connected components (SCCs) using Kosaraju's algorithm.
 *
 * Returns every SCC, including singleton components (single nodes with no self-loop).
 * This is the full SCC decomposition of the graph.
 *
 * @param db - The MonographDb instance
 * @returns Array of SCCs; each SCC is an array of node ids in that component.
 */
export declare function findStronglyConnectedComponents(db: MonographDb): string[][];
/**
 * Find all strongly connected components (SCCs) with more than 1 node,
 * or self-loops, and return them as cycle node lists.
 *
 * Uses Kosaraju's algorithm to find SCCs. Each SCC with size > 1 represents
 * a cycle. Self-loops (node -> itself) are also detected separately.
 *
 * @param db - The MonographDb instance
 * @returns Array of cycles; each cycle is an array of node ids participating in it.
 */
export declare function findCycles(db: MonographDb): string[][];
//# sourceMappingURL=cycles.d.ts.map