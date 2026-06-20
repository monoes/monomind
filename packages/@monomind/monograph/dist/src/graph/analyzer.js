import { bidirectional } from 'graphology-shortest-path';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness.js';
import { loadGraphFromDb } from './loader.js';
// ── TTL graph cache ───────────────────────────────────────────────────────────
// Avoids loading the full graph from the DB multiple times in the same request
// window (e.g. when getShortestPath and getBetweennessCentrality are called
// back-to-back on the same DB instance).
const GRAPH_CACHE_TTL_MS = 30_000;
const graphCache = new WeakMap();
function getOrLoadGraph(db) {
    const cached = graphCache.get(db);
    if (cached && Date.now() < cached.expiresAt)
        return cached.graph;
    const graph = loadGraphFromDb(db);
    graphCache.set(db, { graph, expiresAt: Date.now() + GRAPH_CACHE_TTL_MS });
    return graph;
}
// ─────────────────────────────────────────────────────────────────────────────
export function getShortestPath(db, sourceId, targetId, maxDepth = 6) {
    const graph = getOrLoadGraph(db);
    if (!graph.hasNode(sourceId) || !graph.hasNode(targetId))
        return null;
    try {
        const path = bidirectional(graph, sourceId, targetId);
        if (path && path.length <= maxDepth + 1)
            return path;
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Computes betweenness centrality for all nodes in the graph.
 * Returns a Map from node id to centrality score (0–1 normalized).
 *
 * Betweenness centrality measures how often a node appears on the
 * shortest path between other node pairs. High-centrality nodes are
 * structural bridges — refactoring them has wide blast radius.
 */
export function getBetweennessCentrality(db) {
    const graph = getOrLoadGraph(db);
    if (graph.order === 0)
        return new Map();
    const scores = betweennessCentrality(graph, { normalized: true });
    return new Map(Object.entries(scores));
}
export function getNodeDegrees(graph, nodeId) {
    if (!graph.hasNode(nodeId))
        return { in: 0, out: 0 };
    return {
        in: graph.inDegree ? graph.inDegree(nodeId) : 0,
        out: graph.outDegree ? graph.outDegree(nodeId) : 0,
    };
}
//# sourceMappingURL=analyzer.js.map