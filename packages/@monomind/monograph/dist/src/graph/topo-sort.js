/**
 * Topological level sort using Kahn's algorithm on the *reverse* import graph.
 *
 * In the reverse graph, an edge A→B in the original (A imports B) becomes B→A.
 * Files with no incoming edges on the reverse graph (i.e., no one imports them)
 * are leaves and appear in level 0.
 *
 * @param db - The MonographDb instance
 * @returns Object with `levels` (array of independent groups, leaf-first) and `cycleCount`.
 */
export function topologicalLevelSort(db) {
    const nodeRows = db.prepare('SELECT id FROM nodes').all();
    const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all();
    if (nodeRows.length === 0)
        return { levels: [], cycleCount: 0 };
    const nodes = nodeRows.map(r => r.id);
    // Build reverse graph: original edge src→tgt becomes tgt→src in reverse
    // In-degree in the reverse graph = number of nodes that tgt imports (out-degree in original)
    const reverseAdj = new Map();
    const inDegree = new Map();
    for (const n of nodes) {
        reverseAdj.set(n, []);
        inDegree.set(n, 0);
    }
    for (const { source_id: src, target_id: tgt } of edgeRows) {
        if (src === tgt)
            continue; // skip self-loops
        if (!reverseAdj.has(tgt) || !reverseAdj.has(src))
            continue;
        reverseAdj.get(tgt).push(src);
        inDegree.set(src, (inDegree.get(src) ?? 0) + 1);
    }
    // Kahn's BFS on the reverse graph
    const queue = [];
    for (const [node, deg] of inDegree) {
        if (deg === 0)
            queue.push(node);
    }
    const levels = [];
    const visited = new Set();
    while (queue.length > 0) {
        // All nodes currently at in-degree 0 form one level
        const level = [...queue];
        queue.length = 0;
        levels.push(level);
        for (const node of level) {
            visited.add(node);
            for (const neighbor of reverseAdj.get(node) ?? []) {
                if (visited.has(neighbor))
                    continue;
                const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
                inDegree.set(neighbor, newDeg);
                if (newDeg === 0)
                    queue.push(neighbor);
            }
        }
    }
    // Remaining unvisited nodes are in cycles
    const cycleNodes = nodes.filter(n => !visited.has(n));
    let cycleCount = 0;
    if (cycleNodes.length > 0) {
        cycleCount = cycleNodes.length;
        levels.push(cycleNodes);
    }
    return { levels, cycleCount };
}
//# sourceMappingURL=topo-sort.js.map