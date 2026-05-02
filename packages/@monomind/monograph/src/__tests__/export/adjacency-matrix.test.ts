import { describe, it, expect } from 'vitest';
import {
  buildAdjacencyMatrix,
  buildAdjacencyMatrixFromDb,
  adjacencyMatrixToCsv,
} from '../../export/adjacency-matrix.js';
import { openDb } from '../../storage/db.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import type { MonographNode, MonographEdge } from '../../types.js';

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'monograph-adjmatrix-test-'));
  return openDb(join(dir, 'test.db'));
}

function insertNode(db: ReturnType<typeof openDb>, id: string) {
  db.prepare(`INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, 'Function', ?, ?, 0)`)
    .run(id, id, id.toLowerCase());
}

function insertEdge(db: ReturnType<typeof openDb>, src: string, tgt: string) {
  db.prepare(`INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', 1.0)`)
    .run(`${src}_${tgt}`, src, tgt);
}

function makeNode(id: string): MonographNode {
  return { id, label: 'Function', name: id, normLabel: id.toLowerCase(), isExported: false };
}

function makeEdge(src: string, tgt: string): MonographEdge {
  return { id: `${src}_${tgt}`, sourceId: src, targetId: tgt, relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1.0 };
}

describe('buildAdjacencyMatrix', () => {
  it('builds a zero matrix for no edges', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const result = buildAdjacencyMatrix(nodes, []);
    expect(result.nodeIds).toEqual(['a', 'b']);
    expect(result.matrix[0]).toEqual([0, 0]);
    expect(result.matrix[1]).toEqual([0, 0]);
  });

  it('counts a single edge correctly', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b')];
    const result = buildAdjacencyMatrix(nodes, edges);
    // a→b: matrix[0][1] = 1, all others = 0
    expect(result.matrix[0][1]).toBe(1);
    expect(result.matrix[0][0]).toBe(0);
    expect(result.matrix[1][0]).toBe(0);
  });

  it('counts multi-edges between the same pair', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const e1: MonographEdge = { ...makeEdge('a', 'b'), id: 'e1' };
    const e2: MonographEdge = { ...makeEdge('a', 'b'), id: 'e2' };
    const result = buildAdjacencyMatrix(nodes, [e1, e2]);
    expect(result.matrix[0][1]).toBe(2);
  });

  it('ignores edges whose endpoints are not in the node list', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const dangling = makeEdge('a', 'z'); // 'z' not in nodes
    const result = buildAdjacencyMatrix(nodes, [dangling]);
    expect(result.matrix[0][0]).toBe(0);
    expect(result.matrix[0][1]).toBe(0);
  });
});

describe('buildAdjacencyMatrixFromDb', () => {
  it('builds matrix from all nodes in db', () => {
    const db = makeTempDb();
    insertNode(db, 'a'); insertNode(db, 'b'); insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    insertEdge(db, 'b', 'c');
    const result = buildAdjacencyMatrixFromDb(db);
    expect(result.nodeIds).toHaveLength(3);
    // Find indices
    const ai = result.nodeIds.indexOf('a');
    const bi = result.nodeIds.indexOf('b');
    expect(result.matrix[ai][bi]).toBe(1);
    db.close();
  });

  it('restricts to given nodeIds subset', () => {
    const db = makeTempDb();
    insertNode(db, 'a'); insertNode(db, 'b'); insertNode(db, 'c');
    insertEdge(db, 'a', 'b');
    const result = buildAdjacencyMatrixFromDb(db, ['a', 'b']);
    expect(result.nodeIds).toHaveLength(2);
    expect(result.nodeIds).not.toContain('c');
    db.close();
  });
});

describe('adjacencyMatrixToCsv', () => {
  it('generates a CSV with node names as headers', () => {
    const am = buildAdjacencyMatrix([makeNode('a'), makeNode('b')], [makeEdge('a', 'b')]);
    const csv = adjacencyMatrixToCsv(am);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('"a"');
    expect(lines[0]).toContain('"b"');
    // Row for 'a': first cell is "a", second is 1
    const aRow = lines.find(l => l.startsWith('"a"'))!;
    expect(aRow).toContain('1');
  });

  it('escapes double quotes in node names', () => {
    const node: MonographNode = { id: 'x', label: 'Function', name: 'say "hello"', normLabel: 'say hello', isExported: false };
    const am = buildAdjacencyMatrix([node], []);
    const csv = adjacencyMatrixToCsv(am);
    expect(csv).toContain('""hello""');
  });
});
