import type { MonographNode, MonographEdge } from '../types.js';
/**
 * Converts a knowledge graph to Mermaid flowchart syntax.
 *
 * - Nodes are grouped into subgraphs by communityId when present.
 * - Edges use `-->` for EXTRACTED confidence and `-.->` for INFERRED/AMBIGUOUS.
 * - Edge labels show the relation type.
 * - Diagram is capped at 200 nodes to avoid extremely large output.
 */
export declare function toMermaid(nodes: MonographNode[], edges: MonographEdge[]): string;
//# sourceMappingURL=mermaid.d.ts.map