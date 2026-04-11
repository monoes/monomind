import type Graph from 'graphology';
import type { GodNode, SurpriseEdge, GraphAnalysis, GraphStats } from './types.js';
/**
 * Find the most connected nodes (god nodes) — core abstractions of the codebase.
 * Sorted by total degree (in + out), descending.
 */
export declare function godNodes(graph: Graph, topN?: number): GodNode[];
/**
 * Find surprising cross-community connections.
 * An edge is surprising when its endpoints belong to different communities.
 * Scored by the product of their degrees — high degree on both sides = high surprise.
 */
export declare function surprisingConnections(graph: Graph, topN?: number): SurpriseEdge[];
/**
 * Compute high-level graph statistics.
 */
export declare function graphStats(graph: Graph, graphPath?: string): GraphStats;
/**
 * Build a complete GraphAnalysis object from an annotated graph.
 * Assumes community detection has already been run (nodes have `community` attribute).
 */
export declare function buildAnalysis(graph: Graph, graphPath?: string): GraphAnalysis;
//# sourceMappingURL=analyze.d.ts.map