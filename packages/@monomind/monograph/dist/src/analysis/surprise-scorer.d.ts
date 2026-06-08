export interface ScoredNode {
    id: string;
    degree: number;
    avgDegree: number;
    crossCommunityEdges: number;
    totalEdges: number;
    stalenessScore: number;
    communityId?: string;
}
export interface SurpriseOptions {
    degreeWeight?: number;
    crossCommunityWeight?: number;
    stalenessWeight?: number;
}
/**
 * Compute a multi-factor surprise score for a single node.
 *
 * The score combines:
 * - Degree anomaly: how far the node's degree deviates from the graph average
 * - Cross-community ratio: what fraction of edges cross community boundaries
 * - Staleness: how stale the node is (from git-based staleness scoring)
 *
 * @returns A value in [0, 1] where higher means more surprising / worth investigating.
 */
export declare function computeSurpriseScore(node: ScoredNode, opts?: SurpriseOptions): number;
/**
 * Score a collection of nodes and return them sorted by surprise score descending.
 */
export declare function scoreNodes(nodes: ScoredNode[], opts?: SurpriseOptions): Array<ScoredNode & {
    surpriseScore: number;
}>;
//# sourceMappingURL=surprise-scorer.d.ts.map