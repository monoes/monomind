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
    // 2. Callers: nodes that CALL this node (inbound CALLS edges)
    const callerRows = db
        .prepare(`SELECT n.* FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'CALLS' LIMIT ?`)
        .all(nodeId, LIMIT);
    // 3. Callees: nodes this node CALLS (outbound CALLS edges)
    const calleeRows = db
        .prepare(`SELECT n.* FROM nodes n JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'CALLS' LIMIT ?`)
        .all(nodeId, LIMIT);
    // 4. Imports: what this node imports (outbound IMPORTS edges)
    const importRows = db
        .prepare(`SELECT n.* FROM nodes n JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'IMPORTS' LIMIT ?`)
        .all(nodeId, LIMIT);
    // 5. ImportedBy: what imports this node (inbound IMPORTS edges)
    const importedByRows = db
        .prepare(`SELECT n.* FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'IMPORTS' LIMIT ?`)
        .all(nodeId, LIMIT);
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
    return {
        node,
        callers: callerRows.map(rowToNode),
        callees: calleeRows.map(rowToNode),
        imports: importRows.map(rowToNode),
        importedBy: importedByRows.map(rowToNode),
        community,
        inProcesses: processRows,
    };
}
//# sourceMappingURL=context.js.map