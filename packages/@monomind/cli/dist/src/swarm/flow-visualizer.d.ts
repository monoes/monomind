/**
 * Flow Visualizer (Task 40)
 *
 * ASCII and DOT (Graphviz) renderers for communication flow edges.
 */
import type { FlowEdge } from '../../../shared/src/types/communication-flow.js';
/**
 * Render edges as human-readable ASCII art.
 * Empty edges produce a single-line "unrestricted" notice.
 */
export declare function toAscii(edges: FlowEdge[], title?: string): string;
/**
 * Render edges as a DOT language digraph (Graphviz compatible).
 * Slugs are escaped so a malicious slug cannot inject DOT attributes
 * (e.g., URL="javascript:..." would be rendered as a clickable link
 * by Graphviz's SVG output without escaping).
 */
export declare function toDOT(edges: FlowEdge[], graphName?: string): string;
//# sourceMappingURL=flow-visualizer.d.ts.map