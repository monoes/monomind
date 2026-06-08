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
export declare const communitiesPhase: PipelinePhase<CommunitiesOutput>;
/**
 * Split a community that is too large into smaller sub-groups.
 * By graphify convention, communities >25% of total graph nodes are split.
 */
export declare function splitOversizedCommunity(memberIds: string[], maxGroupSize: number): string[][];
//# sourceMappingURL=communities.d.ts.map