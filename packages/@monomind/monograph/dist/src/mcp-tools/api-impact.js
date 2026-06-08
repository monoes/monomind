// ── Row → MonographNode mapper ─────────────────────────────────────────────────
function rowToNode(row) {
    return {
        id: row.id,
        label: row.label,
        name: row.name,
        normLabel: row.norm_label,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        communityId: row.community_id,
        isExported: row.is_exported === 1,
        language: row.language,
        properties: row.properties ? JSON.parse(row.properties) : undefined,
    };
}
// ── Forward BFS on CALLS edges ─────────────────────────────────────────────────
function forwardBfs(startId, db, maxDepth) {
    const visited = new Map([[startId, 0]]);
    const queue = [{ id: startId, depth: 0 }];
    const result = [];
    const stmt = db.prepare(`SELECT target_id FROM edges WHERE source_id = ? AND relation = 'CALLS'`);
    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (depth >= maxDepth)
            continue;
        const callees = stmt.all(id);
        for (const { target_id } of callees) {
            if (!visited.has(target_id)) {
                visited.set(target_id, depth + 1);
                result.push({ depth: depth + 1, nodeId: target_id });
                queue.push({ id: target_id, depth: depth + 1 });
            }
        }
    }
    return result;
}
// ── Implementation ─────────────────────────────────────────────────────────────
export function getMonographApiImpact(db, input) {
    const MAX_DEPTH = 5;
    // 1. Find the Route node matching routePath
    const likePattern = '%' + input.routePath + '%';
    let routeRows = db
        .prepare("SELECT * FROM nodes WHERE label = 'Route' AND name LIKE ?")
        .all(likePattern);
    // If method provided, narrow down by method prefix
    if (input.method && routeRows.length > 0) {
        const methodUpper = input.method.toUpperCase();
        const filtered = routeRows.filter((row) => {
            const name = row.name;
            return name.startsWith(methodUpper + ' ');
        });
        // Only apply filter if it returns results; otherwise keep all matches
        if (filtered.length > 0) {
            routeRows = filtered;
        }
    }
    if (routeRows.length === 0) {
        return {
            route: null,
            handler: null,
            callees: [],
            affectedProcesses: [],
            riskScore: 0,
        };
    }
    const routeRow = routeRows[0];
    const routeNodeId = routeRow.id;
    const routeName = routeRow.name;
    // Parse method and path from name (format: "METHOD /path")
    const spaceIdx = routeName.indexOf(' ');
    const method = spaceIdx >= 0 ? routeName.slice(0, spaceIdx) : 'ANY';
    const path = spaceIdx >= 0 ? routeName.slice(spaceIdx + 1) : routeName;
    const route = { method, path, nodeId: routeNodeId };
    // 2. Find handler via HANDLES_ROUTE edge
    const handlerRow = db
        .prepare(`SELECT n.* FROM nodes n
       JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'HANDLES_ROUTE'
       LIMIT 1`)
        .get(routeNodeId);
    const handler = handlerRow ? rowToNode(handlerRow) : null;
    if (!handler) {
        return {
            route,
            handler: null,
            callees: [],
            affectedProcesses: [],
            riskScore: Math.log2(2),
        };
    }
    // 3. Forward BFS on CALLS edges from handler
    const bfsResults = forwardBfs(handler.id, db, MAX_DEPTH);
    // 4. Resolve node details for each callee
    const callees = [];
    for (const { depth, nodeId } of bfsResults) {
        const nodeRow = db
            .prepare('SELECT * FROM nodes WHERE id = ?')
            .get(nodeId);
        if (nodeRow) {
            callees.push({ depth, node: rowToNode(nodeRow) });
        }
    }
    // 5. Find processes that include the handler or any callee via STEP_IN_PROCESS
    const allNodeIds = [handler.id, ...bfsResults.map((b) => b.nodeId)];
    const affectedProcesses = [];
    if (allNodeIds.length > 0) {
        const placeholders = allNodeIds.map(() => '?').join(',');
        const processRows = db
            .prepare(`SELECT DISTINCT n.id, n.name FROM nodes n
         JOIN edges e ON n.id = e.source_id
         WHERE e.target_id IN (${placeholders}) AND e.relation = 'STEP_IN_PROCESS'`)
            .all(...allNodeIds);
        affectedProcesses.push(...processRows);
    }
    // 6. Risk score: log2(callees.length + 2) capped at 10
    const riskScore = Math.min(Math.log2(callees.length + 2), 10);
    return {
        route,
        handler,
        callees,
        affectedProcesses,
        riskScore,
    };
}
//# sourceMappingURL=api-impact.js.map