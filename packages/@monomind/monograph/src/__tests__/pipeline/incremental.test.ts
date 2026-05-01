import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runIncrementalAst } from '../../pipeline/runner.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL,
      norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER,
      community_id INTEGER, is_exported INTEGER DEFAULT 0, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      relation TEXT NOT NULL, confidence TEXT DEFAULT 'EXTRACTED', confidence_score REAL DEFAULT 1.0,
      properties TEXT);
  `);
  db.prepare(`INSERT INTO nodes VALUES ('existing','Function','old',null,'/x.ts',1,3,null,1,null,null)`).run();
  db.prepare(`INSERT INTO edges VALUES ('inf1','existing','existing','CALLS','INFERRED',0.5,null)`).run();
  return db;
}

describe('runIncrementalAst', () => {
  it('is exported from runner', () => {
    expect(typeof runIncrementalAst).toBe('function');
  });

  it('preserves INFERRED edges when running code-only update', async () => {
    const db = makeDb();
    const beforeEdges = db.prepare(`SELECT id FROM edges WHERE confidence = 'INFERRED'`).all();
    expect(beforeEdges).toHaveLength(1);
    await runIncrementalAst(db as any, [], { preserveInferred: true });
    const afterEdges = db.prepare(`SELECT id FROM edges WHERE confidence = 'INFERRED'`).all();
    expect(afterEdges).toHaveLength(1);
  });

  it('removes EXTRACTED edges when running code-only update', async () => {
    const db = makeDb();
    db.prepare(`INSERT INTO edges VALUES ('ext1','existing','existing','CALLS','EXTRACTED',0.9,null)`).run();
    await runIncrementalAst(db as any, [], { preserveInferred: true });
    const afterExtracted = db.prepare(`SELECT id FROM edges WHERE confidence = 'EXTRACTED'`).all();
    expect(afterExtracted).toHaveLength(0);
  });
});
