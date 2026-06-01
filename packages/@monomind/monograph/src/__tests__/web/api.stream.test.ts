import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { streamGraph } from '../../web/api.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    INSERT INTO nodes VALUES ('n1', 'A', 'Class', '/a.ts', 1, 10, null);
    INSERT INTO nodes VALUES ('n2', 'B', 'Function', '/b.ts', 1, 5, null);
    INSERT INTO edges VALUES ('e1', 'n1', 'n2', 'CALLS', 'EXTRACTED', 1.0);
  `);
  return db;
}

describe('streamGraph', () => {
  it('calls onRecord for each node and edge', async () => {
    const db = makeDb();
    const records: unknown[] = [];
    await streamGraph(db, (record) => { records.push(record); });
    expect(records.length).toBeGreaterThanOrEqual(3); // 2 nodes + 1 edge
    expect(records.some((r: any) => r.type === 'node')).toBe(true);
    expect(records.some((r: any) => r.type === 'edge')).toBe(true);
  });

  it('each record has a type field', async () => {
    const db = makeDb();
    const records: unknown[] = [];
    await streamGraph(db, (record) => { records.push(record); });
    for (const r of records) {
      expect(['node', 'edge']).toContain((r as any).type);
    }
  });
});
