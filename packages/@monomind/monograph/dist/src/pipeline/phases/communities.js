import louvain from 'graphology-communities-louvain';
import { leiden } from './leiden.js';
import { loadGraphFromEdges } from '../../graph/loader.js';
export function computeCohesion(communityId, memberships, edges) {
    const members = [...memberships.entries()].filter(([, c]) => c === communityId).map(([id]) => id);
    const n = members.length;
    if (n <= 1)
        return 1;
    const memberSet = new Set(members);
    const maxEdges = (n * (n - 1)) / 2; // undirected: n*(n-1)/2
    if (maxEdges === 0)
        return 1;
    // Count unique undirected internal edges
    const seen = new Set();
    let internalCount = 0;
    for (const e of edges) {
        if (memberSet.has(e.sourceId) && memberSet.has(e.targetId)) {
            const key = [e.sourceId, e.targetId].sort().join('\0');
            if (!seen.has(key)) {
                seen.add(key);
                internalCount++;
            }
        }
    }
    return internalCount / maxEdges;
}
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
export function computeAllCohesionScores(memberships, edges) {
    // Single pass over memberships: build communityId → Set<nodeId>
    const memberSets = new Map();
    for (const [nodeId, commId] of memberships) {
        let s = memberSets.get(commId);
        if (!s) {
            s = new Set();
            memberSets.set(commId, s);
        }
        s.add(nodeId);
    }
    // Single pass over edges: count unique undirected internal edges per community
    const internalEdgeCounts = new Map();
    const seenEdgeKeys = new Map();
    for (const e of edges) {
        const commSrc = memberships.get(e.sourceId);
        const commTgt = memberships.get(e.targetId);
        if (commSrc === undefined || commTgt === undefined || commSrc !== commTgt)
            continue;
        let seen = seenEdgeKeys.get(commSrc);
        if (!seen) {
            seen = new Set();
            seenEdgeKeys.set(commSrc, seen);
        }
        const key = e.sourceId < e.targetId
            ? `${e.sourceId}\0${e.targetId}`
            : `${e.targetId}\0${e.sourceId}`;
        if (!seen.has(key)) {
            seen.add(key);
            internalEdgeCounts.set(commSrc, (internalEdgeCounts.get(commSrc) ?? 0) + 1);
        }
    }
    // Compute final scores
    const scores = new Map();
    for (const [commId, members] of memberSets) {
        const n = members.size;
        if (n <= 1) {
            scores.set(commId, 1);
            continue;
        }
        const maxEdges = (n * (n - 1)) / 2;
        const internalCount = internalEdgeCounts.get(commId) ?? 0;
        scores.set(commId, maxEdges > 0 ? internalCount / maxEdges : 1);
    }
    return scores;
}
export const communitiesPhase = {
    name: 'communities',
    deps: ['parse', 'cross-file', 'mro'],
    async execute(_ctx, deps) {
        const { resolvedEdges } = deps.get('cross-file');
        const { allEdges } = deps.get('parse');
        const allUsedEdges = [...allEdges, ...resolvedEdges];
        const graph = loadGraphFromEdges(allUsedEdges);
        let communities = {};
        try {
            communities = leiden(graph, { seed: 42 });
        }
        catch (e) {
            console.warn('[monograph] Leiden failed, falling back to Louvain:', e);
            try {
                communities = louvain(graph, { randomWalk: false });
            }
            catch {
                // Empty or disconnected graph
            }
        }
        const memberships = new Map(Object.entries(communities).map(([k, v]) => [k, v]));
        const communityLabels = new Map();
        const communityDegrees = new Map();
        for (const [nodeId, commId] of memberships) {
            if (!communityDegrees.has(commId))
                communityDegrees.set(commId, new Map());
            const deg = graph.degree(nodeId) ?? 0;
            communityDegrees.get(commId).set(nodeId, deg);
        }
        for (const [commId, nodeDegs] of communityDegrees) {
            const topNode = [...nodeDegs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
            communityLabels.set(commId, `community-${commId}(${topNode.slice(0, 20)})`);
        }
        // Compute all cohesion scores in one O(N+E) pass instead of O(K*(N+E))
        const cohesionScores = computeAllCohesionScores(memberships, allUsedEdges);
        return { memberships, communityLabels, cohesionScores };
    },
};
/**
 * Split a community that is too large into smaller sub-groups.
 * By graphify convention, communities >25% of total graph nodes are split.
 */
export function splitOversizedCommunity(memberIds, maxGroupSize) {
    if (memberIds.length <= maxGroupSize)
        return [memberIds];
    const groups = [];
    for (let i = 0; i < memberIds.length; i += maxGroupSize) {
        groups.push(memberIds.slice(i, i + maxGroupSize));
    }
    return groups;
}
//# sourceMappingURL=communities.js.map