// ── Row → node mapper (mirrors subgraph.ts) ───────────────────────────────────
function rowToNode(r) {
    return {
        id: r.id,
        label: r.label,
        name: r.name,
        normLabel: r.norm_label ?? r.name.toLowerCase(),
        filePath: r.file_path ?? undefined,
        startLine: r.start_line ?? undefined,
        endLine: r.end_line ?? undefined,
        communityId: r.community_id ?? undefined,
        isExported: r.is_exported === 1,
        language: r.language ?? undefined,
        properties: r.properties ? JSON.parse(r.properties) : undefined,
    };
}
// ── DB-backed search ───────────────────────────────────────────────────────────
/**
 * Search nodes by structured property criteria.
 * All supplied criteria are combined with AND.
 */
export function searchNodesByProperty(db, options = {}) {
    const conditions = [];
    const params = [];
    if (options.label) {
        conditions.push('label = ?');
        params.push(options.label);
    }
    if (options.language) {
        conditions.push('LOWER(language) = LOWER(?)');
        params.push(options.language);
    }
    if (options.fileExtension !== undefined) {
        // Normalise: ensure leading dot
        const ext = options.fileExtension.startsWith('.')
            ? options.fileExtension
            : `.${options.fileExtension}`;
        conditions.push("file_path LIKE ?");
        params.push(`%${ext}`);
    }
    if (options.filePath !== undefined) {
        conditions.push("LOWER(file_path) LIKE LOWER(?)");
        params.push(`%${options.filePath}%`);
    }
    if (options.isExported !== undefined) {
        conditions.push('is_exported = ?');
        params.push(options.isExported ? 1 : 0);
    }
    if (options.communityId !== undefined) {
        conditions.push('community_id = ?');
        params.push(options.communityId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = options.limit !== undefined ? `LIMIT ${Number(options.limit)}` : '';
    const sql = `SELECT id, label, name, norm_label, file_path, start_line, end_line,
                      community_id, is_exported, language, properties
               FROM nodes ${where} ${limitClause}`;
    const rows = db.prepare(sql).all(...params);
    return rows.map(rowToNode);
}
// ── In-memory search ───────────────────────────────────────────────────────────
/**
 * Filter an already-loaded array of nodes in memory.
 */
export function searchNodesInMemory(nodes, options = {}) {
    let result = nodes;
    if (options.label) {
        result = result.filter(n => n.label === options.label);
    }
    if (options.language) {
        const lang = options.language.toLowerCase();
        result = result.filter(n => n.language?.toLowerCase() === lang);
    }
    if (options.fileExtension !== undefined) {
        const ext = options.fileExtension.startsWith('.')
            ? options.fileExtension.toLowerCase()
            : `.${options.fileExtension.toLowerCase()}`;
        result = result.filter(n => n.filePath?.toLowerCase().endsWith(ext));
    }
    if (options.filePath !== undefined) {
        const fp = options.filePath.toLowerCase();
        result = result.filter(n => n.filePath?.toLowerCase().includes(fp));
    }
    if (options.isExported !== undefined) {
        result = result.filter(n => n.isExported === options.isExported);
    }
    if (options.communityId !== undefined) {
        result = result.filter(n => n.communityId === options.communityId);
    }
    if (options.limit !== undefined) {
        result = result.slice(0, options.limit);
    }
    return result;
}
//# sourceMappingURL=node-search.js.map