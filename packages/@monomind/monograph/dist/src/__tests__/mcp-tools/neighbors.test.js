import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { getMonographNeighbors } from '../../mcp-tools/neighbors.js';
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER, norm_label TEXT, is_exported INTEGER, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    INSERT INTO nodes VALUES ('n1', 'UserService', 'Class', '/app/user.ts', 1, 50, 1, 'userservice', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n2', 'getUser', 'Function', '/app/user.ts', 5, 15, 1, 'getuser', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n3', 'Database', 'Class', '/app/db.ts', 1, 100, 2, 'database', 1, 'typescript', null);
    INSERT INTO edges VALUES ('e1', 'n1', 'n2', 'HAS_METHOD', 'EXTRACTED', 1.0);
    INSERT INTO edges VALUES ('e2', 'n1', 'n3', 'CALLS', 'INFERRED', 0.7);
  `);
    return db;
}
describe('getMonographNeighbors', () => {
    it('returns outbound neighbors with edge details', () => {
        const db = makeDb();
        const result = getMonographNeighbors(db, { name: 'UserService' });
        expect(result.node).not.toBeNull();
        expect(result.neighbors.length).toBe(2);
        const rels = result.neighbors.map(n => n.relation);
        expect(rels).toContain('HAS_METHOD');
        expect(rels).toContain('CALLS');
    });
    it('can filter by relation type', () => {
        const db = makeDb();
        const result = getMonographNeighbors(db, { name: 'UserService', relationFilter: 'CALLS' });
        expect(result.neighbors.every(n => n.relation === 'CALLS')).toBe(true);
    });
    it('returns null node for unknown symbol', () => {
        const db = makeDb();
        const result = getMonographNeighbors(db, { name: 'NonExistent' });
        expect(result.node).toBeNull();
        expect(result.neighbors).toEqual([]);
    });
    it('includes inbound neighbors', () => {
        const db = makeDb();
        const result = getMonographNeighbors(db, { name: 'getUser', includeInbound: true });
        expect(result.neighbors.some(n => n.direction === 'inbound')).toBe(true);
    });
});
//# sourceMappingURL=neighbors.test.js.map