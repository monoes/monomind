import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';
export interface InducedSubgraph {
    nodes: MonographNode[];
    edges: MonographEdge[];
}
export declare function extractInducedSubgraph(db: MonographDb, nodeIds: string[]): InducedSubgraph;
/**
 * Format an InducedSubgraph as structured text for LLM consumption.
 * Groups nodes by file path and lists edges with relation + file:line hints.
 */
export declare function formatInducedSubgraph(sg: InducedSubgraph): string;
//# sourceMappingURL=subgraph.d.ts.map