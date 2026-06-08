import type { MonographNode, MonographEdge } from '../types.js';
/**
 * Export nodes and edges to GEXF (Graph Exchange XML Format) string.
 *
 * GEXF is the format used by Gephi and similar graph visualization tools.
 *
 * @param nodes - Array of MonographNode objects
 * @param edges - Array of MonographEdge objects
 * @returns A GEXF XML string
 */
export declare function toGexf(nodes: MonographNode[], edges: MonographEdge[]): string;
//# sourceMappingURL=gexf.d.ts.map