import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateGraphReport } from '../../reporting/graph-report.js';

// generateGraphReport(db, outputPath) writes a real GRAPH_REPORT.md to
// outputPath on disk (writeFileSync in generateGraphReportFromDb) — this
// used to pass the literal string '/tmp', which fails outright in any
// sandboxed/CI environment where /tmp is read-only (unlike every other test
// in this codebase, which uses os.tmpdir() + mkdtempSync for exactly this
// reason — see e.g. hooks-install.test.ts).
let outputDir: string;

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), 'graph-report-confidence-test-'));
});

afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

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
  db.prepare(
    `INSERT INTO nodes VALUES ('n1','Function','foo',null,'/a.ts',1,5,null,1,null,null)`,
  ).run();
  db.prepare(
    `INSERT INTO nodes VALUES ('n2','Function','bar',null,'/b.ts',1,3,null,0,null,null)`,
  ).run();
  db.prepare(`INSERT INTO edges VALUES ('e1','n1','n2','CALLS','EXTRACTED',0.9,null)`).run();
  db.prepare(`INSERT INTO edges VALUES ('e2','n2','n1','CALLS','INFERRED',0.5,null)`).run();
  db.prepare(`INSERT INTO edges VALUES ('e3','n1','n2','IMPORTS','AMBIGUOUS',0.3,null)`).run();
  return db;
}

describe('generateGraphReport confidence audit', () => {
  it('includes confidence breakdown percentages', () => {
    const db = makeDb();
    const result = generateGraphReport(db, outputDir);
    expect(result.markdown).toContain('EXTRACTED');
    expect(result.markdown).toContain('INFERRED');
    expect(result.markdown).toContain('AMBIGUOUS');
  });

  it('includes numeric percentage values', () => {
    const db = makeDb();
    const result = generateGraphReport(db, outputDir);
    expect(result.markdown).toMatch(/\d+\.\d+%|\d+%/);
  });

  it('includes confidence audit section heading', () => {
    const db = makeDb();
    const result = generateGraphReport(db, outputDir);
    expect(result.markdown).toContain('Confidence');
  });
});
