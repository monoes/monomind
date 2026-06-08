/**
 * Find ALL strongly connected components (SCCs) using Kosaraju's algorithm.
 *
 * Returns every SCC, including singleton components (single nodes with no self-loop).
 * This is the full SCC decomposition of the graph.
 *
 * @param db - The MonographDb instance
 * @returns Array of SCCs; each SCC is an array of node ids in that component.
 */
export function findStronglyConnectedComponents(db) {
    const nodeRows = db.prepare('SELECT id FROM nodes').all();
    const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all();
    if (nodeRows.length === 0)
        return [];
    const nodes = nodeRows.map(r => r.id);
    const nodeSet = new Set(nodes);
    const adj = new Map();
    const radj = new Map();
    for (const n of nodes) {
        adj.set(n, []);
        radj.set(n, []);
    }
    for (const { source_id: src, target_id: tgt } of edgeRows) {
        if (!nodeSet.has(src) || !nodeSet.has(tgt))
            continue;
        if (src === tgt)
            continue;
        adj.get(src).push(tgt);
        radj.get(tgt).push(src);
    }
    const visited = new Set();
    const finishOrder = [];
    function dfs1(node) {
        visited.add(node);
        for (const neighbor of adj.get(node) ?? []) {
            if (!visited.has(neighbor))
                dfs1(neighbor);
        }
        finishOrder.push(node);
    }
    for (const node of nodes) {
        if (!visited.has(node))
            dfs1(node);
    }
    const assigned = new Set();
    const sccs = [];
    function dfs2(node, component) {
        assigned.add(node);
        component.push(node);
        for (const neighbor of radj.get(node) ?? []) {
            if (!assigned.has(neighbor))
                dfs2(neighbor, component);
        }
    }
    for (let i = finishOrder.length - 1; i >= 0; i--) {
        const node = finishOrder[i];
        if (!assigned.has(node)) {
            const component = [];
            dfs2(node, component);
            sccs.push(component);
        }
    }
    return sccs;
}
/**
 * Find all strongly connected components (SCCs) with more than 1 node,
 * or self-loops, and return them as cycle node lists.
 *
 * Uses Kosaraju's algorithm to find SCCs. Each SCC with size > 1 represents
 * a cycle. Self-loops (node -> itself) are also detected separately.
 *
 * @param db - The MonographDb instance
 * @returns Array of cycles; each cycle is an array of node ids participating in it.
 */
export function findCycles(db) {
    const nodeRows = db.prepare('SELECT id FROM nodes').all();
    const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all();
    if (nodeRows.length === 0)
        return [];
    const nodes = nodeRows.map(r => r.id);
    const nodeSet = new Set(nodes);
    // Build adjacency list and reverse adjacency list
    const adj = new Map();
    const radj = new Map();
    for (const n of nodes) {
        adj.set(n, []);
        radj.set(n, []);
    }
    const selfLoops = new Set();
    for (const { source_id: src, target_id: tgt } of edgeRows) {
        if (!nodeSet.has(src) || !nodeSet.has(tgt))
            continue;
        if (src === tgt) {
            selfLoops.add(src);
            continue;
        }
        adj.get(src).push(tgt);
        radj.get(tgt).push(src);
    }
    // Kosaraju's algorithm — pass 1: DFS on original graph, build finish order
    const visited = new Set();
    const finishOrder = [];
    function dfs1(node) {
        visited.add(node);
        for (const neighbor of adj.get(node) ?? []) {
            if (!visited.has(neighbor))
                dfs1(neighbor);
        }
        finishOrder.push(node);
    }
    for (const node of nodes) {
        if (!visited.has(node))
            dfs1(node);
    }
    // Kosaraju's algorithm — pass 2: DFS on reverse graph in reverse finish order
    const assigned = new Set();
    const sccs = [];
    function dfs2(node, component) {
        assigned.add(node);
        component.push(node);
        for (const neighbor of radj.get(node) ?? []) {
            if (!assigned.has(neighbor))
                dfs2(neighbor, component);
        }
    }
    for (let i = finishOrder.length - 1; i >= 0; i--) {
        const node = finishOrder[i];
        if (!assigned.has(node)) {
            const component = [];
            dfs2(node, component);
            if (component.length > 1) {
                sccs.push(component);
            }
        }
    }
    // Add self-loops as single-element cycles
    for (const node of selfLoops) {
        sccs.push([node]);
    }
    return sccs;
}
//# sourceMappingURL=cycles.js.map