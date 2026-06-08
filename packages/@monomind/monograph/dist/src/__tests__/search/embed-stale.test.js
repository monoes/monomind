import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { upsertEmbedding, getEmbeddingContentHash, isEmbeddingStale } from '../../storage/embedding-store.js';
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      node_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      content_hash TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
    return db;
}
describe('embedding stale detection', () => {
    it('stores content hash with embedding', () => {
        const db = makeDb();
        upsertEmbedding(db, 'n1', new Float32Array([0.1, 0.2]), 'hash_abc');
        const stored = getEmbeddingContentHash(db, 'n1');
        expect(stored).toBe('hash_abc');
    });
    it('isEmbeddingStale returns true when hash differs', () => {
        const db = makeDb();
        upsertEmbedding(db, 'n1', new Float32Array([0.1, 0.2]), 'old_hash');
        expect(isEmbeddingStale(db, 'n1', 'new_hash')).toBe(true);
    });
    it('isEmbeddingStale returns false when hash matches', () => {
        const db = makeDb();
        upsertEmbedding(db, 'n1', new Float32Array([0.1, 0.2]), 'same_hash');
        expect(isEmbeddingStale(db, 'n1', 'same_hash')).toBe(false);
    });
    it('isEmbeddingStale returns true when no embedding exists', () => {
        const db = makeDb();
        expect(isEmbeddingStale(db, 'n1', 'any_hash')).toBe(true);
    });
});
//# sourceMappingURL=embed-stale.test.js.map