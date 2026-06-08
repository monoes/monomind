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
        const communityIds = new Set([...memberships.values()]);
        const cohesionScores = new Map();
        for (const cid of communityIds) {
            cohesionScores.set(cid, computeCohesion(cid, memberships, allUsedEdges));
        }
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