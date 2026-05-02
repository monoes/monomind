import { describe, it, expect } from 'vitest';
import { pageRank } from '../../graph/pagerank.js';
import { openDb } from '../../storage/db.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-pagerank-test-'));
  return openDb(join(dir, 'test.db'));
}

function insertNode(db: Database.Database, id: string) {
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`)
    .run(id, id, id.toLowerCase());
}

function insertEdge(db: Database.Database, src: string, tgt: string) {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
    .run(`${src}_${tgt}`, src, tgt);
}

describe('pageRank', () => {
  it('returns empty map for empty graph', () => {
    const db = makeTempDb();
    const result = pageRank(db);
    expect(result.size).toBe(0);
    db.close();
  });

  it('returns score 1.0 for single node (normalized)', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    const result = pageRank(db);
    expect(result.size).toBe(1);
    expect(result.get('a')).toBeCloseTo(1.0, 2);
    db.close();
  });

  it('returns scores that sum to approximately 1.0', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const result = pageRank(db);
    const sum = [...result.values()].reduce((acc, v) => acc + v, 0);
    // sum of all scores should equal approximately 1.0 (probability distribution)
    expect(sum).toBeCloseTo(1.0, 1);
    db.close();
  });

  it('gives higher rank to nodes with more incoming edges', () => {
    const db = makeTempDb();
    // hub: a, b, c all point to d
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertNode(db, 'd');
    insertEdge(db, 'a', 'd');
    insertEdge(db, 'b', 'd');
    insertEdge(db, 'c', 'd');
    const result = pageRank(db);
    const rankD = result.get('d') ?? 0;
    const rankA = result.get('a') ?? 0;
    expect(rankD).toBeGreaterThan(rankA);
    db.close();
  });

  it('returns Map<string, number>', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    insertNode(db, 'y');
    insertEdge(db, 'x', 'y');
    const result = pageRank(db);
    expect(result instanceof Map).toBe(true);
    for (const [k, v] of result) {
      expect(typeof k).toBe('string');
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThan(0);
    }
    db.close();
  });

  it('accepts custom damping factor and iterations', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    const result = pageRank(db, { dampingFactor: 0.5, maxIterations: 20 });
    expect(result.size).toBe(2);
    db.close();
  });
});
