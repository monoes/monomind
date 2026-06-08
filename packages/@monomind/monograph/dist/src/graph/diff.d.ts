import type { MonographNode, MonographEdge } from '../types.js';
export interface GraphSnapshot {
    nodes: MonographNode[];
    edges: MonographEdge[];
    capturedAt: string;
}
export interface GraphDiff {
    newNodes: MonographNode[];
    removedNodes: MonographNode[];
    newEdges: MonographEdge[];
    removedEdges: MonographEdge[];
    modifiedNodes: Array<{
        before: MonographNode;
        after: MonographNode;
    }>;
    /** Human-readable summary, e.g. "3 new nodes, 5 new edges, 1 node removed". */
    summary: string;
}
export declare function diffSnapshots(before: GraphSnapshot, after: GraphSnapshot): GraphDiff;
export declare function snapshotFromDb(db: import('../storage/db.js').MonographDb): GraphSnapshot;
//# sourceMappingURL=diff.d.ts.map