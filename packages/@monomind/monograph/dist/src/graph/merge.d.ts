import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';
export type MergeConflictStrategy = 
/** Skip the incoming node/edge if one with the same id already exists (default). */
'skip'
/** Replace the existing node/edge with the incoming one. */
 | 'replace';
export interface GraphMergeOptions {
    /** How to handle id collisions. Default: 'skip'. */
    onConflict?: MergeConflictStrategy;
}
export interface GraphMergeResult {
    nodesAdded: number;
    nodesSkipped: number;
    edgesAdded: number;
    edgesSkipped: number;
}
/**
 * Merge two sets of nodes and edges into a single deduplicated set.
 *
 * @param base   - The base graph (nodes + edges).
 * @param incoming - The graph to merge in.
 * @param options  - Conflict resolution strategy.
 * @returns Merged nodes + edges, plus per-type counters.
 */
export declare function mergeGraphs(base: {
    nodes: MonographNode[];
    edges: MonographEdge[];
}, incoming: {
    nodes: MonographNode[];
    edges: MonographEdge[];
}, options?: GraphMergeOptions): {
    nodes: MonographNode[];
    edges: MonographEdge[];
} & GraphMergeResult;
/**
 * Merge incoming nodes and edges into an existing MonographDb.
 *
 * Nodes are inserted via INSERT OR IGNORE (skip) or INSERT OR REPLACE (replace).
 * Edges are handled the same way.
 *
 * @param targetDb  - The destination database.
 * @param incoming  - The graph data to merge in.
 * @param options   - Conflict resolution strategy.
 * @returns Per-type counters.
 */
export declare function mergeGraphIntoDb(targetDb: MonographDb, incoming: {
    nodes: MonographNode[];
    edges: MonographEdge[];
}, options?: GraphMergeOptions): GraphMergeResult;
//# sourceMappingURL=merge.d.ts.map