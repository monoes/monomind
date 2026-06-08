/**
 * CRUD operations for the embeddings table.
 *
 * Vectors are stored as BLOBs (raw Float32Array bytes) and reconstructed on read.
 */
export function upsertEmbedding(db, nodeId, vector, contentHash) {
    // Migrate existing DBs that may not have the content_hash column yet.
    try {
        db.exec('ALTER TABLE embeddings ADD COLUMN content_hash TEXT');
    }
    catch {
        // Column already exists — ignore.
    }
    const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    db
        .prepare('INSERT OR REPLACE INTO embeddings (node_id, vector, content_hash) VALUES (?, ?, ?)')
        .run(nodeId, buf, contentHash ?? null);
}
export function getEmbeddingContentHash(db, nodeId) {
    const row = db
        .prepare('SELECT content_hash FROM embeddings WHERE node_id = ?')
        .get(nodeId);
    return row?.content_hash ?? null;
}
export function isEmbeddingStale(db, nodeId, currentHash) {
    const stored = getEmbeddingContentHash(db, nodeId);
    return stored !== currentHash;
}
export function getEmbedding(db, nodeId) {
    const row = db.prepare('SELECT vector FROM embeddings WHERE node_id = ?').get(nodeId);
    if (!row)
        return null;
    return bufToFloat32(row.vector);
}
export function getAllEmbeddings(db) {
    const rows = db.prepare('SELECT node_id, vector FROM embeddings').all();
    const result = new Map();
    for (const row of rows) {
        result.set(row.node_id, bufToFloat32(row.vector));
    }
    return result;
}
export function countEmbeddings(db) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM embeddings').get();
    return row.n;
}
// ── Internal helpers ──────────────────────────────────────────────────────────
function bufToFloat32(buf) {
    // Copy to a fresh ArrayBuffer so slice offset doesn't cause issues
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Float32Array(ab);
}
//# sourceMappingURL=embedding-store.js.map