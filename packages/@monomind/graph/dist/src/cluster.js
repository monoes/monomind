import Graph from 'graphology';
export async function detectCommunities(graph) {
    let louvainFn = null;
    try {
        const mod = await import('graphology-communities-louvain');
        louvainFn = mod.default;
    }
    catch { /* louvain not available */ }
    if (louvainFn) {
        try {
            const assignment = louvainFn(graph);
            for (const [nodeId, communityId] of Object.entries(assignment)) {
                graph.setNodeAttribute(nodeId, 'community', communityId);
            }
            const communities = {};
            for (const [nodeId, communityId] of Object.entries(assignment)) {
                if (!communities[communityId])
                    communities[communityId] = [];
                communities[communityId].push(nodeId);
            }
            return splitOversizedCommunities(graph, communities, 0.25, louvainFn);
        }
        catch { /* fall through */ }
    }
    return splitOversizedCommunities(graph, fallbackCluster(graph), 0.25, louvainFn);
}
function fallbackCluster(graph) {
    const dirMap = new Map();
    let nextId = 0;
    const communities = {};
    graph.forEachNode((id, attrs) => {
        const file = attrs.sourceFile || '';
        const parts = file.split('/');
        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';
        if (!dirMap.has(dir))
            dirMap.set(dir, nextId++);
        const cid = dirMap.get(dir);
        graph.setNodeAttribute(id, 'community', cid);
        if (!communities[cid])
            communities[cid] = [];
        communities[cid].push(id);
    });
    return communities;
}
export function cohesionScore(graph, communityNodes) {
    const memberSet = new Set(communityNodes);
    let totalEdges = 0;
    let internalEdges = 0;
    graph.forEachEdge((_edge, _attrs, source, target) => {
        const srcIn = memberSet.has(source);
        const tgtIn = memberSet.has(target);
        if (srcIn || tgtIn) {
            totalEdges++;
            if (srcIn && tgtIn)
                internalEdges++;
        }
    });
    return totalEdges === 0 ? 1.0 : internalEdges / totalEdges;
}
export function splitOversizedCommunities(graph, communities, threshold = 0.25, louvainFn = null) {
    const maxSize = threshold * graph.order;
    const allIds = Object.keys(communities).map(Number);
    let nextId = allIds.length > 0 ? Math.max(...allIds) + 1 : 0;
    for (const [cidStr, members] of Object.entries(communities)) {
        if (members.length <= maxSize)
            continue;
        const cid = Number(cidStr);
        // Attempt topology-based second pass via Louvain on the community subgraph
        if (louvainFn && members.length >= 10) {
            try {
                const memberSet = new Set(members);
                const subG = new Graph({ type: 'undirected', multi: false });
                for (const nodeId of members)
                    subG.addNode(nodeId);
                graph.forEachEdge((_e, _a, source, target) => {
                    if (memberSet.has(source) && memberSet.has(target) && source !== target && !subG.hasEdge(source, target))
                        subG.addEdge(source, target);
                });
                const subAssignment = louvainFn(subG);
                const subCommunityCount = new Set(Object.values(subAssignment)).size;
                if (subCommunityCount > 1 && subCommunityCount <= Math.ceil(members.length / 2)) {
                    const subIdMap = new Map();
                    const newSubIds = {};
                    for (const [nodeId, localId] of Object.entries(subAssignment)) {
                        if (!subIdMap.has(localId))
                            subIdMap.set(localId, nextId++);
                        const globalId = subIdMap.get(localId);
                        graph.setNodeAttribute(nodeId, 'community', globalId);
                        if (!newSubIds[globalId])
                            newSubIds[globalId] = [];
                        newSubIds[globalId].push(nodeId);
                    }
                    delete communities[cid];
                    Object.assign(communities, newSubIds);
                    continue;
                }
            }
            catch { /* fall through to directory heuristic */ }
        }
        // Directory heuristic fallback
        const subMap = new Map();
        const newSubIds = {};
        for (const nodeId of members) {
            const file = graph.getNodeAttribute(nodeId, 'sourceFile') || '';
            const parts = file.split('/');
            const parentDir = parts.length > 1 ? parts[parts.length - 2] : 'root';
            if (!subMap.has(parentDir))
                subMap.set(parentDir, nextId++);
            const subId = subMap.get(parentDir);
            graph.setNodeAttribute(nodeId, 'community', subId);
            if (!newSubIds[subId])
                newSubIds[subId] = [];
            newSubIds[subId].push(nodeId);
        }
        delete communities[cid];
        Object.assign(communities, newSubIds);
    }
    return communities;
}
//# sourceMappingURL=cluster.js.map