import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildDiagnosticsFromDb } from '../../../packages/@monomind/monograph/src/lsp/server.ts';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL,
      norm_label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER,
      community_id INTEGER, is_exported INTEGER DEFAULT 0, language TEXT, properties TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      relation TEXT NOT NULL, confidence TEXT DEFAULT 'EXTRACTED',
      confidence_score REAL DEFAULT 1.0, reason TEXT, evidence TEXT
    );
  `);
  return db;
}

describe('buildDiagnosticsFromDb', () => {
  it('returns empty map for empty DB', () => {
    const db = makeDb();
    const result = buildDiagnosticsFromDb(db as any, '/repo');
    expect(result.size).toBe(0);
    db.close();
  });

  it('produces warnings for unreachable files', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO nodes VALUES ('f1','File','utils.ts','file','src/utils.ts',1,100,null,0,null,?)`,
    ).run(JSON.stringify({ reachabilityRole: 'unreachable' }));

    const result = buildDiagnosticsFromDb(db as any, '/repo');
    const diags = [...result.values()].flat();
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe(2);
    expect(diags[0].code).toBe('unreachable-file');
    expect(diags[0].message).toContain('Unreachable');
    db.close();
  });

  it('produces diagnostics for structurally similar files', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO nodes VALUES ('n1','File','a.ts','file','src/a.ts',1,50,null,0,null,null)`,
    ).run();
    db.prepare(
      `INSERT INTO nodes VALUES ('n2','File','b.ts','file','src/b.ts',1,50,null,0,null,null)`,
    ).run();
    db.prepare(
      `INSERT INTO edges VALUES ('e1','n1','n2','STRUCTURALLY_SIMILAR','INFERRED',0.85,null,null)`,
    ).run();

    const result = buildDiagnosticsFromDb(db as any, '/repo');
    const diags = [...result.values()].flat();
    expect(diags.some((d) => d.code === 'structurally-similar')).toBe(true);
    expect(diags.some((d) => d.message.includes('85%'))).toBe(true);
    db.close();
  });

  it('generates file:// URIs correctly', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO nodes VALUES ('f1','File','x.ts','file','src/x.ts',1,10,null,0,null,?)`,
    ).run(JSON.stringify({ reachabilityRole: 'unreachable' }));

    const result = buildDiagnosticsFromDb(db as any, '/my/repo');
    const uris = [...result.keys()];
    expect(uris[0]).toMatch(/^file:/);
    expect(uris[0]).toContain('/my/repo');
    db.close();
  });
});
