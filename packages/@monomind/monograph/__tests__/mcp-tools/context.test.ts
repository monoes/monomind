import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getMonographContext } from '../../src/mcp-tools/context.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

const dbPath = join(tmpdir(), `monograph-context-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const nodeA: MonographNode = {
  id: 'ctx_a',
  label: 'Function',
  name: 'alpha',
  normLabel: 'alpha',
  filePath: 'src/a.ts',
  startLine: 1,
  isExported: true,
};
const nodeB: MonographNode = {
  id: 'ctx_b',
  label: 'Function',
  name: 'beta',
  normLabel: 'beta',
  filePath: 'src/b.ts',
  startLine: 5,
  isExported: false,
};
const nodeC: MonographNode = {
  id: 'ctx_c',
  label: 'Class',
  name: 'Gamma',
  normLabel: 'gamma',
  filePath: 'src/c.ts',
  startLine: 1,
  isExported: true,
};

// b calls a, a imports c
const edgeCallBA: MonographEdge = {
  id: 'e_ba_calls',
  sourceId: 'ctx_b',
  targetId: 'ctx_a',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};
const edgeImportAC: MonographEdge = {
  id: 'e_ac_imports',
  sourceId: 'ctx_a',
  targetId: 'ctx_c',
  relation: 'IMPORTS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, nodeA);
  insertNode(db, nodeB);
  insertNode(db, nodeC);
  insertEdge(db, edgeCallBA);
  insertEdge(db, edgeImportAC);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

describe('getMonographContext', () => {
  it('returns null node for unknown symbol', () => {
    const result = getMonographContext(db, { name: 'nonexistent' });
    expect(result.node).toBeNull();
    expect(result.callers).toHaveLength(0);
  });

  it('finds the node by name', () => {
    const result = getMonographContext(db, { name: 'alpha' });
    expect(result.node).not.toBeNull();
    expect(result.node?.id).toBe('ctx_a');
  });

  it('populates callers correctly (b calls a)', () => {
    const result = getMonographContext(db, { name: 'alpha' });
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0].id).toBe('ctx_b');
  });

  it('populates callees correctly (a calls nothing here)', () => {
    const result = getMonographContext(db, { name: 'alpha' });
    expect(result.callees).toHaveLength(0);
  });

  it('populates imports correctly (a imports c)', () => {
    const result = getMonographContext(db, { name: 'alpha' });
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].id).toBe('ctx_c');
  });

  it('populates importedBy correctly (c is imported by a)', () => {
    const result = getMonographContext(db, { name: 'Gamma' });
    expect(result.importedBy).toHaveLength(1);
    expect(result.importedBy[0].id).toBe('ctx_a');
  });

  it('disambiguates by filePath', () => {
    const result = getMonographContext(db, { name: 'alpha', filePath: 'src/a.ts' });
    expect(result.node?.id).toBe('ctx_a');
  });

  it('returns null for wrong filePath', () => {
    const result = getMonographContext(db, { name: 'alpha', filePath: 'src/wrong.ts' });
    expect(result.node).toBeNull();
  });

  it('community is null when node has no communityId', () => {
    const result = getMonographContext(db, { name: 'alpha' });
    expect(result.community).toBeNull();
  });

  it('inProcesses is empty when no STEP_IN_PROCESS edges', () => {
    const result = getMonographContext(db, { name: 'alpha' });
    expect(result.inProcesses).toHaveLength(0);
  });
});
