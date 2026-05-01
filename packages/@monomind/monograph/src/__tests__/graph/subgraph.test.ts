import { describe, it, expect } from 'vitest';
import { extractInducedSubgraph } from '../../graph/subgraph.js';
import { openDb } from '../../storage/db.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-subgraph-test-'));
  return openDb(join(dir, 'test.db'));
}

function insertNode(db: Database.Database, id: string, name = id) {
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`)
    .run(id, name, name.toLowerCase());
}

function insertEdge(db: Database.Database, src: string, tgt: string, relation = 'CALLS') {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, ?, 'EXTRACTED', 1.0)`)
    .run(`${src}_${tgt}`, src, tgt, relation);
}

describe('extractInducedSubgraph', () => {
  it('returns empty nodes and edges for empty node set', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b');
    const result = extractInducedSubgraph(db, []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    db.close();
  });

  it('returns only specified nodes', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const result = extractInducedSubgraph(db, ['a', 'b']);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map(n => n.id).sort()).toEqual(['a', 'b']);
    db.close();
  });

  it('returns only edges where both source and target are in the node set', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const result = extractInducedSubgraph(db, ['a', 'b']);
    // a->b is in subgraph; b->c is NOT (c excluded)
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceId).toBe('a');
    expect(result.edges[0].targetId).toBe('b');
    db.close();
  });

  it('excludes edges crossing the subgraph boundary', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'a', 'c');
    const result = extractInducedSubgraph(db, ['a', 'b']);
    expect(result.edges).toHaveLength(1);
    db.close();
  });

  it('handles a single node with no edges', () => {
    const db = makeTempDb();
    insertNode(db, 'solo');
    const result = extractInducedSubgraph(db, ['solo']);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    db.close();
  });

  it('ignores node ids not in the database', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    const result = extractInducedSubgraph(db, ['a', 'ghost']);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('a');
    db.close();
  });

  it('returns all edges within the full node set', () => {
    const db = makeTempDb();
    insertNode(db, 'x');
    insertNode(db, 'y');
    insertNode(db, 'z');
    insertEdge(db, 'x', 'y');
    insertEdge(db, 'y', 'z');
    insertEdge(db, 'x', 'z');
    const result = extractInducedSubgraph(db, ['x', 'y', 'z']);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
    db.close();
  });

  it('returns MonographNode and MonographEdge shaped objects', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    insertNode(db, 'b');
    insertEdge(db, 'a', 'b', 'IMPORTS');
    const result = extractInducedSubgraph(db, ['a', 'b']);
    const node = result.nodes[0];
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('label');
    expect(node).toHaveProperty('name');
    expect(node).toHaveProperty('isExported');
    const edge = result.edges[0];
    expect(edge).toHaveProperty('id');
    expect(edge).toHaveProperty('sourceId');
    expect(edge).toHaveProperty('targetId');
    expect(edge).toHaveProperty('relation');
    expect(edge.relation).toBe('IMPORTS');
    db.close();
  });
});
