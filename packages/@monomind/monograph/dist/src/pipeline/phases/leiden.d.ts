import type Graph from 'graphology';
/**
 * Leiden-like community detection with post-processing refinement.
 *
 * Since `graphology-communities-leiden` does not exist as a published package,
 * this module implements a two-phase approach that improves on plain Louvain:
 *
 * Phase 1: Run Louvain with randomWalk disabled for deterministic output.
 * Phase 2: Merge singleton communities (size === 1) into the largest
 *           neighboring community, which mirrors the Leiden refinement idea
 *           of guaranteeing well-connected communities.
 *
 * The result is seed-stable because Louvain is run deterministically
 * (randomWalk: false) and the refinement step is purely deterministic.
 *
 * @param graph  Any graphology Graph instance (directed or undirected).
 * @returns      A mapping of nodeId → communityId (numeric).
 */
export declare function leiden(graph: Graph, _options?: {
    seed?: number;
}): Record<string, number>;
//# sourceMappingURL=leiden.d.ts.map