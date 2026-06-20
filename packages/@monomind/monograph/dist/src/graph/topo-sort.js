/**
 * Topological level sort using Kahn's algorithm on the *reverse* import graph.
 *
 * In the reverse graph, an edge A→B in the original (A imports B) becomes B→A.
 * Files with no incoming edges on the reverse graph (i.e., no one imports them)
 * are leaves and appear in level 0.
 *
 * The in-degree computation is pushed into SQL (GROUP BY aggregation) to avoid
 * materialising the full edge table into JavaScript memory.
 *
 * @param db - The MonographDb instance
 * @returns Object with `levels` (array of independent groups, leaf-first) and `cycleCount`.
 */
export function topologicalLevelSort(db) {
    const nodeRows = db.prepare('SELECT id FROM nodes').all();
    if (nodeRows.length === 0)
        return { levels: [], cycleCount: 0 };
    const nodes = nodeRows.map(r => r.id);
    // Compute in-degree (on the reverse graph) via SQL aggregation.
    // In the original graph each edge src→tgt means "src imports tgt".
    // In the reverse graph the edge becomes tgt→src, so src gains in-degree +1.
    // We aggregate target_id counts grouped by source_id to get reverse-in-degree per node.
    const inDegreeRows = db
        .prepare(`SELECT source_id AS node_id, COUNT(*) AS cnt
       FROM edges
       WHERE source_id != target_id
       GROUP BY source_id`)
        .all();
    const inDegree = new Map();
    for (const n of nodes)
        inDegree.set(n, 0);
    for (const { node_id, cnt } of inDegreeRows) {
        if (inDegree.has(node_id))
            inDegree.set(node_id, cnt);
    }
    // Build reverse adjacency list — still needed for Kahn's BFS relaxation step.
    // Fetch only what Kahn needs: target_id → [source_id, ...] (reverse direction).
    const reverseAdj = new Map();
    for (const n of nodes)
        reverseAdj.set(n, []);
    const edgeRows = db
        .prepare('SELECT source_id, target_id FROM edges WHERE source_id != target_id')
        .all();
    for (const { source_id: src, target_id: tgt } of edgeRows) {
        if (!reverseAdj.has(tgt) || !reverseAdj.has(src))
            continue;
        reverseAdj.get(tgt).push(src);
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
// ---------------------------------------------------------------------------
// Structured text formatter for LLM consumption
// ---------------------------------------------------------------------------
/**
 * Format topological sort levels as structured text.
 *
 * Resolves node IDs to names and file paths so LLMs can navigate directly
 * to the source. Cycle nodes (if any) are clearly labelled.
 *
 * @param db - The MonographDb instance (for name resolution)
 * @param result - Result from topologicalLevelSort()
 * @param maxLevels - Max levels to include in output (default: all)
 * @returns Structured text suitable for injection into LLM context
 */
export function formatTopoSort(db, result, maxLevels) {
    if (result.levels.length === 0) {
        return 'Topological sort: no nodes found.';
    }
    // Batch-resolve all node IDs
    const allIds = result.levels.flat();
    const CHUNK = 200;
    const nodeInfo = new Map();
    for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        const ph = chunk.map(() => '?').join(',');
        const rows = db
            .prepare(`SELECT id, name, file_path FROM nodes WHERE id IN (${ph})`)
            .all(...chunk);
        for (const row of rows) {
            nodeInfo.set(row.id, { name: row.name ?? row.id, filePath: row.file_path });
        }
    }
    const isCycleLevelIdx = result.cycleCount > 0 && result.levels.length > 0
        ? result.levels.length - 1
        : -1;
    const displayLevels = maxLevels !== undefined ? result.levels.slice(0, maxLevels) : result.levels;
    const lines = [
        `Topological sort: ${result.levels.length - (result.cycleCount > 0 ? 1 : 0)} level${result.levels.length === 1 ? '' : 's'}` +
            (result.cycleCount > 0 ? `, ${result.cycleCount} node${result.cycleCount === 1 ? '' : 's'} in cycles` : ''),
        '',
    ];
    for (let li = 0; li < displayLevels.length; li++) {
        const level = displayLevels[li];
        const label = li === isCycleLevelIdx ? 'Cycle nodes (unresolvable order)' : `Level ${li}`;
        lines.push(`${label} (${level.length} node${level.length === 1 ? '' : 's'}):`);
        for (const id of level) {
            const info = nodeInfo.get(id);
            const name = info?.name ?? id;
            const fp = info?.filePath;
            lines.push(`  ${name}${fp ? ` — ${fp}` : ''}`);
        }
        lines.push('');
    }
    if (maxLevels !== undefined && result.levels.length > maxLevels) {
        lines.push(`... (${result.levels.length - maxLevels} more level${result.levels.length - maxLevels === 1 ? '' : 's'} omitted)`);
    }
    return lines.join('\n').trimEnd();
}
//# sourceMappingURL=topo-sort.js.map