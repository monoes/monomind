import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { queryClusters, queryCluster, queryProcessesList, queryProcess } from '../../web/api.js';
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER);
    CREATE TABLE communities (id INTEGER PRIMARY KEY, label TEXT);
    INSERT INTO communities VALUES (1, 'auth');
    INSERT INTO communities VALUES (2, 'payment');
    INSERT INTO nodes VALUES ('n1', 'UserService', 'Class', '/app/user.ts', 1, 50, 1);
    INSERT INTO nodes VALUES ('n2', 'PaymentProcessor', 'Class', '/app/pay.ts', 1, 100, 2);
    INSERT INTO nodes VALUES ('n3', 'processOrder', 'Process', '/app/order.ts', 5, 30, null);
  `);
    return db;
}
describe('queryClusters', () => {
    it('returns list of all communities', () => {
        const db = makeDb();
        const result = queryClusters(db);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result.some(c => c.label === 'auth')).toBe(true);
    });
});
describe('queryCluster', () => {
    it('returns cluster with members for known name', () => {
        const db = makeDb();
        const result = queryCluster(db, 'auth');
        expect(result).not.toBeNull();
        expect(result.label).toBe('auth');
        expect(Array.isArray(result.members)).toBe(true);
    });
    it('returns null for unknown cluster', () => {
        const db = makeDb();
        expect(queryCluster(db, 'nonexistent')).toBeNull();
    });
});
describe('queryProcessesList', () => {
    it('returns process nodes', () => {
        const db = makeDb();
        const result = queryProcessesList(db);
        expect(Array.isArray(result)).toBe(true);
        expect(result.some(p => p.name === 'processOrder')).toBe(true);
    });
});
describe('queryProcess', () => {
    it('returns process for known name', () => {
        const db = makeDb();
        const result = queryProcess(db, 'processOrder');
        expect(result).not.toBeNull();
        expect(result.name).toBe('processOrder');
    });
    it('returns null for unknown process', () => {
        const db = makeDb();
        expect(queryProcess(db, 'nonexistent')).toBeNull();
    });
});
//# sourceMappingURL=api.clusters.test.js.map