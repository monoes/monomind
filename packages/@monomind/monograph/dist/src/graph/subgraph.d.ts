import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';
export interface InducedSubgraph {
    nodes: MonographNode[];
    edges: MonographEdge[];
}
export declare function extractInducedSubgraph(db: MonographDb, nodeIds: string[]): InducedSubgraph;
//# sourceMappingURL=subgraph.d.ts.map