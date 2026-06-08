export function insertEdge(db, edge) {
    db.prepare(`
    INSERT OR REPLACE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, reason, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(edge.id, edge.sourceId, edge.targetId, edge.relation, edge.confidence, edge.confidenceScore, edge.reason ?? null, edge.evidence != null ? JSON.stringify(edge.evidence) : null);
}
export function insertEdges(db, edges) {
    const insertMany = db.transaction((rows) => {
        for (const e of rows) {
            insertEdge(db, e);
        }
    });
    insertMany(edges);
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