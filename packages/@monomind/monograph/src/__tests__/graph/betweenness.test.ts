import { describe, it, expect } from 'vitest';
import { getBetweennessCentrality } from '../../graph/analyzer.js';
import Database from 'better-sqlite3';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-test-'));
  return openDb(join(dir, 'test.db'));
}

function insertNode(db: Database.Database, id: string, name = id) {
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`)
    .run(id, name, name.toLowerCase());
}

function insertEdge(db: Database.Database, src: string, tgt: string) {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
    .run(`${src}_${tgt}`, src, tgt);
}

describe('getBetweennessCentrality', () => {
  it('returns a map from node id to centrality score', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');

    const result = getBetweennessCentrality(db);
    expect(result).toBeInstanceOf(Map);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
    db.close();
  });

  it('node on all shortest paths has highest centrality', () => {
    // a -> b -> c: b is on all paths between a and c
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');

    const result = getBetweennessCentrality(db);
    // b should have higher betweenness than a and c (endpoints)
    expect(result.get('b')!).toBeGreaterThan(result.get('a')!);
    expect(result.get('b')!).toBeGreaterThan(result.get('c')!);
    db.close();
  });

  it('returns zero for isolated nodes', () => {
    const db = makeTempDb();
    insertNode(db, 'isolated');

    const result = getBetweennessCentrality(db);
    expect(result.get('isolated')).toBe(0);
    db.close();
  });

  it('returns empty map for empty graph', () => {
    const db = makeTempDb();
    const result = getBetweennessCentrality(db);
    expect(result.size).toBe(0);
    db.close();
  });

  it('all scores are non-negative numbers', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    insertNode(db, 'y');
    insertNode(db, 'z');
    insertEdge(db, 'x', 'y');
    insertEdge(db, 'y', 'z');
    insertEdge(db, 'x', 'z');

    const result = getBetweennessCentrality(db);
    for (const [, score] of result) {
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
    }
    db.close();
  });
});
