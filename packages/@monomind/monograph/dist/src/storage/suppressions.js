import { randomUUID } from 'crypto';
// Add a suppression
export function addSuppression(db, filePath, line, rule) {
    const id = randomUUID();
    const addedAt = new Date().toISOString();
    db.prepare(`
    INSERT INTO suppressions (id, file_path, line, rule, added_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(id, filePath, line, rule, addedAt);
    return { id, filePath, line, rule, addedAt };
}
// List all suppressions (optionally filter by rule or file)
export function listSuppressions(db, filePath, rule) {
    let sql = `SELECT id, file_path, line, rule, added_at, last_seen_at FROM suppressions WHERE 1=1`;
    const params = [];
    if (filePath) {
        sql += ` AND file_path = ?`;
        params.push(filePath);
    }
    if (rule) {
        sql += ` AND rule = ?`;
        params.push(rule);
    }
    sql += ` ORDER BY added_at DESC`;
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({
        id: r.id,
        filePath: r.file_path,
        line: r.line,
        rule: r.rule,
        addedAt: r.added_at,
        ...(r.last_seen_at != null ? { lastSeenAt: r.last_seen_at } : {}),
    }));
}
// Remove a suppression
export function removeSuppression(db, id) {
    db.prepare(`DELETE FROM suppressions WHERE id = ?`).run(id);
}
// Check if a finding is suppressed
// A suppression with line=0 is file-wide and matches any line for the same file+rule
export function isSuppressed(db, filePath, line, rule) {
    const row = db.prepare(`
    SELECT id, file_path, line, rule, added_at, last_seen_at
    FROM suppressions
    WHERE file_path = ? AND rule = ? AND (line = 0 OR line = ?)
    LIMIT 1
  `).get(filePath, rule, line);
    if (!row)
        return null;
    return {
        id: row.id,
        filePath: row.file_path,
        line: row.line,
        rule: row.rule,
        addedAt: row.added_at,
        ...(row.last_seen_at != null ? { lastSeenAt: row.last_seen_at } : {}),
    };
}
// Find stale suppressions
// A suppression is stale if:
//   - the file no longer exists in the graph (reason: 'file_deleted')
//   - the file exists but no active finding matches file+rule (reason: 'issue_resolved')
export function findStaleSuppressions(db, activeFindings) {
    const suppressions = listSuppressions(db);
    if (suppressions.length === 0)
        return [];
    // Build a set of all file paths in the graph
    const graphFiles = new Set(db.prepare(`SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL`).all()
        .map(r => r.file_path));
    // Build a set of active finding keys: "filePath::rule"
    const activeFindingKeys = new Set(activeFindings.map(f => `${f.filePath}::${f.rule}`));
    const stale = [];
    for (const s of suppressions) {
        if (!graphFiles.has(s.filePath)) {
            stale.push({ ...s, reason: 'file_deleted' });
        }
        else if (!activeFindingKeys.has(`${s.filePath}::${s.rule}`)) {
            stale.push({ ...s, reason: 'issue_resolved' });
        }
    }
    return stale;
}
//# sourceMappingURL=suppressions.js.map