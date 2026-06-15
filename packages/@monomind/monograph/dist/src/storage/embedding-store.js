/**
 * CRUD operations for the embeddings table.
 *
 * Vectors are stored as BLOBs (raw Float32Array bytes) and reconstructed on read.
 */
/**
 * Ensure the embeddings table has the content_hash column introduced in a later
 * schema version. Call this ONCE before a batch of upserts rather than inside
 * upsertEmbedding itself to avoid running ALTER TABLE on every row write.
 */
export function ensureEmbeddingSchema(db) {
    try {
        db.exec('ALTER TABLE embeddings ADD COLUMN content_hash TEXT');
    }
    catch {
        // Column already exists — ignore.
    }
}
export function upsertEmbedding(db, nodeId, vector, contentHash) {
    const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    db
        .prepare('INSERT OR REPLACE INTO embeddings (node_id, vector, content_hash) VALUES (?, ?, ?)')
        .run(nodeId, buf, contentHash ?? null);
}
/**
 * Bulk-upsert multiple embeddings in a single transaction.
 * Calls ensureEmbeddingSchema once before writing, then wraps all inserts in
 * a transaction for 10-100x faster throughput vs per-row upsertEmbedding calls.
 */
export function batchUpsertEmbeddings(db, entries) {
    if (entries.length === 0)
        return;
    ensureEmbeddingSchema(db);
    const stmt = db.prepare('INSERT OR REPLACE INTO embeddings (node_id, vector, content_hash) VALUES (?, ?, ?)');
    const insertMany = db.transaction((rows) => {
        for (const e of rows) {
            const buf = Buffer.from(e.vector.buffer, e.vector.byteOffset, e.vector.byteLength);
            stmt.run(e.nodeId, buf, e.contentHash ?? null);
        }
    });
    insertMany(entries);
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