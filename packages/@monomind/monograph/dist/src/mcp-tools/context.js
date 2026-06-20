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
// ── Shared helper: query related nodes by edge relation and direction ──────────
function queryRelated(db, nodeId, relation, inbound, limit = 50) {
    // inbound=true  → this node is the target; source nodes are the result
    // inbound=false → this node is the source; target nodes are the result
    const [filterCol, joinCol] = inbound
        ? ['target_id', 'source_id']
        : ['source_id', 'target_id'];
    const rows = db
        .prepare(`SELECT n.* FROM nodes n JOIN edges e ON n.id = e.${joinCol}
       WHERE e.${filterCol} = ? AND e.relation = ? LIMIT ?`)
        .all(nodeId, relation, limit);
    return rows.map(rowToNode);
}
// ── Implementation ─────────────────────────────────────────────────────────────
export function getMonographContext(db, input) {
    const LIMIT = 50;
    // 1. Find the node
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
        return { node: null, callers: [], callees: [], imports: [], importedBy: [], community: null, inProcesses: [] };
    }
    const node = rowToNode(nodeRow);
    const nodeId = node.id;
    // 2–5. Callers / callees / imports / importedBy via shared helper
    const callers = queryRelated(db, nodeId, 'CALLS', true, LIMIT);
    const callees = queryRelated(db, nodeId, 'CALLS', false, LIMIT);
    const imports = queryRelated(db, nodeId, 'IMPORTS', false, LIMIT);
    const importedBy = queryRelated(db, nodeId, 'IMPORTS', true, LIMIT);
    // 6. Community: from node's community_id field
    let community = null;
    if (node.communityId != null) {
        const commRow = db
            .prepare('SELECT id, label FROM communities WHERE id = ?')
            .get(node.communityId);
        community = commRow ?? { id: node.communityId };
    }
    // 7. inProcesses: processes that contain this node as a step
    // STEP_IN_PROCESS edge goes: process → step_symbol
    const processRows = db
        .prepare(`SELECT n.id, n.name FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'STEP_IN_PROCESS' LIMIT ?`)
        .all(nodeId, LIMIT);
    return { node, callers, callees, imports, importedBy, community, inProcesses: processRows };
}
//# sourceMappingURL=context.js.map