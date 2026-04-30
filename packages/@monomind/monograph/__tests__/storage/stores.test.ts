import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode, getNode, deleteNodesForFile } from '../../src/storage/node-store.js';
import { insertEdge, getEdgesForSource } from '../../src/storage/edge-store.js';
import { ftsSearch } from '../../src/storage/fts-store.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

const dbPath = join(tmpdir(), `monograph-stores-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

beforeAll(() => {
  db = openDb(dbPath);
});

afterAll(() => {
  closeDb(db);
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
  // Also cleanup WAL files
  if (existsSync(dbPath + '-wal')) unlinkSync(dbPath + '-wal');
  if (existsSync(dbPath + '-shm')) unlinkSync(dbPath + '-shm');
});

describe('node-store', () => {
  const node: MonographNode = {
    id: 'foo_bar',
    label: 'Function',
    name: 'bar',
    normLabel: 'bar',
    filePath: 'src/foo.ts',
    startLine: 10,
    endLine: 20,
    isExported: true,
    language: 'typescript',
  };

  it('inserts and retrieves a node', () => {
    insertNode(db, node);
    const fetched = getNode(db, 'foo_bar');
    expect(fetched?.name).toBe('bar');
    expect(fetched?.isExported).toBe(true);
  });

  it('deletes nodes by file path', () => {
    deleteNodesForFile(db, 'src/foo.ts');
    expect(getNode(db, 'foo_bar')).toBeUndefined();
  });
});

describe('edge-store', () => {
  beforeAll(() => {
    insertNode(db, {
      id: 'n1',
      label: 'Class',
      name: 'A',
      normLabel: 'a',
      isExported: false,
    });
    insertNode(db, {
      id: 'n2',
      label: 'Class',
      name: 'B',
      normLabel: 'b',
      isExported: false,
    });
  });

  it('inserts and retrieves edges by source', () => {
    const edge: MonographEdge = {
      id: 'e1',
      sourceId: 'n1',
      targetId: 'n2',
      relation: 'EXTENDS',
      confidence: 'EXTRACTED',
      confidenceScore: 1.0,
    };
    insertEdge(db, edge);
    const edges = getEdgesForSource(db, 'n1');
    expect(edges).toHaveLength(1);
    expect(edges[0].relation).toBe('EXTENDS');
  });
});

describe('fts-store', () => {
  it('finds nodes by keyword', () => {
    insertNode(db, {
      id: 'auth_service',
      label: 'Class',
      name: 'AuthService',
      normLabel: 'authservice',
      filePath: 'src/auth.ts',
      isExported: true,
    });
    const results = ftsSearch(db, 'auth', 10);
    expect(results.some((r) => r.id === 'auth_service')).toBe(true);
  });
});
