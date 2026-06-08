import type Graph from 'graphology';
import type { MonographDb } from '../storage/db.js';
export declare function getShortestPath(db: MonographDb, sourceId: string, targetId: string, maxDepth?: number): string[] | null;
/**
 * Computes betweenness centrality for all nodes in the graph.
 * Returns a Map from node id to centrality score (0–1 normalized).
 *
 * Betweenness centrality measures how often a node appears on the
 * shortest path between other node pairs. High-centrality nodes are
 * structural bridges — refactoring them has wide blast radius.
 */
export declare function getBetweennessCentrality(db: MonographDb): Map<string, number>;
export declare function getNodeDegrees(graph: Graph, nodeId: string): {
    in: number;
    out: number;
};
//# sourceMappingURL=analyzer.d.ts.map