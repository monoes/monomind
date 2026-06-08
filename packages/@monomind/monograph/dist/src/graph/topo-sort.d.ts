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
 * @param db - The MonographDb instance
 * @returns Object with `levels` (array of independent groups, leaf-first) and `cycleCount`.
 */
export declare function topologicalLevelSort(db: MonographDb): TopoSortResult;
//# sourceMappingURL=topo-sort.d.ts.map