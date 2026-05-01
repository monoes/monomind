import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { monographImpact } from '../../mcp-tools/impact.js';

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
  db.prepare(`INSERT INTO nodes VALUES ('n1','Function','doA',null,'/a.ts',1,5,null,1,null,null)`).run();
  db.prepare(`INSERT INTO nodes VALUES ('n2','Function','doB',null,'/b.ts',1,3,null,1,null,null)`).run();
  db.prepare(`INSERT INTO nodes VALUES ('n3','Function','doC',null,'/c.ts',1,3,null,1,null,null)`).run();
  db.prepare(`INSERT INTO edges VALUES ('e1','n2','n1','CALLS','EXTRACTED',0.9,null)`).run();
  db.prepare(`INSERT INTO edges VALUES ('e2','n3','n1','CALLS','AMBIGUOUS',0.2,null)`).run();
  return db;
}

describe('monographImpact filtering', () => {
  it('minConfidenceScore filters low-confidence callers', async () => {
    const db = makeDb();
    const result = await monographImpact(db, 'n1', { minConfidenceScore: 0.5 });
    const callerIds = result.directCallers.map(n => n.id);
    expect(callerIds).toContain('n2');
    expect(callerIds).not.toContain('n3');
  });

  it('without filter returns all callers', async () => {
    const db = makeDb();
    const result = await monographImpact(db, 'n1', {});
    const callerIds = result.directCallers.map(n => n.id);
    expect(callerIds).toContain('n2');
    expect(callerIds).toContain('n3');
  });

  it('relationTypes restricts edge traversal', async () => {
    const db = makeDb();
    db.prepare(`INSERT INTO edges VALUES ('e3','n3','n1','IMPORTS','EXTRACTED',0.9,null)`).run();
    const result = await monographImpact(db, 'n1', { relationTypes: ['IMPORTS'] });
    const callerIds = result.directCallers.map(n => n.id);
    expect(callerIds).toContain('n3');
    expect(callerIds).not.toContain('n2');
  });
});
