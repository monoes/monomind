import type { MonographDb } from '../storage/db.js';
export interface TopoSortResult {
    /** Groups of nodes that can be processed independently at each level.
     *  Level 0 = leaves (nodes with no outgoing IMPORTS edges on the reverse graph).
     *  Higher levels depend on previous levels. Cycle nodes are appended last. */
    levels: string[][];
    /** Number of nodes that are part of a cycle and could not be sorted. */
    cycleCount: number;
}
/**
 * Topological level sort using Kahn's algorithm on the *reverse* import graph.
 *
 * In the reverse graph, an edge A→B in the original (A imports B) becomes B→A.
 * Files with no incoming edges on the reverse graph (i.e., no one imports them)
 * are leaves and appear in level 0.
 *
 * The in-degree computation is pushed into SQL (GROUP BY aggregation) to avoid
 * materialising the full edge table into JavaScript memory.
 *
 * @param db - The MonographDb instance
 * @returns Object with `levels` (array of independent groups, leaf-first) and `cycleCount`.
 */
export declare function topologicalLevelSort(db: MonographDb): TopoSortResult;
/**
 * Format topological sort levels as structured text.
 *
 * Resolves node IDs to names and file paths so LLMs can navigate directly
 * to the source. Cycle nodes (if any) are clearly labelled.
 *
 * @param db - The MonographDb instance (for name resolution)
 * @param result - Result from topologicalLevelSort()
 * @param maxLevels - Max levels to include in output (default: all)
 * @returns Structured text suitable for injection into LLM context
 */
export declare function formatTopoSort(db: MonographDb, result: TopoSortResult, maxLevels?: number): string;
//# sourceMappingURL=topo-sort.d.ts.map