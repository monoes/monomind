/**
 * Dependency health scoring.
 *
 * Produces a composite [0, 1] score by combining four sub-metrics:
 *
 *  1. Cycle penalty   — fraction of nodes involved in cycles (lower = worse)
 *  2. Dead-code ratio — fraction of nodes that are unreachable / unused
 *  3. Fan-out skew    — coefficient of variation of out-degrees (high skew = god nodes)
 *  4. God-node concentration — max in-degree / total edges (hub dominance)
 *
 * Final score = 1 − weighted average of penalties.
 * All individual penalty components are clamped to [0, 1].
 */
export interface DependencyHealthEdge {
    sourceId: string;
    targetId: string;
}
export interface DependencyHealthInput {
    /** All node IDs in the graph. */
    nodes: string[];
    /** All directed edges. */
    edges: DependencyHealthEdge[];
    /** Pre-computed number of cycles (e.g., from detectCycles). */
    cycleCount: number;
    /** Pre-computed count of dead nodes (e.g., from detectDeadCode). */
    deadNodeCount: number;
}
export interface DependencyHealthDetails {
    /** Fraction of nodes involved in cycles in [0, 1]. */
    cyclePenalty: number;
    /** Fraction of dead nodes in [0, 1]. */
    deadCodeRatio: number;
    /** Coefficient of variation for out-degree distribution (normalised to [0,1]). */
    fanSkew: number;
    /** Max in-degree / total edge count — hub dominance in [0, 1]. */
    godNodeConcentration: number;
}
export interface DependencyHealthResult {
    /** Composite health score in [0, 1] where 1 is perfectly healthy. */
    score: number;
    details: DependencyHealthDetails;
}
/**
 * Compute a composite dependency health score for the given graph.
 */
export declare function dependencyHealth(input: DependencyHealthInput): DependencyHealthResult;
/**
 * Format dependency health results as structured text for LLM consumption.
 */
export declare function formatDependencyHealth(result: DependencyHealthResult): string;
//# sourceMappingURL=dependency-health.d.ts.map