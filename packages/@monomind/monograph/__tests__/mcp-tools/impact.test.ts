import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getMonographImpact } from '../../src/mcp-tools/impact.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

// Graph: a() calls b(), b() calls c()
// Impact on c: directCallers=[b], transitiveCallers=[a at depth 2]

const dbPath = join(tmpdir(), `monograph-impact-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const nodeA: MonographNode = {
  id: 'imp_a',
  label: 'Function',
  name: 'funcA',
  normLabel: 'funca',
  filePath: 'src/a.ts',
  startLine: 1,
  isExported: true,
};
const nodeB: MonographNode = {
  id: 'imp_b',
  label: 'Function',
  name: 'funcB',
  normLabel: 'funcb',
  filePath: 'src/b.ts',
  startLine: 1,
  isExported: true,
};
const nodeC: MonographNode = {
  id: 'imp_c',
  label: 'Function',
  name: 'funcC',
  normLabel: 'funcc',
  filePath: 'src/c.ts',
  startLine: 1,
  isExported: false,
};

// a calls b
const edgeAB: MonographEdge = {
  id: 'e_ab',
  sourceId: 'imp_a',
  targetId: 'imp_b',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};
// b calls c
const edgeBC: MonographEdge = {
  id: 'e_bc',
  sourceId: 'imp_b',
  targetId: 'imp_c',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, nodeA);
  insertNode(db, nodeB);
  insertNode(db, nodeC);
  insertEdge(db, edgeAB);
  insertEdge(db, edgeBC);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

describe('getMonographImpact', () => {
  it('returns null node for unknown symbol', () => {
    const result = getMonographImpact(db, { name: 'nonexistent' });
    expect(result.node).toBeNull();
    expect(result.directCallers).toHaveLength(0);
    expect(result.riskScore).toBe(0);
  });

  it('finds the node by name', () => {
    const result = getMonographImpact(db, { name: 'funcC' });
    expect(result.node).not.toBeNull();
    expect(result.node?.id).toBe('imp_c');
  });

  it('directCallers contains funcB', () => {
    const result = getMonographImpact(db, { name: 'funcC' });
    expect(result.directCallers).toHaveLength(1);
    expect(result.directCallers[0].id).toBe('imp_b');
  });

  it('transitiveCallers contains funcA at depth 2', () => {
    const result = getMonographImpact(db, { name: 'funcC' });
    expect(result.transitiveCallers.length).toBeGreaterThan(0);
    const depth2 = result.transitiveCallers.find(t => t.depth === 2);
    expect(depth2).toBeDefined();
    expect(depth2!.nodes.some(n => n.id === 'imp_a')).toBe(true);
  });

  it('affectedFiles contains file of funcB', () => {
    const result = getMonographImpact(db, { name: 'funcC' });
    expect(result.affectedFiles).toContain('src/b.ts');
  });

  it('riskScore is greater than 0 when there are callers', () => {
    const result = getMonographImpact(db, { name: 'funcC' });
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it('riskScore is 0 for leaf nodes with no callers', () => {
    const result = getMonographImpact(db, { name: 'funcA' });
    // funcA has no callers
    expect(result.directCallers).toHaveLength(0);
    expect(result.riskScore).toBe(0);
  });

  it('respects depth limit', () => {
    // With depth=1, only direct callers of c (b), no transitive (a)
    const result = getMonographImpact(db, { name: 'funcC', depth: 1 });
    expect(result.directCallers).toHaveLength(1);
    const hasATransitive = result.transitiveCallers.some(t =>
      t.nodes.some(n => n.id === 'imp_a'),
    );
    expect(hasATransitive).toBe(false);
  });
});
