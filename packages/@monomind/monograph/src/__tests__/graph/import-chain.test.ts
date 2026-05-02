import { describe, it, expect } from 'vitest';
import { traceImportChain } from '../../graph/import-chain.js';
import { openDb } from '../../storage/db.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-import-chain-test-'));
  return openDb(join(dir, 'test.db'));
}

function insertNode(db: Database.Database, id: string) {
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'File', ?, ?, 0)`)
    .run(id, id, id.toLowerCase());
}

function insertEdge(db: Database.Database, src: string, tgt: string) {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'IMPORTS', 'EXTRACTED', 1.0)`)
    .run(`${src}_${tgt}`, src, tgt);
}

describe('traceImportChain', () => {
  it('returns empty array when source does not exist', () => {
    const db = makeTempDb();
    const result = traceImportChain(db, 'nonexistent', 'also-nonexistent');
    expect(result).toEqual([]);
    db.close();
  });

  it('returns empty array when no path exists', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    // no edge between them
    const result = traceImportChain(db, 'a', 'b');
    expect(result).toEqual([]);
    db.close();
  });

  it('returns direct path when directly connected', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    const result = traceImportChain(db, 'a', 'b');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toEqual(['a', 'b']);
    db.close();
  });

  it('returns path through intermediate node a->b->c', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const result = traceImportChain(db, 'a', 'c');
    expect(result.length).toBeGreaterThan(0);
    const hasPath = result.some(p => JSON.stringify(p) === JSON.stringify(['a', 'b', 'c']));
    expect(hasPath).toBe(true);
    db.close();
  });

  it('returns multiple paths when they exist', () => {
    const db = makeTempDb();
    // a->b->d and a->c->d
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertNode(db, 'd');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'a', 'c');
    insertEdge(db, 'b', 'd');
    insertEdge(db, 'c', 'd');
    const result = traceImportChain(db, 'a', 'd');
    expect(result.length).toBe(2);
    db.close();
  });

  it('respects maxDepth option', () => {
    const db = makeTempDb();
    // a->b->c->d (depth 3 to reach d from a)
    ['a', 'b', 'c', 'd'].forEach(n => insertNode(db, n));
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    insertEdge(db, 'c', 'd');
    // max depth 2 should not find a->b->c->d
    const result = traceImportChain(db, 'a', 'd', { maxDepth: 2 });
    expect(result).toEqual([]);
    db.close();
  });

  it('returns paths as arrays of node id strings', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    insertNode(db, 'y');
    insertEdge(db, 'x', 'y');
    const result = traceImportChain(db, 'x', 'y');
    expect(Array.isArray(result)).toBe(true);
    for (const path of result) {
      expect(Array.isArray(path)).toBe(true);
      for (const node of path) {
        expect(typeof node).toBe('string');
      }
    }
    db.close();
  });
});
