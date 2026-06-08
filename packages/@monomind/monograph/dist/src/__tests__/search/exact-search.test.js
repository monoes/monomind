import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { exactVectorSearch } from '../../search/exact-search.js';
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL,
      norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER,
      community_id INTEGER, is_exported INTEGER DEFAULT 0, language TEXT, properties TEXT);
    CREATE TABLE embeddings (node_id TEXT PRIMARY KEY, vector BLOB NOT NULL, content_hash TEXT, created_at INTEGER);
  `);
    db.prepare(`INSERT INTO nodes VALUES ('n1','Function','doAuth',null,'/auth.ts',1,5,null,1,null,null)`).run();
    db.prepare(`INSERT INTO nodes VALUES ('n2','Function','renderUI',null,'/ui.ts',1,3,null,1,null,null)`).run();
    // Store simple 3-dim embeddings: n1 ~ [1, 0, 0], n2 ~ [0, 1, 0]
    const v1 = new Float32Array([1, 0, 0]);
    const v2 = new Float32Array([0, 1, 0]);
    db.prepare(`INSERT INTO embeddings VALUES ('n1', ?, null, 0)`).run(Buffer.from(v1.buffer));
    db.prepare(`INSERT INTO embeddings VALUES ('n2', ?, null, 0)`).run(Buffer.from(v2.buffer));
    return db;
}
describe('exactVectorSearch', () => {
    it('returns closest node to query vector', () => {
        const db = makeDb();
        const query = new Float32Array([0.9, 0.1, 0]);
        const results = exactVectorSearch(db, query, { limit: 2 });
        expect(results[0]?.id).toBe('n1');
    });
    it('respects limit', () => {
        const db = makeDb();
        const query = new Float32Array([1, 0, 0]);
        const results = exactVectorSearch(db, query, { limit: 1 });
        expect(results).toHaveLength(1);
    });
    it('returns score between 0 and 1', () => {
        const db = makeDb();
        const query = new Float32Array([1, 0, 0]);
        const results = exactVectorSearch(db, query, { limit: 2 });
        expect(results[0].score).toBeGreaterThan(0);
        expect(results[0].score).toBeLessThanOrEqual(1);
    });
    it('returns empty array when no embeddings', () => {
        const db = new Database(':memory:');
        db.exec(`CREATE TABLE embeddings (node_id TEXT PRIMARY KEY, vector BLOB NOT NULL, content_hash TEXT, created_at INTEGER);
             CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL, norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER, is_exported INTEGER DEFAULT 0, language TEXT, properties TEXT);`);
        const results = exactVectorSearch(db, new Float32Array([1, 0, 0]), { limit: 5 });
        expect(results).toHaveLength(0);
    });
});
//# sourceMappingURL=exact-search.test.js.map