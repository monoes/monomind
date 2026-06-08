function rowToNode(row) {
    return {
        id: row['id'],
        label: row['label'],
        name: row['name'],
        normLabel: row['norm_label'] ?? '',
        filePath: row['file_path'],
        startLine: row['start_line'],
        endLine: row['end_line'],
        communityId: row['community_id'],
        isExported: row['is_exported'] === 1,
        language: row['language'],
        properties: row['properties'] ? JSON.parse(row['properties']) : undefined,
    };
}
export function explainNode(db, name) {
    const nodeRow = db.prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(name);
    if (!nodeRow)
        return { node: null, explanation: null, connectionCount: 0 };
    const node = rowToNode(nodeRow);
    // Get outbound connections
    const outRows = db.prepare(`SELECT n.name, e.relation FROM nodes n JOIN edges e ON n.id = e.target_id WHERE e.source_id = ? LIMIT 10`).all(node.id);
    // Get inbound connections
    const inRows = db.prepare(`SELECT n.name, e.relation FROM nodes n JOIN edges e ON n.id = e.source_id WHERE e.target_id = ? LIMIT 10`).all(node.id);
    const connectionCount = outRows.length + inRows.length;
    const fileLine = node.filePath ? ` defined in \`${node.filePath}\`` : '';
    let explanation = `**${node.name}** is a ${node.label}${fileLine}.`;
    if (outRows.length > 0) {
        const outList = outRows.map(r => `\`${r.name}\` (${r.relation})`).join(', ');
        explanation += ` It connects to: ${outList}.`;
    }
    if (inRows.length > 0) {
        const inList = inRows.map(r => `\`${r.name}\``).slice(0, 5).join(', ');
        explanation += ` Referenced by: ${inList}.`;
    }
    if (node.communityId != null) {
        explanation += ` Part of community ${node.communityId}.`;
    }
    return { node, explanation, connectionCount };
}
//# sourceMappingURL=explain.js.map