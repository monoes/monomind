/**
 * Find the most connected nodes (god nodes) — core abstractions of the codebase.
 * Sorted by total degree (in + out), descending.
 */
export function godNodes(graph, topN = 15) {
    const nodes = [];
    graph.forEachNode((id, attrs) => {
        nodes.push({
            id,
            label: attrs.label || id,
            degree: graph.degree(id),
            community: attrs.community,
            sourceFile: attrs.sourceFile || '',
            neighbors: graph
                .neighbors(id)
                .slice(0, 8)
                .map((n) => graph.getNodeAttribute(n, 'label') || n),
        });
    });
    return nodes.sort((a, b) => b.degree - a.degree).slice(0, topN);
}
/**
 * Find surprising cross-community connections.
 * An edge is surprising when its endpoints belong to different communities.
 * Base score is degree(source) * degree(target), boosted by confidence and file type factors.
 */
export function surprisingConnections(graph, topN = 20) {
    const surprises = [];
    graph.forEachEdge((_, attrs, source, target) => {
        const cu = graph.getNodeAttribute(source, 'community');
        const cv = graph.getNodeAttribute(target, 'community');
        if (cu !== undefined && cv !== undefined && cu !== cv) {
            const confidence = attrs.confidence ?? 'AMBIGUOUS';
            const confidenceScore = attrs.confidenceScore;
            const sourceFileType = graph.getNodeAttribute(source, 'fileType');
            const targetFileType = graph.getNodeAttribute(target, 'fileType');
            let score = graph.degree(source) * graph.degree(target);
            // Boost for AMBIGUOUS edges — more uncertain = more surprising
            if (confidence === 'AMBIGUOUS')
                score *= 1.5;
            // Boost for cross-file-type connections
            if (sourceFileType && targetFileType && sourceFileType !== targetFileType)
                score *= 1.3;
            // Boost for INFERRED edges based on confidence score
            if (confidence === 'INFERRED')
                score *= 1 + (confidenceScore ?? 0.5);
            surprises.push({
                from: graph.getNodeAttribute(source, 'label') || source,
                fromCommunity: cu,
                fromFile: graph.getNodeAttribute(source, 'sourceFile') || '',
                to: graph.getNodeAttribute(target, 'label') || target,
                toCommunity: cv,
                toFile: graph.getNodeAttribute(target, 'sourceFile') || '',
                relation: attrs.relation || '',
                confidence,
                score,
            });
        }
    });
    return surprises.sort((a, b) => b.score - a.score).slice(0, topN);
}
/**
 * Compute high-level graph statistics.
 */
export function graphStats(graph, graphPath) {
    const confidence = {};
    const relations = {};
    const fileTypes = {};
    const commSet = new Set();
    graph.forEachEdge((_, attrs) => {
        const c = attrs.confidence || 'UNKNOWN';
        confidence[c] = (confidence[c] ?? 0) + 1;
        const r = attrs.relation || 'unknown';
        relations[r] = (relations[r] ?? 0) + 1;
    });
    graph.forEachNode((_, attrs) => {
        const ft = attrs.fileType || 'unknown';
        fileTypes[ft] = (fileTypes[ft] ?? 0) + 1;
        const c = attrs.community;
        if (c !== undefined)
            commSet.add(c);
    });
    const topRelations = Object.fromEntries(Object.entries(relations)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10));
    return {
        nodes: graph.order,
        edges: graph.size,
        communities: commSet.size,
        confidence: confidence,
        fileTypes,
        topRelations,
        isDirected: graph.type === 'directed',
        graphPath,
    };
}
/**
 * Build a complete GraphAnalysis object from an annotated graph.
 * Assumes community detection has already been run (nodes have `community` attribute).
 */
export function buildAnalysis(graph, graphPath) {
    const communities = {};
    graph.forEachNode((id, attrs) => {
        const c = attrs.community;
        if (c !== undefined) {
            if (!communities[c])
                communities[c] = [];
            communities[c].push(id);
        }
    });
    return {
        godNodes: godNodes(graph),
        surprises: surprisingConnections(graph),
        communities,
        stats: graphStats(graph, graphPath),
    };
}
/**
 * Generate clarifying questions about uncertain or structurally interesting graph patterns.
 * Sorted by priority (high → medium → low), capped at 25 total.
 */
export function suggestQuestions(graph, communities) {
    const questions = [];
    // Build communities map if not provided
    const commMap = communities ?? {};
    if (!communities) {
        graph.forEachNode((id, attrs) => {
            const c = attrs.community;
            if (c !== undefined) {
                if (!commMap[c])
                    commMap[c] = [];
                commMap[c].push(id);
            }
        });
    }
    // AMBIGUOUS_EDGE: cross-community edges with AMBIGUOUS confidence
    graph.forEachEdge((_, attrs, source, target) => {
        if (attrs.confidence !== 'AMBIGUOUS')
            return;
        const cu = graph.getNodeAttribute(source, 'community');
        const cv = graph.getNodeAttribute(target, 'community');
        if (cu === undefined || cv === undefined || cu === cv)
            return;
        const from = graph.getNodeAttribute(source, 'label') || source;
        const to = graph.getNodeAttribute(target, 'label') || target;
        questions.push({
            type: 'AMBIGUOUS_EDGE',
            question: `What is the exact relationship between ${from} and ${to}? The edge is marked AMBIGUOUS.`,
            nodes: [source, target],
            priority: 'high',
        });
    });
    // BRIDGE_NODE: nodes with neighbors in ≥3 different communities (simple heuristic)
    const bridgeCandidates = [];
    graph.forEachNode((id, attrs) => {
        const neighborComms = new Set();
        graph.neighbors(id).forEach((n) => {
            const c = graph.getNodeAttribute(n, 'community');
            if (c !== undefined)
                neighborComms.add(c);
        });
        if (neighborComms.size >= 3) {
            bridgeCandidates.push({
                id,
                label: attrs.label || id,
                comms: Array.from(neighborComms),
            });
        }
    });
    bridgeCandidates
        .sort((a, b) => b.comms.length - a.comms.length)
        .slice(0, 5)
        .forEach(({ id, label, comms }) => {
        questions.push({
            type: 'BRIDGE_NODE',
            question: `Is ${label} intentionally a bridge between communities [${comms.join(', ')}]? Should it be split?`,
            nodes: [id],
            priority: 'high',
        });
    });
    // INFERRED_GOD_NODE: top 5 high-degree nodes where >50% of edges are INFERRED
    const inferredGodNodes = [];
    graph.forEachNode((id, attrs) => {
        const edges = graph.edges(id);
        if (edges.length === 0)
            return;
        const inferredCount = edges.filter((e) => graph.getEdgeAttribute(e, 'confidence') === 'INFERRED').length;
        if (inferredCount / edges.length > 0.5) {
            inferredGodNodes.push({
                id,
                label: attrs.label || id,
                degree: graph.degree(id),
            });
        }
    });
    inferredGodNodes
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 5)
        .forEach(({ id, label }) => {
        questions.push({
            type: 'INFERRED_GOD_NODE',
            question: `Verify the connections of ${label}: most edges are inferred, not extracted.`,
            nodes: [id],
            priority: 'medium',
        });
    });
    // LOW_COHESION_COMMUNITY: communities where >70% of edges are cross-community
    const commIds = Object.keys(commMap).map(Number);
    const lowCohesion = [];
    for (const commId of commIds) {
        const members = new Set(commMap[commId] ?? []);
        if (members.size === 0)
            continue;
        let total = 0;
        let crossEdges = 0;
        members.forEach((nodeId) => {
            graph.edges(nodeId).forEach((e) => {
                total++;
                const src = graph.source(e);
                const tgt = graph.target(e);
                const otherNode = src === nodeId ? tgt : src;
                if (!members.has(otherNode))
                    crossEdges++;
            });
        });
        // Each edge is counted twice (once per endpoint), halve the totals
        total = Math.ceil(total / 2);
        crossEdges = Math.ceil(crossEdges / 2);
        if (total > 0 && crossEdges / total > 0.7) {
            lowCohesion.push({ id: commId, ratio: crossEdges / total });
        }
    }
    lowCohesion
        .sort((a, b) => b.ratio - a.ratio)
        .slice(0, 3)
        .forEach(({ id }) => {
        questions.push({
            type: 'LOW_COHESION_COMMUNITY',
            question: `Community ${id} has low cohesion. Should it be split or reorganized?`,
            nodes: commMap[id] ?? [],
            priority: 'medium',
        });
    });
    // ISOLATED_NODE: degree 0
    let isolatedCount = 0;
    graph.forEachNode((id, attrs) => {
        if (isolatedCount >= 10)
            return;
        if (graph.degree(id) === 0) {
            const label = attrs.label || id;
            questions.push({
                type: 'ISOLATED_NODE',
                question: `Why is ${label} isolated (no connections)? It may need imports/references added.`,
                nodes: [id],
                priority: 'low',
            });
            isolatedCount++;
        }
    });
    // Sort by priority: high → medium → low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    questions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    return questions.slice(0, 25);
}
/**
 * Compute the diff between two serialized graph snapshots.
 */
export function graphDiff(before, after) {
    const beforeNodeIds = new Set(before.nodes.map((n) => n.id));
    const afterNodeIds = new Set(after.nodes.map((n) => n.id));
    const addedNodes = after.nodes.filter((n) => !beforeNodeIds.has(n.id)).map((n) => n.id);
    const removedNodes = before.nodes.filter((n) => !afterNodeIds.has(n.id)).map((n) => n.id);
    const edgeKey = (e) => `${String(e.source)}|${String(e.target)}|${String(e['relation'] ?? '')}`;
    const beforeEdgeKeys = new Set(before.links.map(edgeKey));
    const afterEdgeKeys = new Set(after.links.map(edgeKey));
    const addedEdges = after.links
        .filter((e) => !beforeEdgeKeys.has(edgeKey(e)))
        .map((e) => ({ source: String(e.source), target: String(e.target), relation: String(e['relation'] ?? '') }));
    const removedEdges = before.links
        .filter((e) => !afterEdgeKeys.has(edgeKey(e)))
        .map((e) => ({ source: String(e.source), target: String(e.target), relation: String(e['relation'] ?? '') }));
    // Community changes: nodes present in both snapshots with a changed community attribute
    const beforeNodeMap = new Map(before.nodes.map((n) => [n.id, n]));
    const communityChanges = [];
    for (const afterNode of after.nodes) {
        const beforeNode = beforeNodeMap.get(afterNode.id);
        if (!beforeNode)
            continue;
        const oldCommunity = beforeNode['community'];
        const newCommunity = afterNode['community'];
        if (oldCommunity !== undefined && newCommunity !== undefined && oldCommunity !== newCommunity) {
            communityChanges.push({ node: afterNode.id, oldCommunity, newCommunity });
        }
    }
    return { addedNodes, removedNodes, addedEdges, removedEdges, communityChanges };
}
//# sourceMappingURL=analyze.js.map