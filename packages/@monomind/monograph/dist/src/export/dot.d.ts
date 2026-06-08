import type { MonographNode, MonographEdge } from '../types.js';
export interface DotOptions {
    graphName?: string;
}
/**
 * Export nodes and edges to Graphviz DOT format.
 *
 * @param nodes - Array of MonographNode objects
 * @param edges - Array of MonographEdge objects
 * @param options - Optional configuration (graphName)
 * @returns A DOT format string suitable for Graphviz
 */
export declare function toDot(nodes: MonographNode[], edges: MonographEdge[], options?: DotOptions): string;
//# sourceMappingURL=dot.d.ts.map