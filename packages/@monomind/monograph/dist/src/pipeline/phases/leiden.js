import louvain from 'graphology-communities-louvain';
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
export function leiden(graph, _options = {}) {
    if (graph.order === 0) {
        return {};
    }
    // Phase 1: Louvain with deterministic settings
    const communities = louvain(graph, { randomWalk: false });
    // Phase 2: Refinement — merge singletons into their largest neighbor's community
    const communitySizes = new Map();
    for (const comm of Object.values(communities)) {
        communitySizes.set(comm, (communitySizes.get(comm) ?? 0) + 1);
    }
    // Refinement: merge singletons into their largest neighbor's community.
    // Pass 1: update communitySizes eagerly (so adjacent singletons see each other's moves
    //         and avoid mutual-swap cycles), collect community writes into `pending`.
    // Pass 2: apply community writes — keeps the community map consistent at all times.
    const pending = new Map();
    for (const [nodeId, commId] of Object.entries(communities)) {
        if ((communitySizes.get(commId) ?? 0) <= 1) {
            let bestComm = commId;
            let bestSize = 0;
            graph.forEachNeighbor(nodeId, (neighbor) => {
                const neighborComm = communities[neighbor];
                if (neighborComm === undefined)
                    return;
                const size = communitySizes.get(neighborComm) ?? 0;
                if (size > bestSize) {
                    bestSize = size;
                    bestComm = neighborComm;
                }
            });
            if (bestComm !== commId) {
                // Update sizes eagerly so subsequent singletons see the correct community sizes
                communitySizes.set(commId, (communitySizes.get(commId) ?? 1) - 1);
                communitySizes.set(bestComm, (communitySizes.get(bestComm) ?? 0) + 1);
                pending.set(nodeId, bestComm);
            }
        }
    }
    // Apply deferred community writes
    for (const [nodeId, bestComm] of pending) {
        communities[nodeId] = bestComm;
    }
    return communities;
}
//# sourceMappingURL=leiden.js.map