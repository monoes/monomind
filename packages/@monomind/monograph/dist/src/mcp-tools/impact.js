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
export function computeRiskLevel(riskScore) {
    if (riskScore > 0.75)
        return 'CRITICAL';
    if (riskScore > 0.5)
        return 'HIGH';
    if (riskScore > 0.25)
        return 'MEDIUM';
    return 'LOW';
}
// ── Reverse BFS on CALLS edges ────────────────────────────────────────────────
function reverseBfs(startNodeId, db, maxDepth, options = {}) {
    const visited = new Map([[startNodeId, 0]]);
    const queue = [{ id: startNodeId, depth: 0 }];
    const relations = options.relationTypes ?? ['CALLS'];
    const placeholders = relations.map(() => '?').join(',');
    const baseQuery = `SELECT source_id FROM edges WHERE target_id = ? AND relation IN (${placeholders})`;
    const query = options.minConfidenceScore !== undefined
        ? `${baseQuery} AND confidence_score >= ?`
        : baseQuery;
    const stmt = db.prepare(query);
    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (depth >= maxDepth)
            continue;
        const params = [id, ...relations];
        if (options.minConfidenceScore !== undefined) {
            params.push(options.minConfidenceScore);
        }
        const callers = stmt.all(...params);
        for (const { source_id } of callers) {
            if (!visited.has(source_id)) {
                visited.set(source_id, depth + 1);
                queue.push({ id: source_id, depth: depth + 1 });
            }
        }
    }
    return visited;
}
// ── Implementation ─────────────────────────────────────────────────────────────
export function getMonographImpact(db, input) {
    const maxDepth = Math.min(input.depth ?? 3, 6);
    // Find the node
    let nodeRow;
    if (input.filePath) {
        nodeRow = db
            .prepare('SELECT * FROM nodes WHERE name = ? AND file_path = ? LIMIT 1')
            .get(input.name, input.filePath);
    }
    else {
        nodeRow = db
            .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
            .get(input.name);
    }
    if (!nodeRow) {
        return { node: null, directCallers: [], transitiveCallers: [], affectedFiles: [], riskScore: 0, riskLevel: 'LOW' };
    }
    const node = rowToNode(nodeRow);
    const nodeId = node.id;
    // Reverse BFS to find all callers (depth 0 = start node)
    const visited = reverseBfs(nodeId, db, maxDepth, {});
    // Separate direct callers (depth 1) from transitive (depth 2+)
    const directCallerIds = [];
    const byDepth = new Map();
    for (const [id, depth] of visited.entries()) {
        if (id === nodeId)
            continue;
        if (depth === 1) {
            directCallerIds.push(id);
        }
        else {
            const existing = byDepth.get(depth) ?? [];
            existing.push(id);
            byDepth.set(depth, existing);
        }
    }
    // Fetch node details for direct callers
    const getNodesByIds = (ids) => {
        if (ids.length === 0)
            return [];
        const placeholders = ids.map(() => '?').join(',');
        const rows = db
            .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
            .all(...ids);
        return rows.map(rowToNode);
    };
    const directCallers = getNodesByIds(directCallerIds);
    const transitiveCallers = [];
    const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b);
    for (const depth of sortedDepths) {
        const ids = byDepth.get(depth);
        transitiveCallers.push({ depth, nodes: getNodesByIds(ids) });
    }
    // Collect unique affected file paths (excluding start node)
    const allAffectedNodes = [...directCallers, ...transitiveCallers.flatMap(t => t.nodes)];
    const affectedFiles = [...new Set(allAffectedNodes
            .map(n => n.filePath)
            .filter((p) => p != null))];
    // Risk score: log2(totalCallerCount + 1) normalized to [0, 1] (max log2(11) ≈ 3.46, capped at 10, /10)
    const totalCallerCount = visited.size - 1; // exclude start node
    const rawScore = Math.min(Math.log2(totalCallerCount + 1), 10);
    const riskScore = rawScore / 10;
    return { node, directCallers, transitiveCallers, affectedFiles, riskScore, riskLevel: computeRiskLevel(riskScore) };
}
// ── id-based impact with filtering options ────────────────────────────────────
export async function monographImpact(db, nodeId, options = {}) {
    const maxDepth = Math.min(options.maxDepth ?? 3, 6);
    const nodeRow = db
        .prepare('SELECT * FROM nodes WHERE id = ? LIMIT 1')
        .get(nodeId);
    if (!nodeRow) {
        return { node: null, directCallers: [], transitiveCallers: [], affectedFiles: [], riskScore: 0, riskLevel: 'LOW' };
    }
    const node = rowToNode(nodeRow);
    const visited = reverseBfs(nodeId, db, maxDepth, options);
    const directCallerIds = [];
    const byDepth = new Map();
    for (const [id, depth] of visited.entries()) {
        if (id === nodeId)
            continue;
        if (depth === 1) {
            directCallerIds.push(id);
        }
        else {
            const existing = byDepth.get(depth) ?? [];
            existing.push(id);
            byDepth.set(depth, existing);
        }
    }
    const getNodesByIds = (ids) => {
        if (ids.length === 0)
            return [];
        const placeholders = ids.map(() => '?').join(',');
        const rows = db
            .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
            .all(...ids);
        return rows.map(rowToNode);
    };
    const directCallers = getNodesByIds(directCallerIds);
    const transitiveCallers = [];
    const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b);
    for (const depth of sortedDepths) {
        const ids = byDepth.get(depth);
        transitiveCallers.push({ depth, nodes: getNodesByIds(ids) });
    }
    const allAffectedNodes = [...directCallers, ...transitiveCallers.flatMap(t => t.nodes)];
    const affectedFiles = [...new Set(allAffectedNodes
            .map(n => n.filePath)
            .filter((p) => p != null))];
    const totalCallerCount = visited.size - 1;
    const rawScore = Math.min(Math.log2(totalCallerCount + 1), 10);
    const riskScore = rawScore / 10;
    return { node, directCallers, transitiveCallers, affectedFiles, riskScore, riskLevel: computeRiskLevel(riskScore) };
}
//# sourceMappingURL=impact.js.map