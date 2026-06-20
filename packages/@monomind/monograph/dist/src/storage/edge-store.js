export function insertEdge(db, edge) {
    db.prepare(`
    INSERT OR REPLACE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(edge.id, edge.sourceId, edge.targetId, edge.relation, edge.confidence, edge.confidenceScore, edge.reason ?? null, edge.evidence != null ? JSON.stringify(edge.evidence) : null);
}
const INSERT_EDGE_SQL = `
    INSERT OR REPLACE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
export function insertEdges(db, edges) {
    if (edges.length === 0)
        return;
    // Prepare once and reuse across all rows — avoids N redundant prepare calls
    const stmt = db.prepare(INSERT_EDGE_SQL);
    const insertMany = db.transaction((rows) => {
        for (const e of rows) {
            stmt.run(e.id, e.sourceId, e.targetId, e.relation, e.confidence, e.confidenceScore, e.reason ?? null, e.evidence != null ? JSON.stringify(e.evidence) : null);
        }
    });
    insertMany(edges);
}
/** Batch-fetch edges for multiple source IDs using a single SQL IN query. Batches at 50 IDs. */
export function getEdgesForSources(db, sourceIds) {
    if (sourceIds.length === 0)
        return [];
    const BATCH = 50;
    const results = [];
    for (let i = 0; i < sourceIds.length; i += BATCH) {
        const chunk = sourceIds.slice(i, i + BATCH);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = db
            .prepare(`SELECT * FROM edges WHERE source_id IN (${placeholders})`)
            .all(...chunk);
        for (const row of rows)
            results.push(rowToEdge(row));
    }
    return results;
}
export function getEdgesForSource(db, sourceId) {
    const rows = db
        .prepare('SELECT * FROM edges WHERE source_id = ?')
        .all(sourceId);
    return rows.map(rowToEdge);
}
export function getEdgesForTarget(db, targetId) {
    const rows = db
        .prepare('SELECT * FROM edges WHERE target_id = ?')
        .all(targetId);
    return rows.map(rowToEdge);
}
export function deleteEdgesForFile(db, filePath) {
    db.prepare(`
    DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE file_path = ?)
  `).run(filePath);
}
export function countEdges(db) {
    const row = db.prepare('SELECT COUNT(*) as n FROM edges').get();
    return row.n;
}
function rowToEdge(row) {
    return {
        id: row.id,
        sourceId: row.source_id,
        targetId: row.target_id,
        relation: row.relation,
        confidence: row.confidence,
        confidenceScore: row.confidence_score,
        reason: row.reason,
        evidence: row.evidence ? JSON.parse(row.evidence) : undefined,
    };
}
//# sourceMappingURL=edge-store.js.map