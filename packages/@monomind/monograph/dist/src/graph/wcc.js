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
    const { parent, rank } = buildUnionFind(nodes);
    for (const { source_id: src, target_id: tgt } of edgeRows) {
        if (src === tgt)
            continue;
        if (!parent.has(src) || !parent.has(tgt))
            continue;
        ufUnion(parent, rank, src, tgt);
    }
    return groupByRoot(nodes, parent);
}
/**
 * Lightweight summary statistics for all WCCs.
 * Does not materialise component arrays — returns aggregate numbers only.
 */
export function wccStats(db) {
    const components = weaklyConnectedComponents(db);
    if (components.length === 0) {
        return { componentCount: 0, largestSize: 0, smallestSize: 0, meanSize: 0, isolatedNodeCount: 0 };
    }
    const sizes = components.map(c => c.length);
    const total = sizes.reduce((a, b) => a + b, 0);
    return {
        componentCount: sizes.length,
        largestSize: sizes[0], // already sorted descending
        smallestSize: sizes[sizes.length - 1],
        meanSize: Math.round((total / sizes.length) * 100) / 100,
        isolatedNodeCount: sizes.filter(s => s === 1).length,
    };
}
// ---------------------------------------------------------------------------
// Structured text formatter for LLM consumption
// ---------------------------------------------------------------------------
/**
 * Format WCC results as structured text for LLM consumption.
 *
 * Resolves node IDs to names and file paths for the top-N largest components.
 * Small/isolated components are summarised in aggregate to avoid token waste.
 *
 * @param db - The MonographDb instance (for name resolution)
 * @param components - Result of weaklyConnectedComponents()
 * @param topN - Number of largest components to detail (default: 5)
 * @returns Structured text string suitable for LLM context injection
 */
export function formatWcc(db, components, topN = 5) {
    if (components.length === 0) {
        return 'Weakly connected components: no nodes found.';
    }
    const isolatedCount = components.filter(c => c.length === 1).length;
    const nonTrivial = components.filter(c => c.length > 1);
    const display = nonTrivial.slice(0, topN);
    // Batch-resolve all node IDs in the displayed components
    const allIds = display.flat();
    const CHUNK = 200;
    const nodeInfo = new Map();
    for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        const ph = chunk.map(() => '?').join(',');
        const rows = db
            .prepare(`SELECT id, name, file_path FROM nodes WHERE id IN (${ph})`)
            .all(...chunk);
        for (const row of rows)
            nodeInfo.set(row.id, { name: row.name ?? row.id, filePath: row.file_path });
    }
    const lines = [
        `Weakly connected components: ${components.length} total` +
            (isolatedCount > 0 ? ` (${isolatedCount} isolated node${isolatedCount === 1 ? '' : 's'})` : ''),
        '',
    ];
    for (let ci = 0; ci < display.length; ci++) {
        const comp = display[ci];
        lines.push(`Component ${ci + 1} (${comp.length} nodes):`);
        for (const id of comp) {
            const info = nodeInfo.get(id);
            const name = info?.name ?? id;
            const fp = info?.filePath;
            lines.push(`  ${name}${fp ? ` — ${fp}` : ''}`);
        }
        if (ci < display.length - 1)
            lines.push('');
    }
    if (nonTrivial.length > topN) {
        lines.push('');
        lines.push(`... (${nonTrivial.length - topN} more non-trivial component${nonTrivial.length - topN === 1 ? '' : 's'} omitted)`);
    }
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// Internal union-find helpers
// ---------------------------------------------------------------------------
function buildUnionFind(nodes) {
    const parent = new Map();
    const rank = new Map();
    for (const n of nodes) {
        parent.set(n, n);
        rank.set(n, 0);
    }
    return { parent, rank };
}
function ufFind(parent, x) {
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
function ufUnion(parent, rank, a, b) {
    const ra = ufFind(parent, a);
    const rb = ufFind(parent, b);
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
function groupByRoot(nodes, parent) {
    const components = new Map();
    for (const n of nodes) {
        const root = ufFind(parent, n);
        if (!components.has(root))
            components.set(root, []);
        components.get(root).push(n);
    }
    return [...components.values()].sort((a, b) => b.length - a.length);
}
//# sourceMappingURL=wcc.js.map