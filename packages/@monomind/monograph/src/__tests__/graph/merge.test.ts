import { describe, it, expect } from 'vitest';
import { mergeGraphs, mergeGraphIntoDb } from '../../graph/merge.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import type { MonographNode, MonographEdge } from '../../types.js';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-merge-test-'));
  return openDb(join(dir, 'test.db'));
}

function makeNode(id: string, overrides: Partial<MonographNode> = {}): MonographNode {
  return {
    id,
    label: 'Function',
    name: id,
    normLabel: id.toLowerCase(),
    isExported: false,
    ...overrides,
  };
}

function makeEdge(id: string, src: string, tgt: string, overrides: Partial<MonographEdge> = {}): MonographEdge {
  return {
    id,
    sourceId: src,
    targetId: tgt,
    relation: 'CALLS',
    confidence: 'EXTRACTED',
    confidenceScore: 1.0,
    ...overrides,
  };
}

// ── In-memory merge ────────────────────────────────────────────────────────────

describe('mergeGraphs (in-memory)', () => {
  it('merges disjoint graphs', () => {
    const base = { nodes: [makeNode('a')], edges: [makeEdge('e1', 'a', 'b')] };
    const incoming = { nodes: [makeNode('b'), makeNode('c')], edges: [makeEdge('e2', 'b', 'c')] };
    const result = mergeGraphs(base, incoming);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.nodesAdded).toBe(2);
    expect(result.edgesAdded).toBe(1);
    expect(result.nodesSkipped).toBe(0);
    expect(result.edgesSkipped).toBe(0);
  });

  it('skips conflicting nodes/edges by default (skip strategy)', () => {
    const nodeA = makeNode('a', { name: 'original' });
    const base = { nodes: [nodeA], edges: [] };
    const nodeANew = makeNode('a', { name: 'updated' });
    const incoming = { nodes: [nodeANew], edges: [] };
    const result = mergeGraphs(base, incoming);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].name).toBe('original');
    expect(result.nodesSkipped).toBe(1);
    expect(result.nodesAdded).toBe(0);
  });

  it('replaces conflicting nodes/edges with replace strategy', () => {
    const nodeA = makeNode('a', { name: 'original' });
    const base = { nodes: [nodeA], edges: [] };
    const nodeANew = makeNode('a', { name: 'updated' });
    const incoming = { nodes: [nodeANew], edges: [] };
    const result = mergeGraphs(base, incoming, { onConflict: 'replace' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].name).toBe('updated');
    expect(result.nodesAdded).toBe(1);
  });

  it('skips conflicting edges', () => {
    const base = { nodes: [], edges: [makeEdge('e1', 'a', 'b')] };
    const incoming = { nodes: [], edges: [makeEdge('e1', 'a', 'c')] }; // same id, different target
    const result = mergeGraphs(base, incoming);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].targetId).toBe('b'); // original kept
    expect(result.edgesSkipped).toBe(1);
  });
});

// ── DB-backed merge ────────────────────────────────────────────────────────────

function insertNode(db: ReturnType<typeof openDb>, id: string, name = id) {
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`)
    .run(id, name, name.toLowerCase());
}

function insertEdge(db: ReturnType<typeof openDb>, id: string, src: string, tgt: string) {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
    .run(id, src, tgt);
}

describe('mergeGraphIntoDb', () => {
  it('inserts new nodes and edges into target db', () => {
    const db = makeTempDb();
    insertNode(db, 'a');

    const incoming = {
      nodes: [makeNode('b'), makeNode('c')],
      edges: [makeEdge('e1', 'b', 'c')],
    };
    const result = mergeGraphIntoDb(db, incoming);
    expect(result.nodesAdded).toBe(2);
    expect(result.edgesAdded).toBe(1);

    const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
    expect(nodeCount).toBe(3); // a + b + c
    db.close();
  });

  it('skips existing nodes with default strategy', () => {
    const db = makeTempDb();
    insertNode(db, 'a', 'original');

    const incoming = {
      nodes: [makeNode('a', { name: 'updated' })],
      edges: [],
    };
    mergeGraphIntoDb(db, incoming);
    const row = db.prepare('SELECT name FROM nodes WHERE id = ?').get('a') as { name: string };
    expect(row.name).toBe('original');
    db.close();
  });

  it('replaces existing nodes with replace strategy', () => {
    const db = makeTempDb();
    insertNode(db, 'a', 'original');

    const incoming = {
      nodes: [makeNode('a', { name: 'updated', normLabel: 'updated' })],
      edges: [],
    };
    mergeGraphIntoDb(db, incoming, { onConflict: 'replace' });
    const row = db.prepare('SELECT name FROM nodes WHERE id = ?').get('a') as { name: string };
    expect(row.name).toBe('updated');
    db.close();
  });

  it('handles empty incoming gracefully', () => {
    const db = makeTempDb();
    insertNode(db, 'a');
    const result = mergeGraphIntoDb(db, { nodes: [], edges: [] });
    expect(result.nodesAdded).toBe(0);
    expect(result.edgesAdded).toBe(0);
    db.close();
  });
});
