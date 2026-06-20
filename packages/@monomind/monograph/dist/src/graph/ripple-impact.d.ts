/**
 * Ripple / cascade impact analysis.
 *
 * Given a starting node, perform a multi-hop BFS through *directed* edges and
 * compute how far a change can propagate.  Each depth level is assigned a
 * decaying weight so that direct dependents (depth 1) contribute more to the
 * totalScore than transitive dependents.
 *
 * Default decay factor: 0.5 per hop (configurable).
 */
export interface RippleEdge {
    sourceId: string;
    targetId: string;
}
export interface RippleResult {
    /** Nodes reachable at each depth, starting at depth 1 (direct neighbors). */
    byDepth: Record<number, string[]>;
    /** Weighted sum: Σ(count_at_depth * decay^depth). */
    totalScore: number;
}
/**
 * Build a directed outgoing adjacency map from an edge list.
 *
 * Callers that run rippleImpact for multiple starting nodes on the same edge set
 * should build once and pass the map directly to `rippleImpactFromMap`.
 */
export declare function buildOutgoingMap(edges: RippleEdge[]): Map<string, string[]>;
/**
 * Compute the ripple impact of changing `startNodeId` using a pre-built
 * outgoing adjacency map.
 *
 * Use this variant when querying multiple start nodes on the same edge set —
 * build the map once with `buildOutgoingMap` and reuse it across calls.
 *
 * @param startNodeId  The node whose change we are propagating.
 * @param outgoing     Pre-built directed adjacency map (source → targets).
 * @param maxDepth     Maximum BFS depth (default 3).
 * @param decayFactor  Weight multiplier per depth level (default 0.5).
 */
export declare function rippleImpactFromMap(startNodeId: string, outgoing: Map<string, string[]>, maxDepth?: number, decayFactor?: number): RippleResult;
/**
 * Compute the ripple impact of changing `startNodeId`.
 *
 * Builds the adjacency map from `edges` on each call. For repeated queries
 * over the same edge set, prefer `buildOutgoingMap` + `rippleImpactFromMap`.
 *
 * @param startNodeId  The node whose change we are propagating.
 * @param edges        Directed edges in the graph.
 * @param maxDepth     Maximum BFS depth (default 3).
 * @param decayFactor  Weight multiplier per depth level (default 0.5).
 */
export declare function rippleImpact(startNodeId: string, edges: RippleEdge[], maxDepth?: number, decayFactor?: number): RippleResult;
/**
 * Format ripple impact results as structured text for LLM consumption.
 */
export declare function formatRippleImpact(startNodeId: string, result: RippleResult, nodeLabels?: Map<string, string>): string;
//# sourceMappingURL=ripple-impact.d.ts.map