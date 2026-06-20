/**
 * Trace all import chains (paths) from `sourceId` to `targetId`.
 *
 * Uses frontier-based BFS with lazy edge loading: only fetches outgoing edges
 * for nodes as they are visited, avoiding loading the full edge table when
 * the graph is large.  Returns all simple paths up to `maxDepth`.
 *
 * @param db - The MonographDb instance
 * @param sourceId - Starting node id
 * @param targetId - Destination node id
 * @param options - Optional tuning parameters
 * @returns Array of paths; each path is an ordered array of node ids from source to target.
 */
export function traceImportChain(db, sourceId, targetId, options = {}) {
    const { maxDepth = 10, maxPaths = 100 } = options;
    // Quick existence check — avoids loading any edge data for invalid IDs
    const exists = db.prepare('SELECT 1 FROM nodes WHERE id = ? LIMIT 1');
    if (!exists.get(sourceId) || !exists.get(targetId))
        return [];
    if (sourceId === targetId)
        return [[sourceId]];
    // Lazy adjacency cache: only loaded for nodes we actually visit
    const adjCache = new Map();
    const edgeStmt = db.prepare('SELECT target_id FROM edges WHERE source_id = ? AND source_id != target_id');
    function getNeighbors(nodeId) {
        let neighbors = adjCache.get(nodeId);
        if (neighbors === undefined) {
            neighbors = edgeStmt.all(nodeId).map(r => r.target_id);
            adjCache.set(nodeId, neighbors);
        }
        return neighbors;
    }
    // DFS with path tracking (iterative to avoid stack overflow on deep graphs)
    const results = [];
    const stack = [
        { node: sourceId, path: [sourceId], visited: new Set([sourceId]) },
    ];
    while (stack.length > 0 && results.length < maxPaths) {
        const { node, path, visited } = stack.pop();
        // depth = path.length - 1 (edges from source). Stop exploring when at the limit;
        // the target would require one more edge which would exceed maxDepth.
        if (path.length - 1 >= maxDepth)
            continue;
        for (const neighbor of getNeighbors(node)) {
            if (visited.has(neighbor))
                continue;
            if (neighbor === targetId) {
                results.push([...path, neighbor]);
                if (results.length >= maxPaths)
                    break;
            }
            else {
                stack.push({
                    node: neighbor,
                    path: [...path, neighbor],
                    visited: new Set([...visited, neighbor]),
                });
            }
        }
    }
    return results;
}
// ---------------------------------------------------------------------------
// Structured text formatter for LLM consumption
// ---------------------------------------------------------------------------
/**
 * Format import-chain paths as structured text.
 *
 * Resolves node IDs to human-readable names (name + file_path) for LLM
 * context injection.  Each path is printed as an arrow chain with file:line
 * hints where available.
 *
 * @param db - The MonographDb instance (used for name resolution)
 * @param paths - Result of traceImportChain()
 * @param sourceId - Source node id (for summary line)
 * @param targetId - Target node id (for summary line)
 * @returns Structured text string
 */
export function formatImportChain(db, paths, sourceId, targetId) {
    if (paths.length === 0) {
        return `Import chain: no path found from ${sourceId} to ${targetId}.`;
    }
    // Batch-resolve all node IDs in the result set
    const allIds = [...new Set(paths.flat())];
    const placeholders = allIds.map(() => '?').join(',');
    const nodeRows = db
        .prepare(`SELECT id, name, file_path, start_line FROM nodes WHERE id IN (${placeholders})`)
        .all(...allIds);
    const nodeInfo = new Map();
    for (const row of nodeRows) {
        const loc = row.file_path != null
            ? row.start_line != null
                ? `${row.file_path}:${row.start_line}`
                : row.file_path
            : row.id;
        nodeInfo.set(row.id, { name: row.name ?? row.id, loc });
    }
    const lines = [
        `Import chain: ${paths.length} path${paths.length === 1 ? '' : 's'} from ${nodeInfo.get(sourceId)?.name ?? sourceId} to ${nodeInfo.get(targetId)?.name ?? targetId}`,
        '',
    ];
    for (let i = 0; i < paths.length; i++) {
        lines.push(`Path ${i + 1} (${paths[i].length} node${paths[i].length === 1 ? '' : 's'}):`);
        for (const id of paths[i]) {
            const info = nodeInfo.get(id);
            lines.push(`  ${info?.name ?? id} — ${info?.loc ?? id}`);
        }
        if (i < paths.length - 1)
            lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=import-chain.js.map