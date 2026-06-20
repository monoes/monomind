/** Build adjacency maps from DB rows (shared by both exports). */
function buildAdjacency(nodes, edgeRows) {
    const nodeSet = new Set(nodes);
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
    return { adj, radj, selfLoops };
}
/** Iterative DFS pass 1: populate finish order (replaces recursive dfs1). */
function iterativeDfs1(roots, adj, visited, finishOrder) {
    for (const root of roots) {
        if (visited.has(root))
            continue;
        // Stack entries: [node, neighborIndex]
        const stack = [[root, 0]];
        visited.add(root);
        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const [node, idx] = frame;
            const neighbors = adj.get(node) ?? [];
            if (idx < neighbors.length) {
                frame[1]++;
                const neighbor = neighbors[idx];
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    stack.push([neighbor, 0]);
                }
            }
            else {
                stack.pop();
                finishOrder.push(node);
            }
        }
    }
}
/** Iterative DFS pass 2: collect SCC component (replaces recursive dfs2). */
function iterativeDfs2(root, radj, assigned, component) {
    const stack = [root];
    assigned.add(root);
    while (stack.length > 0) {
        const node = stack.pop();
        component.push(node);
        for (const neighbor of radj.get(node) ?? []) {
            if (!assigned.has(neighbor)) {
                assigned.add(neighbor);
                stack.push(neighbor);
            }
        }
    }
}
/**
 * Fetch nodes and edges once and return raw rows (shared helper).
 */
function fetchGraphRows(db) {
    const nodeRows = db.prepare('SELECT id FROM nodes').all();
    const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all();
    return { nodes: nodeRows.map(r => r.id), edgeRows };
}
/**
 * Find ALL strongly connected components (SCCs) using iterative Kosaraju's algorithm.
 *
 * Returns every SCC, including singleton components (single nodes with no self-loop).
 * This is the full SCC decomposition of the graph.
 *
 * @param db - The MonographDb instance
 * @returns Array of SCCs; each SCC is an array of node ids in that component.
 */
export function findStronglyConnectedComponents(db) {
    const { nodes, edgeRows } = fetchGraphRows(db);
    if (nodes.length === 0)
        return [];
    const { adj, radj } = buildAdjacency(nodes, edgeRows);
    const visited = new Set();
    const finishOrder = [];
    iterativeDfs1(nodes, adj, visited, finishOrder);
    const assigned = new Set();
    const sccs = [];
    for (let i = finishOrder.length - 1; i >= 0; i--) {
        const node = finishOrder[i];
        if (!assigned.has(node)) {
            const component = [];
            iterativeDfs2(node, radj, assigned, component);
            sccs.push(component);
        }
    }
    return sccs;
}
/**
 * Find all strongly connected components (SCCs) with more than 1 node,
 * or self-loops, and return them as cycle node lists.
 *
 * Uses iterative Kosaraju's algorithm to avoid stack overflow on large graphs.
 * Each SCC with size > 1 represents a cycle. Self-loops are also detected.
 *
 * @param db - The MonographDb instance
 * @returns Array of cycles; each cycle is an array of node ids participating in it.
 */
export function findCycles(db) {
    const { nodes, edgeRows } = fetchGraphRows(db);
    if (nodes.length === 0)
        return [];
    const { adj, radj, selfLoops } = buildAdjacency(nodes, edgeRows);
    // Pass 1: iterative DFS on original graph, build finish order
    const visited = new Set();
    const finishOrder = [];
    iterativeDfs1(nodes, adj, visited, finishOrder);
    // Pass 2: iterative DFS on reverse graph in reverse finish order
    const assigned = new Set();
    const sccs = [];
    for (let i = finishOrder.length - 1; i >= 0; i--) {
        const node = finishOrder[i];
        if (!assigned.has(node)) {
            const component = [];
            iterativeDfs2(node, radj, assigned, component);
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
/**
 * Format cycle results as structured text with file:line hints for LLM navigation.
 *
 * @param cycles - Array of cycle arrays (node ids / file paths)
 * @param nodeToFile - Optional map from node id to file path for resolving paths
 * @returns Structured text output suitable for LLM consumption
 */
export function formatCycles(cycles, nodeToFile) {
    if (cycles.length === 0) {
        return 'cycles: none\nstatus: no circular dependencies detected\n';
    }
    const resolve = (id) => nodeToFile?.get(id) ?? id;
    const lines = [
        `cycles: ${cycles.length} circular dependency group(s) found`,
        '',
    ];
    // Sort by cycle length ascending, then alphabetically
    const sorted = [...cycles].sort((a, b) => {
        if (a.length !== b.length)
            return a.length - b.length;
        return resolve(a[0]).localeCompare(resolve(b[0]));
    });
    sorted.forEach((cycle, i) => {
        const isSelfLoop = cycle.length === 1;
        const label = isSelfLoop ? 'self-loop' : `cycle(${cycle.length})`;
        lines.push(`[${i + 1}] ${label}`);
        for (const node of cycle) {
            lines.push(`  file: ${resolve(node)}:1`);
        }
        if (!isSelfLoop) {
            // Show the closing edge
            lines.push(`  closes: ${resolve(cycle[cycle.length - 1])} → ${resolve(cycle[0])}`);
        }
        lines.push('');
    });
    const selfLoopCount = sorted.filter(c => c.length === 1).length;
    const multiNodeCount = sorted.length - selfLoopCount;
    lines.push(`summary: ${multiNodeCount} multi-node cycle(s), ${selfLoopCount} self-loop(s)`);
    return lines.join('\n');
}
//# sourceMappingURL=cycles.js.map