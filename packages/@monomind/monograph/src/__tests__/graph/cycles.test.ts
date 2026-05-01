import { describe, it, expect } from 'vitest';
import { findCycles } from '../../graph/cycles.js';
import { openDb } from '../../storage/db.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-cycles-test-'));
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

describe('findCycles', () => {
  it('returns empty array for empty graph', () => {
    const db = makeTempDb();
    expect(findCycles(db)).toEqual([]);
    db.close();
  });

  it('returns empty array for single node with no self-loop', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    expect(findCycles(db)).toEqual([]);
    db.close();
  });

  it('returns empty array for a DAG (no cycles)', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const cycles = findCycles(db);
    expect(cycles).toEqual([]);
    db.close();
  });

  it('detects a simple 2-node cycle: a->b->a', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'a');
    const cycles = findCycles(db);
    expect(cycles.length).toBeGreaterThan(0);
    db.close();
  });

  it('detects a 3-node cycle: a->b->c->a', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    insertEdge(db, 'c', 'a');
    const cycles = findCycles(db);
    expect(cycles.length).toBeGreaterThan(0);
    db.close();
  });

  it('each cycle is an array of node ids forming the cycle', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    insertNode(db, 'y');
    insertEdge(db, 'x', 'y');
    insertEdge(db, 'y', 'x');
    const cycles = findCycles(db);
    expect(cycles.length).toBeGreaterThan(0);
    const cycle = cycles[0];
    expect(Array.isArray(cycle)).toBe(true);
    expect(cycle.length).toBeGreaterThan(0);
    for (const id of cycle) {
      expect(typeof id).toBe('string');
    }
    db.close();
  });

  it('does not detect cycles in a tree', () => {
    const db = makeTempDb();
    // a tree: a->b, a->c, b->d, b->e
    ['a', 'b', 'c', 'd', 'e'].forEach(id => insertNode(db, id));
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'a', 'c');
    insertEdge(db, 'b', 'd');
    insertEdge(db, 'b', 'e');
    expect(findCycles(db)).toEqual([]);
    db.close();
  });

  it('detects self-loop as a cycle', () => {
    const db = makeTempDb();
    insertNode(db, 'loop');
    // bypass FK by doing the insertion with FK off
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES ('self', 'loop', 'loop', 'CALLS', 'EXTRACTED', 1.0)`).run();
    db.pragma('foreign_keys = ON');
    const cycles = findCycles(db);
    expect(cycles.length).toBeGreaterThan(0);
    db.close();
  });

  it('handles multiple disconnected cycles', () => {
    const db = makeTempDb();
    // cycle 1: a->b->a
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'a');
    // cycle 2: c->d->c
    insertNode(db, 'c');
    insertNode(db, 'd');
    insertEdge(db, 'c', 'd');
    insertEdge(db, 'd', 'c');
    const cycles = findCycles(db);
    expect(cycles.length).toBeGreaterThanOrEqual(2);
    db.close();
  });
});
