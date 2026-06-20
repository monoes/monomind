const SQLITE_VAR_LIMIT = 200; // safe batch size for IN clauses
export function computeDependencyClosure(db, maxNodes = 100) {
    // Get File nodes sorted by degree (most connected first)
    const fileNodes = db.prepare(`
    SELECT n.id, n.name, n.file_path,
      (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) AS degree
    FROM nodes n
    WHERE n.label = 'File'
    ORDER BY degree DESC
    LIMIT ?
  `).all(maxNodes);
    // Build a set of all file_paths that have any IMPORTS edge pointing to them (are imported by someone)
    const importedFilePaths = new Set(db.prepare(`
      SELECT DISTINCT n.file_path
      FROM edges e
      JOIN nodes n ON n.id = e.target_id
      WHERE e.relation = 'IMPORTS' AND n.file_path IS NOT NULL
    `).all().map(r => r.file_path));
    // Hoist prepared statement outside the per-node BFS loop to avoid recompiling
    // on every iteration (N×maxNodes calls previously).
    const edgeStmt = db.prepare(`SELECT target_id FROM edges WHERE source_id = ? AND relation = 'IMPORTS'`);
    const results = [];
    for (const fileNode of fileNodes) {
        // BFS forward (following IMPORTS edges from this node)
        const directDeps = [];
        const transitiveDeps = [];
        const visited = new Set([fileNode.id]);
        let frontier = [fileNode.id];
        let depth = 0;
        let maxDepth = 0;
        while (frontier.length > 0) {
            depth++;
            const next = [];
            for (const id of frontier) {
                const edges = edgeStmt.all(id);
                for (const e of edges) {
                    if (!visited.has(e.target_id)) {
                        visited.add(e.target_id);
                        next.push(e.target_id);
                        if (depth === 1) {
                            directDeps.push(e.target_id);
                        }
                        else {
                            transitiveDeps.push(e.target_id);
                        }
                        maxDepth = depth;
                    }
                }
            }
            frontier = next;
        }
        // Batch-resolve file_paths for all transitive deps in one chunked SQL query
        // instead of one SELECT per dep (N+1 → O(deps/CHUNK) queries).
        const depFilePathMap = new Map();
        for (let i = 0; i < transitiveDeps.length; i += SQLITE_VAR_LIMIT) {
            const chunk = transitiveDeps.slice(i, i + SQLITE_VAR_LIMIT);
            const ph = chunk.map(() => '?').join(',');
            const rows = db
                .prepare(`SELECT id, file_path FROM nodes WHERE id IN (${ph})`)
                .all(...chunk);
            for (const row of rows)
                depFilePathMap.set(row.id, row.file_path);
        }
        // unusedTransitiveDeps: transitive deps whose file_path is NOT in importedFilePaths
        const unusedTransitiveDeps = transitiveDeps.filter(depId => {
            const fp = depFilePathMap.get(depId);
            if (!fp)
                return false;
            return !importedFilePaths.has(fp);
        });
        results.push({
            nodeId: fileNode.id,
            name: fileNode.name,
            filePath: fileNode.file_path,
            directDeps,
            transitiveDeps,
            depDepth: maxDepth,
            unusedTransitiveDeps,
        });
    }
    // Sort by depDepth descending
    results.sort((a, b) => b.depDepth - a.depDepth);
    const avgDepDepth = results.length > 0
        ? results.reduce((sum, r) => sum + r.depDepth, 0) / results.length
        : 0;
    const maxDepDepth = results.length > 0 ? results[0].depDepth : 0;
    const deepDependencyFiles = results.filter(r => r.depDepth > 5);
    return {
        nodes: results,
        avgDepDepth: Math.round(avgDepDepth * 100) / 100,
        maxDepDepth,
        deepDependencyFiles,
    };
}
//# sourceMappingURL=dependency-closure.js.map