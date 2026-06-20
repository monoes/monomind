import type { MonographDb } from '../storage/db.js';
/**
 * Find ALL strongly connected components (SCCs) using iterative Kosaraju's algorithm.
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
 * Uses iterative Kosaraju's algorithm to avoid stack overflow on large graphs.
 * Each SCC with size > 1 represents a cycle. Self-loops are also detected.
 *
 * @param db - The MonographDb instance
 * @returns Array of cycles; each cycle is an array of node ids participating in it.
 */
export declare function findCycles(db: MonographDb): string[][];
/**
 * Format cycle results as structured text with file:line hints for LLM navigation.
 *
 * @param cycles - Array of cycle arrays (node ids / file paths)
 * @param nodeToFile - Optional map from node id to file path for resolving paths
 * @returns Structured text output suitable for LLM consumption
 */
export declare function formatCycles(cycles: string[][], nodeToFile?: Map<string, string>): string;
//# sourceMappingURL=cycles.d.ts.map