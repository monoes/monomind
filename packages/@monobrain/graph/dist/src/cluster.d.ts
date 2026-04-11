import type Graph from 'graphology';
/**
 * Run Louvain community detection on the graph.
 * Assigns the `community` attribute to each node in-place.
 * Returns a map from communityId → list of nodeIds.
 */
export declare function detectCommunities(graph: Graph): Promise<Record<number, string[]>>;
//# sourceMappingURL=cluster.d.ts.map