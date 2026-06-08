import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { monographQueryTool } from '../../mcp-tools/query.js';
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL,
      norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER,
      community_id INTEGER, is_exported INTEGER DEFAULT 0, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      relation TEXT NOT NULL, confidence TEXT DEFAULT 'EXTRACTED', confidence_score REAL DEFAULT 1.0,
      properties TEXT);
  `);
    db.prepare(`INSERT INTO nodes VALUES ('n1','Process','PaymentFlow',null,'/pay.ts',1,20,1,1,null,null)`).run();
    db.prepare(`INSERT INTO nodes VALUES ('n2','Function','processPayment',null,'/pay.ts',5,15,1,1,null,null)`).run();
    return db;
}
describe('monographQueryTool', () => {
    it('has correct name', () => {
        expect(monographQueryTool.name).toBe('monograph_query');
    });
    it('has query parameter in schema', () => {
        expect(monographQueryTool.inputSchema.properties).toHaveProperty('query');
    });
    it('has repoPath parameter in schema', () => {
        expect(monographQueryTool.inputSchema.properties).toHaveProperty('repoPath');
    });
    it('has includeProcesses parameter', () => {
        expect(monographQueryTool.inputSchema.properties).toHaveProperty('includeProcesses');
    });
    it('returns results array when neither repoPath nor db provided', async () => {
        const result = await monographQueryTool.handler({ query: 'payment' });
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
    });
});
//# sourceMappingURL=query.test.js.map