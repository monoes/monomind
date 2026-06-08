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
 * Compute the ripple impact of changing `startNodeId`.
 *
 * @param startNodeId  The node whose change we are propagating.
 * @param edges        Directed edges in the graph.
 * @param maxDepth     Maximum BFS depth (default 3).
 * @param decayFactor  Weight multiplier per depth level (default 0.5).
 */
export declare function rippleImpact(startNodeId: string, edges: RippleEdge[], maxDepth?: number, decayFactor?: number): RippleResult;
//# sourceMappingURL=ripple-impact.d.ts.map