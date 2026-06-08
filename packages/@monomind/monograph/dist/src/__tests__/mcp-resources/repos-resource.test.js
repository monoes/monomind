import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { reposResource } from '../../mcp-resources/repos-resource.js';
import { namedClusterResource } from '../../mcp-resources/named-cluster-resource.js';
import { namedProcessResource } from '../../mcp-resources/named-process-resource.js';
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER);
    CREATE TABLE communities (id INTEGER PRIMARY KEY, label TEXT);
    INSERT INTO communities VALUES (1, 'auth-cluster');
    INSERT INTO nodes VALUES ('n1', 'UserService', 'Class', '/app/user.ts', 1, 50, 1);
    INSERT INTO nodes VALUES ('n2', 'main', 'Function', '/app/main.ts', 1, 20, null);
  `);
    return db;
}
describe('reposResource', () => {
    it('has uri and handler defined', () => {
        expect(reposResource.uri).toBeDefined();
        expect(typeof reposResource.handler).toBe('function');
    });
    it('handler returns an array', () => {
        const db = makeDb();
        const result = reposResource.handler(db);
        expect(Array.isArray(result)).toBe(true);
    });
});
describe('namedClusterResource', () => {
    it('has uri and handler defined', () => {
        expect(namedClusterResource.uri).toBeDefined();
        expect(typeof namedClusterResource.handler).toBe('function');
    });
    it('handler returns cluster data for known label', () => {
        const db = makeDb();
        const result = namedClusterResource.handler(db, { name: 'auth-cluster' });
        expect(result).not.toBeNull();
        expect(result.label).toBe('auth-cluster');
        expect(Array.isArray(result.members)).toBe(true);
    });
    it('returns null for unknown cluster', () => {
        const db = makeDb();
        const result = namedClusterResource.handler(db, { name: 'nonexistent' });
        expect(result).toBeNull();
    });
});
describe('namedProcessResource', () => {
    it('has uri and handler defined', () => {
        expect(namedProcessResource.uri).toBeDefined();
        expect(typeof namedProcessResource.handler).toBe('function');
    });
    it('handler returns node for known name', () => {
        const db = makeDb();
        const result = namedProcessResource.handler(db, { name: 'UserService' });
        expect(result).not.toBeNull();
        expect(result.name).toBe('UserService');
    });
    it('returns null for unknown name', () => {
        const db = makeDb();
        const result = namedProcessResource.handler(db, { name: 'nonexistent' });
        expect(result).toBeNull();
    });
});
//# sourceMappingURL=repos-resource.test.js.map