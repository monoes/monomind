import type { PipelinePhase } from '../types.js';
export interface CommunitiesOutput {
    memberships: Map<string, number>;
    communityLabels: Map<number, string>;
    cohesionScores: Map<number, number>;
}
export declare function computeCohesion(communityId: number, memberships: Map<string, number>, edges: Array<{
    sourceId: string;
    targetId: string;
}>): number;
/**
 * Compute cohesion scores for all communities in a single O(N+E) pass.
 *
 * This replaces calling `computeCohesion` inside a loop, which was O(K*(N+E))
 * because each call re-scanned all memberships (O(N)) and all edges (O(E)).
 *
 * @param memberships - nodeId → communityId map from the clustering step
 * @param edges - all edges used for the graph (IMPORTS + resolved)
 * @returns Map of communityId → cohesion score ∈ [0, 1]
 */
export declare function computeAllCohesionScores(memberships: Map<string, number>, edges: Array<{
    sourceId: string;
    targetId: string;
}>): Map<number, number>;
export declare const communitiesPhase: PipelinePhase<CommunitiesOutput>;
/**
 * Split a community that is too large into smaller sub-groups.
 * By graphify convention, communities >25% of total graph nodes are split.
 */
export declare function splitOversizedCommunity(memberIds: string[], maxGroupSize: number): string[][];
//# sourceMappingURL=communities.d.ts.map