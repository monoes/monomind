import { bfsFromNode } from 'graphology-traversal/bfs.js';
import { loadGraphFromDb } from './loader.js';
/**
 * Graph density: ratio of actual edges to maximum possible directed edges.
 * For a directed graph with n nodes: max = n * (n - 1).
 * Ignores self-loops.
 */
export function graphDensity(db) {
    const graph = loadGraphFromDb(db);
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
    const graph = loadGraphFromDb(db);
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
 * Average shortest path length across all reachable node pairs (i, j) where i ≠ j.
 * Computed using BFS from each node. Unreachable pairs are excluded from the average.
 */
export function averagePathLength(db) {
    const graph = loadGraphFromDb(db);
    const nodes = graph.nodes();
    if (nodes.length < 2)
        return 0;
    let totalLength = 0;
    let reachablePairs = 0;
    for (const source of nodes) {
        const distances = new Map();
        distances.set(source, 0);
        bfsFromNode(graph, source, (node, _attr, depth) => {
            if (node !== source) {
                distances.set(node, depth);
            }
        });
        for (const [target, dist] of distances) {
            if (target !== source && dist > 0) {
                totalLength += dist;
                reachablePairs++;
            }
        }
    }
    if (reachablePairs === 0)
        return 0;
    return totalLength / reachablePairs;
}
/**
 * Graph diameter: the maximum shortest path length across all reachable node pairs.
 * Returns 0 for empty or single-node graphs.
 */
export function graphDiameter(db) {
    const graph = loadGraphFromDb(db);
    const nodes = graph.nodes();
    if (nodes.length < 2)
        return 0;
    let maxDist = 0;
    for (const source of nodes) {
        const distances = new Map();
        distances.set(source, 0);
        bfsFromNode(graph, source, (node, _attr, depth) => {
            if (node !== source) {
                distances.set(node, depth);
            }
        });
        for (const [target, dist] of distances) {
            if (target !== source && dist > maxDist) {
                maxDist = dist;
            }
        }
    }
    return maxDist;
}
//# sourceMappingURL=statistics.js.map