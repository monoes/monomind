import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runClusterOnly } from '../../pipeline/cluster-only.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER, norm_label TEXT, is_exported INTEGER, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    INSERT INTO nodes VALUES ('n1', 'A', 'Class', '/a.ts', 1, 10, null, 'a', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n2', 'B', 'Class', '/b.ts', 1, 10, null, 'b', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n3', 'C', 'Function', '/c.ts', 1, 5, null, 'c', 1, 'typescript', null);
    INSERT INTO edges VALUES ('e1', 'n1', 'n2', 'CALLS', 'EXTRACTED', 1.0);
    INSERT INTO edges VALUES ('e2', 'n2', 'n3', 'CALLS', 'EXTRACTED', 1.0);
  `);
  return db;
}

describe('runClusterOnly', () => {
  it('assigns community_id to nodes based on graph structure', async () => {
    const db = makeDb();
    await runClusterOnly(db);
    const updated = db.prepare('SELECT community_id FROM nodes').all() as { community_id: number | null }[];
    // At least some nodes should have community_id set
    expect(updated.some(n => n.community_id !== null)).toBe(true);
  });

  it('returns community count', async () => {
    const db = makeDb();
    const result = await runClusterOnly(db);
    expect(result.communityCount).toBeGreaterThanOrEqual(1);
  });
});
