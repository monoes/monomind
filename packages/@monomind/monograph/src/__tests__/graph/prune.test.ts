import { describe, it, expect } from 'vitest';
import { pruneDanglingEdges } from '../../graph/prune.js';
import { openDb } from '../../storage/db.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-prune-test-'));
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

function insertEdgeRaw(db: Database.Database, src: string, tgt: string) {
  // inserts edge without inserting nodes — creates dangling edge
  // temporarily disable FK checks to allow dangling edges
  db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
    .run(`${src}_${tgt}`, src, tgt);
  db.pragma('foreign_keys = ON');
}

function getEdgeCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number }).n;
}

describe('pruneDanglingEdges', () => {
  it('returns 0 pruned for empty graph', () => {
    const db = makeTempDb();
    const pruned = pruneDanglingEdges(db);
    expect(pruned).toBe(0);
    db.close();
  });

  it('returns 0 pruned when all edges reference existing nodes', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    const pruned = pruneDanglingEdges(db);
    expect(pruned).toBe(0);
    expect(getEdgeCount(db)).toBe(1);
    db.close();
  });

  it('removes edge with missing source node', () => {
    const db = makeTempDb();
    insertNode(db, 'b');
    insertEdgeRaw(db, 'ghost', 'b');
    expect(getEdgeCount(db)).toBe(1);
    const pruned = pruneDanglingEdges(db);
    expect(pruned).toBe(1);
    expect(getEdgeCount(db)).toBe(0);
    db.close();
  });

  it('removes edge with missing target node', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertEdgeRaw(db, 'a', 'missing');
    expect(getEdgeCount(db)).toBe(1);
    const pruned = pruneDanglingEdges(db);
    expect(pruned).toBe(1);
    expect(getEdgeCount(db)).toBe(0);
    db.close();
  });

  it('removes multiple dangling edges', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');       // valid
    insertEdgeRaw(db, 'ghost1', 'a'); // dangling source
    insertEdgeRaw(db, 'b', 'ghost2'); // dangling target
    expect(getEdgeCount(db)).toBe(3);
    const pruned = pruneDanglingEdges(db);
    expect(pruned).toBe(2);
    expect(getEdgeCount(db)).toBe(1);
    db.close();
  });

  it('returns the count of pruned edges', () => {
    const db = makeTempDb();
    insertEdgeRaw(db, 'x', 'y'); // both nodes missing
    const pruned = pruneDanglingEdges(db);
    expect(typeof pruned).toBe('number');
    expect(pruned).toBe(1);
    db.close();
  });

  it('is idempotent — second call returns 0', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertEdgeRaw(db, 'a', 'missing');
    pruneDanglingEdges(db);
    const second = pruneDanglingEdges(db);
    expect(second).toBe(0);
    db.close();
  });
});
