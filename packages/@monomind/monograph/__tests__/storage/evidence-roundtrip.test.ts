import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge, getEdgesForSource } from '../../src/storage/edge-store.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

const dbPath = join(tmpdir(), `monograph-evidence-rt-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

beforeAll(() => {
  db = openDb(dbPath);

  const nodeA: MonographNode = {
    id: 'node_a',
    label: 'Function',
    name: 'funcA',
    normLabel: 'funca',
    filePath: 'src/a.ts',
    isExported: true,
  };
  const nodeB: MonographNode = {
    id: 'node_b',
    label: 'Function',
    name: 'funcB',
    normLabel: 'funcb',
    filePath: 'src/b.ts',
    isExported: false,
  };
  insertNode(db, nodeA);
  insertNode(db, nodeB);
});

afterAll(() => {
  closeDb(db);
  if (existsSync(dbPath)) unlinkSync(dbPath);
  if (existsSync(dbPath + '-wal')) unlinkSync(dbPath + '-wal');
  if (existsSync(dbPath + '-shm')) unlinkSync(dbPath + '-shm');
});

describe('evidence round-trip', () => {
  it('persists and retrieves an edge with evidence array', () => {
    const edge: MonographEdge = {
      id: 'edge_ab',
      sourceId: 'node_a',
      targetId: 'node_b',
      relation: 'CALLS',
      confidence: 'EXTRACTED',
      confidenceScore: 1.0,
      evidence: [
        { kind: 'import', weight: 0.9, note: 'direct import' },
        { kind: 'heuristic', weight: 0.5 },
      ],
    };

    insertEdge(db, edge);

    const fetched = getEdgesForSource(db, 'node_a');
    expect(fetched).toHaveLength(1);
    const retrieved = fetched[0];
    expect(retrieved.evidence).toBeDefined();
    expect(retrieved.evidence).toHaveLength(2);
    expect(retrieved.evidence![0].kind).toBe('import');
    expect(retrieved.evidence![0].weight).toBe(0.9);
    expect(retrieved.evidence![0].note).toBe('direct import');
    expect(retrieved.evidence![1].kind).toBe('heuristic');
    expect(retrieved.evidence![1].note).toBeUndefined();
  });

  it('returns undefined evidence when not set', () => {
    const edge: MonographEdge = {
      id: 'edge_ab_no_ev',
      sourceId: 'node_a',
      targetId: 'node_b',
      relation: 'IMPORTS',
      confidence: 'INFERRED',
      confidenceScore: 0.5,
    };

    insertEdge(db, edge);

    const fetched = getEdgesForSource(db, 'node_a');
    const noEvEdge = fetched.find(e => e.id === 'edge_ab_no_ev');
    expect(noEvEdge).toBeDefined();
    expect(noEvEdge!.evidence).toBeUndefined();
  });
});
