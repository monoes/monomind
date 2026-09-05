import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { pageRank } from '../../graph/pagerank.js';
import { openDb } from '../../storage/db.js';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-pagerank-test-'));
  return openDb(join(dir, 'test.db'));
}

function insertNode(db: Database.Database, id: string) {
  db.prepare(
    `INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`,
  ).run(id, id, id.toLowerCase());
}

function insertEdge(db: Database.Database, src: string, tgt: string) {
  db.prepare(
    `INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`,
  ).run(`${src}_${tgt}`, src, tgt);
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

describe('pageRank caching', () => {
  it('works on a new connection to a database with the same name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monograph-pagerank-reopen-'));
    const dbPath = join(dir, 'test.db');

    const first = openDb(dbPath);
    insertNode(first, 'a');
    insertNode(first, 'b');
    insertEdge(first, 'a', 'b');
    expect(pageRank(first).size).toBe(2);
    first.close();

    // Statements cached against the closed connection must not be reused here,
    // or better-sqlite3 throws "The database connection is not open".
    const second = openDb(dbPath);
    expect(() => pageRank(second)).not.toThrow();
    expect(pageRank(second).size).toBe(2);
    second.close();
  });

  it('does not reuse a cached result across different damping factors', () => {
    const db = makeTempDb();
    for (const id of ['a', 'b', 'c', 'd']) insertNode(db, id);
    insertEdge(db, 'a', 'd');
    insertEdge(db, 'b', 'd');
    insertEdge(db, 'c', 'd');

    // Damping 0 makes every node uniform (1/N); damping 0.85 favours the hub.
    const uniform = pageRank(db, { dampingFactor: 0 });
    const damped = pageRank(db, { dampingFactor: 0.85 });

    expect(uniform.get('d')).toBeCloseTo(0.25, 6);
    expect(damped.get('d')).toBeGreaterThan(uniform.get('d') ?? 0);
    db.close();
  });

  it('recomputes when the graph is rewired without changing node or edge counts', () => {
    const db = makeTempDb();
    for (const id of ['a', 'b', 'c', 'd']) insertNode(db, id);
    insertEdge(db, 'a', 'd');
    insertEdge(db, 'b', 'd');
    const before = pageRank(db);

    // Move one edge from d to c — node and edge counts are both unchanged.
    db.prepare(`UPDATE edges SET target_id = 'c' WHERE id = 'a_d'`).run();
    const counts = db.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number };
    expect(counts.n).toBe(2);

    const after = pageRank(db);
    expect(after.get('d')).not.toBeCloseTo(before.get('d') ?? 0, 6);
    expect(after.get('c')).toBeCloseTo(after.get('d') ?? 0, 6);
    db.close();
  });

  it('returns an independent map so callers cannot corrupt the cache', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');

    const first = pageRank(db);
    first.set('a', 999);
    first.delete('b');

    const second = pageRank(db);
    expect(second.get('a')).not.toBe(999);
    expect(second.has('b')).toBe(true);
    db.close();
  });
});
