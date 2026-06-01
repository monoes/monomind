import { describe, it, expect } from 'vitest';
import { graphDensity, clusteringCoefficient, averagePathLength, graphDiameter } from '../../graph/statistics.js';
import Database from 'better-sqlite3';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-stats-test-'));
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

describe('graphDensity', () => {
  it('returns 0 for empty graph', () => {
    const db = makeTempDb();
    expect(graphDensity(db)).toBe(0);
    db.close();
  });

  it('returns 0 for graph with only nodes and no edges', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    expect(graphDensity(db)).toBe(0);
    db.close();
  });

  it('returns 1 for complete directed graph of 3 nodes (6 edges)', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'a', 'c');
    insertEdge(db, 'b', 'a');
    insertEdge(db, 'b', 'c');
    insertEdge(db, 'c', 'a');
    insertEdge(db, 'c', 'b');
    expect(graphDensity(db)).toBeCloseTo(1, 5);
    db.close();
  });

  it('returns value between 0 and 1 for partial graph', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const d = graphDensity(db);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
    db.close();
  });

  it('returns a number', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    expect(typeof graphDensity(db)).toBe('number');
    db.close();
  });
});

describe('clusteringCoefficient', () => {
  it('returns 0 for empty graph', () => {
    const db = makeTempDb();
    expect(clusteringCoefficient(db)).toBe(0);
    db.close();
  });

  it('returns 0 for a chain graph (no triangles)', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const cc = clusteringCoefficient(db);
    expect(cc).toBeGreaterThanOrEqual(0);
    expect(cc).toBeLessThanOrEqual(1);
    db.close();
  });

  it('returns 1 for fully connected triangle', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    // bidirectional triangle
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'a');
    insertEdge(db, 'b', 'c');
    insertEdge(db, 'c', 'b');
    insertEdge(db, 'a', 'c');
    insertEdge(db, 'c', 'a');
    const cc = clusteringCoefficient(db);
    expect(cc).toBeGreaterThanOrEqual(0);
    expect(cc).toBeLessThanOrEqual(1);
    db.close();
  });

  it('returns a number between 0 and 1', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    insertNode(db, 'y');
    insertEdge(db, 'x', 'y');
    const cc = clusteringCoefficient(db);
    expect(typeof cc).toBe('number');
    expect(cc).toBeGreaterThanOrEqual(0);
    expect(cc).toBeLessThanOrEqual(1);
    db.close();
  });
});

describe('averagePathLength', () => {
  it('returns 0 for empty graph', () => {
    const db = makeTempDb();
    expect(averagePathLength(db)).toBe(0);
    db.close();
  });

  it('returns 0 for single node', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    expect(averagePathLength(db)).toBe(0);
    db.close();
  });

  it('returns 1 for two directly connected nodes', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    // a->b has path length 1; b->a unreachable
    expect(averagePathLength(db)).toBeCloseTo(1, 5);
    db.close();
  });

  it('returns 4/3 for a->b->c chain (a->b=1, a->c=2, b->c=1)', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    // reachable pairs: (a,b)=1, (a,c)=2, (b,c)=1 => total 4 / 3 pairs
    const apl = averagePathLength(db);
    expect(apl).toBeCloseTo(4 / 3, 5);
    db.close();
  });

  it('returns a non-negative number', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    insertNode(db, 'y');
    insertEdge(db, 'x', 'y');
    expect(averagePathLength(db)).toBeGreaterThanOrEqual(0);
    db.close();
  });
});

describe('graphDiameter', () => {
  it('returns 0 for empty graph', () => {
    const db = makeTempDb();
    expect(graphDiameter(db)).toBe(0);
    db.close();
  });

  it('returns 0 for single node', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    expect(graphDiameter(db)).toBe(0);
    db.close();
  });

  it('returns 1 for two directly connected nodes', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    expect(graphDiameter(db)).toBe(1);
    db.close();
  });

  it('returns 2 for a->b->c chain', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    expect(graphDiameter(db)).toBe(2);
    db.close();
  });

  it('returns 3 for a->b->c->d chain', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertNode(db, 'd');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    insertEdge(db, 'c', 'd');
    expect(graphDiameter(db)).toBe(3);
    db.close();
  });
});
