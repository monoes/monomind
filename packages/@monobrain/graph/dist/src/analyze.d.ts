import type Graph from 'graphology';
import type { GodNode, SurpriseEdge, GraphAnalysis, GraphStats, GraphQuestion, GraphDiff, SerializedGraph } from './types.js';
/**
 * Find the most connected nodes (god nodes) — core abstractions of the codebase.
 * Sorted by total degree (in + out), descending.
 */
export declare function godNodes(graph: Graph, topN?: number): GodNode[];
/**
 * Find surprising cross-community connections.
 * An edge is surprising when its endpoints belong to different communities.
 * Base score is degree(source) * degree(target), boosted by confidence and file type factors.
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
/**
 * Generate clarifying questions about uncertain or structurally interesting graph patterns.
 * Sorted by priority (high → medium → low), capped at 25 total.
 */
export declare function suggestQuestions(graph: Graph, communities?: Record<number, string[]>): GraphQuestion[];
/**
 * Compute the diff between two serialized graph snapshots.
 */
export declare function graphDiff(before: SerializedGraph, after: SerializedGraph): GraphDiff;
//# sourceMappingURL=analyze.d.ts.map