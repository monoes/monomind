/**
 * Find all weakly connected components (WCCs) of the graph.
 *
 * Treats the directed graph as undirected: an edge A→B connects A and B
 * regardless of direction. Uses union-find (disjoint-set) for O(α·n) performance.
 *
 * @param db - The MonographDb instance
 * @returns Array of components; each component is an array of node ids.
 *          Sorted so the largest component comes first.
 */
export function weaklyConnectedComponents(db) {
    const nodeRows = db.prepare('SELECT id FROM nodes').all();
    const edgeRows = db.prepare('SELECT source_id, target_id FROM edges').all();
    if (nodeRows.length === 0)
        return [];
    const nodes = nodeRows.map(r => r.id);
    // Union-Find
    const parent = new Map();
    const rank = new Map();
    for (const n of nodes) {
        parent.set(n, n);
        rank.set(n, 0);
    }
    function find(x) {
        let root = x;
        while (parent.get(root) !== root)
            root = parent.get(root);
        // Path compression
        let cur = x;
        while (cur !== root) {
            const next = parent.get(cur);
            parent.set(cur, root);
            cur = next;
        }
        return root;
    }
    function union(a, b) {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb)
            return;
        const rankA = rank.get(ra) ?? 0;
        const rankB = rank.get(rb) ?? 0;
        if (rankA < rankB) {
            parent.set(ra, rb);
        }
        else if (rankA > rankB) {
            parent.set(rb, ra);
        }
        else {
            parent.set(rb, ra);
            rank.set(ra, rankA + 1);
        }
    }
    for (const { source_id: src, target_id: tgt } of edgeRows) {
        if (src === tgt)
            continue;
        if (!parent.has(src) || !parent.has(tgt))
            continue;
        union(src, tgt);
    }
    // Group nodes by root
    const components = new Map();
    for (const n of nodes) {
        const root = find(n);
        if (!components.has(root))
            components.set(root, []);
        components.get(root).push(n);
    }
    // Return sorted by size descending
    return [...components.values()].sort((a, b) => b.length - a.length);
}
//# sourceMappingURL=wcc.js.map