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
// ── Prepared statement cache ───────────────────────────────────────────────────
// Keyed by a fingerprint of which conditions are active (not by param values),
// so the same query shape reuses the compiled statement across calls.
// WeakMap ensures the cache is garbage-collected when the DB object is released.
const stmtCache = new WeakMap();
function getCachedStmt(db, key, buildSql) {
    let dbCache = stmtCache.get(db);
    if (!dbCache) {
        dbCache = new Map();
        stmtCache.set(db, dbCache);
    }
    let stmt = dbCache.get(key);
    if (!stmt) {
        stmt = db.prepare(buildSql());
        dbCache.set(key, stmt);
    }
    return stmt;
}
// ── DB-backed search ───────────────────────────────────────────────────────────
/**
 * Search nodes by structured property criteria.
 * All supplied criteria are combined with AND.
 *
 * Prepared statements are cached per-DB keyed by the active condition set so
 * repeated calls with the same filter shape reuse the compiled statement.
 */
export function searchNodesByProperty(db, options = {}) {
    const conditions = [];
    const params = [];
    // fingerprint encodes which conditions are active (not their values)
    const fingerprint = [];
    if (options.label) {
        conditions.push('label = ?');
        params.push(options.label);
        fingerprint.push('lbl');
    }
    if (options.language) {
        conditions.push('LOWER(language) = LOWER(?)');
        params.push(options.language);
        fingerprint.push('lang');
    }
    if (options.fileExtension !== undefined) {
        // Normalise: ensure leading dot
        const ext = options.fileExtension.startsWith('.')
            ? options.fileExtension
            : `.${options.fileExtension}`;
        conditions.push("file_path LIKE ?");
        params.push(`%${ext}`);
        fingerprint.push('ext');
    }
    if (options.filePath !== undefined) {
        conditions.push("LOWER(file_path) LIKE LOWER(?)");
        params.push(`%${options.filePath}%`);
        fingerprint.push('fp');
    }
    if (options.isExported !== undefined) {
        conditions.push('is_exported = ?');
        params.push(options.isExported ? 1 : 0);
        fingerprint.push('exp');
    }
    if (options.communityId !== undefined) {
        conditions.push('community_id = ?');
        params.push(options.communityId);
        fingerprint.push('com');
    }
    const hasLimit = options.limit !== undefined;
    if (hasLimit)
        fingerprint.push('lim');
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = hasLimit ? `LIMIT ${Number(options.limit)}` : '';
    const cacheKey = fingerprint.join(':') || 'all';
    const stmt = getCachedStmt(db, cacheKey, () => `SELECT id, label, name, norm_label, file_path, start_line, end_line,
                      community_id, is_exported, language, properties
               FROM nodes ${where} ${limitClause}`);
    const rows = stmt.all(...params);
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