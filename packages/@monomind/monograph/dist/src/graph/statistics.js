import { bfsFromNode } from 'graphology-traversal/bfs.js';
import { loadGraphFromDb } from './loader.js';
// ---------------------------------------------------------------------------
// Module-level graph cache — avoids reloading the full graph on every call
// when multiple statistics functions are invoked in the same request cycle.
// TTL: 5 seconds; keyed by DB file path (better-sqlite3 exposes .name).
// ---------------------------------------------------------------------------
const GRAPH_CACHE_TTL_MS = 5_000;
const _graphCache = new Map();
function getGraph(db) {
    const key = db.name ?? '__default__';
    const now = Date.now();
    const cached = _graphCache.get(key);
    if (cached && now < cached.expiresAt)
        return cached.graph;
    const graph = loadGraphFromDb(db);
    _graphCache.set(key, { graph, expiresAt: now + GRAPH_CACHE_TTL_MS });
    return graph;
}
/**
 * Evict the cached graph for a given DB instance (call after writes).
 */
export function invalidateGraphCache(db) {
    const key = db.name ?? '__default__';
    _graphCache.delete(key);
}
/**
 * Graph density: ratio of actual edges to maximum possible directed edges.
 * For a directed graph with n nodes: max = n * (n - 1).
 * Ignores self-loops.
 */
export function graphDensity(db) {
    const graph = getGraph(db);
    const n = graph.order;
    if (n < 2)
        return 0;
    const maxEdges = n * (n - 1);
    // Use simple directed edge count (deduplicate multi-edges for density)
    const seen = new Set();
    graph.forEachEdge((_, _attr, src, tgt) => {
        if (src !== tgt)
            seen.add(`${src}→${tgt}`);
    });
    return seen.size / maxEdges;
}
/**
 * Average local clustering coefficient across all nodes.
 * For a directed graph, the local clustering coefficient of node v is:
 *   (triangles through v) / (directed_pairs through v)
 * where directed_pairs = k_in * k_out - mutual_pairs
 * We use the undirected approximation: treat edges as undirected, count triangles.
 */
export function clusteringCoefficient(db) {
    const graph = getGraph(db);
    if (graph.order === 0)
        return 0;
    // Build undirected adjacency sets
    const neighbors = new Map();
    graph.forEachNode(node => neighbors.set(node, new Set()));
    graph.forEachEdge((_, _attr, src, tgt) => {
        if (src !== tgt) {
            neighbors.get(src).add(tgt);
            neighbors.get(tgt).add(src);
        }
    });
    let totalCoeff = 0;
    let countWithNeighbors = 0;
    for (const [node, nbrs] of neighbors) {
        const k = nbrs.size;
        if (k < 2)
            continue;
        let triangles = 0;
        const nbList = [...nbrs];
        for (let i = 0; i < nbList.length; i++) {
            for (let j = i + 1; j < nbList.length; j++) {
                if (neighbors.get(nbList[i])?.has(nbList[j])) {
                    triangles++;
                }
            }
        }
        const possible = (k * (k - 1)) / 2;
        totalCoeff += triangles / possible;
        countWithNeighbors++;
    }
    if (countWithNeighbors === 0)
        return 0;
    return totalCoeff / countWithNeighbors;
}
/**
 * Compute both average path length and graph diameter in a single BFS pass.
 * Unreachable pairs are excluded from averagePathLength.
 */
export function pathStats(db) {
    const graph = getGraph(db);
    const nodes = graph.nodes();
    if (nodes.length < 2)
        return { averagePathLength: 0, diameter: 0 };
    let totalLength = 0;
    let reachablePairs = 0;
    let maxDist = 0;
    for (const source of nodes) {
        bfsFromNode(graph, source, (node, _attr, depth) => {
            if (node !== source && depth > 0) {
                totalLength += depth;
                reachablePairs++;
                if (depth > maxDist)
                    maxDist = depth;
            }
        });
    }
    return {
        averagePathLength: reachablePairs === 0 ? 0 : totalLength / reachablePairs,
        diameter: maxDist,
    };
}
/**
 * Average shortest path length across all reachable node pairs (i, j) where i ≠ j.
 * Computed using BFS from each node. Unreachable pairs are excluded from the average.
 *
 * @deprecated Prefer `pathStats(db).averagePathLength` to share BFS with `graphDiameter`.
 */
export function averagePathLength(db) {
    return pathStats(db).averagePathLength;
}
/**
 * Graph diameter: the maximum shortest path length across all reachable node pairs.
 * Returns 0 for empty or single-node graphs.
 *
 * @deprecated Prefer `pathStats(db).diameter` to share BFS with `averagePathLength`.
 */
export function graphDiameter(db) {
    return pathStats(db).diameter;
}
//# sourceMappingURL=statistics.js.map