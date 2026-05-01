import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getProcessesResource } from '../../src/mcp-resources/processes-resource.js';
import { getCommunitiesResource } from '../../src/mcp-resources/communities-resource.js';
import { getSchemaResource } from '../../src/mcp-resources/schema-resource.js';
import { getGraphResource } from '../../src/mcp-resources/graph-resource.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

type Db = ReturnType<typeof openDb>;

// Each test gets a fresh DB with a unique path to avoid cross-test contamination
function freshDb(): { db: Db; cleanup: () => void } {
  const dbPath = join(tmpdir(), `monograph-res-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(dbPath);
  return {
    db,
    cleanup: () => {
      closeDb(db);
      if (existsSync(dbPath)) unlinkSync(dbPath);
    },
  };
}

function makeNode(overrides: Partial<MonographNode> & Pick<MonographNode, 'id' | 'name' | 'label'>): MonographNode {
  return {
    normLabel: overrides.name.toLowerCase(),
    filePath: 'src/test.ts',
    startLine: 1,
    isExported: true,
    ...overrides,
  };
}

function makeEdge(id: string, sourceId: string, targetId: string, relation: string): MonographEdge {
  return {
    id,
    sourceId,
    targetId,
    relation,
    confidence: 'EXTRACTED',
    confidenceScore: 1.0,
  };
}

// ── Processes resource ─────────────────────────────────────────────────────────

describe('getProcessesResource', () => {
  it('returns empty processes list when no Process nodes exist', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 'fn1', name: 'doSomething', label: 'Function' }));
      const result = getProcessesResource(db);
      expect(result.processes).toEqual([]);
    } finally { cleanup(); }
  });

  it('returns Process nodes with no steps when no STEP_IN_PROCESS edges exist', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 'proc1', name: 'CheckoutProcess', label: 'Process' }));
      const result = getProcessesResource(db);
      expect(result.processes).toHaveLength(1);
      expect(result.processes[0].id).toBe('proc1');
      expect(result.processes[0].name).toBe('CheckoutProcess');
      expect(result.processes[0].stepCount).toBe(0);
      expect(result.processes[0].steps).toEqual([]);
    } finally { cleanup(); }
  });

  it('returns Process nodes with their steps via STEP_IN_PROCESS edges', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 'proc2', name: 'OrderProcess', label: 'Process' }));
      insertNode(db, makeNode({ id: 'step1', name: 'validateOrder', label: 'Function' }));
      insertNode(db, makeNode({ id: 'step2', name: 'chargePayment', label: 'Function' }));
      insertEdge(db, makeEdge('e1', 'proc2', 'step1', 'STEP_IN_PROCESS'));
      insertEdge(db, makeEdge('e2', 'proc2', 'step2', 'STEP_IN_PROCESS'));

      const result = getProcessesResource(db);
      const proc = result.processes.find((p) => p.id === 'proc2');
      expect(proc).toBeDefined();
      expect(proc!.stepCount).toBe(2);
      expect(proc!.steps.map((s) => s.name).sort()).toEqual(['chargePayment', 'validateOrder']);
    } finally { cleanup(); }
  });

  it('does not include non-STEP_IN_PROCESS edges in steps', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 'proc3', name: 'ShipProcess', label: 'Process' }));
      insertNode(db, makeNode({ id: 'fn2', name: 'sendEmail', label: 'Function' }));
      insertEdge(db, makeEdge('e3', 'proc3', 'fn2', 'CALLS'));

      const result = getProcessesResource(db);
      const proc = result.processes.find((p) => p.id === 'proc3');
      expect(proc!.stepCount).toBe(0);
    } finally { cleanup(); }
  });
});

// ── Communities resource ───────────────────────────────────────────────────────

describe('getCommunitiesResource', () => {
  it('returns empty communities when no nodes have community_id', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 'iso1', name: 'Isolated', label: 'Function' }));
      const result = getCommunitiesResource(db);
      expect(result.communities).toEqual([]);
    } finally { cleanup(); }
  });

  it('groups nodes by community_id', () => {
    const { db, cleanup } = freshDb();
    try {
      const nodeA: MonographNode = { ...makeNode({ id: 'ca1', name: 'Alpha', label: 'Class' }), communityId: 1 };
      const nodeB: MonographNode = { ...makeNode({ id: 'ca2', name: 'Beta', label: 'Function' }), communityId: 1 };
      const nodeC: MonographNode = { ...makeNode({ id: 'ca3', name: 'Gamma', label: 'Class' }), communityId: 2 };
      insertNode(db, nodeA);
      insertNode(db, nodeB);
      insertNode(db, nodeC);

      const result = getCommunitiesResource(db);
      expect(result.communities.length).toBeGreaterThanOrEqual(2);

      const comm1 = result.communities.find((c) => c.id === 1);
      expect(comm1).toBeDefined();
      expect(comm1!.memberCount).toBe(2);
      expect(comm1!.topMembers).toHaveLength(2);

      const comm2 = result.communities.find((c) => c.id === 2);
      expect(comm2).toBeDefined();
      expect(comm2!.memberCount).toBe(1);
    } finally { cleanup(); }
  });

  it('returns at most 5 top members per community', () => {
    const { db, cleanup } = freshDb();
    try {
      for (let i = 0; i < 8; i++) {
        const node: MonographNode = {
          ...makeNode({ id: `bulk${i}`, name: `Node${i}`, label: 'Function' }),
          communityId: 99,
        };
        insertNode(db, node);
      }

      const result = getCommunitiesResource(db);
      const comm = result.communities.find((c) => c.id === 99);
      expect(comm!.memberCount).toBe(8);
      expect(comm!.topMembers.length).toBeLessThanOrEqual(5);
    } finally { cleanup(); }
  });
});

// ── Schema resource ────────────────────────────────────────────────────────────

describe('getSchemaResource', () => {
  it('returns zero totals for empty database', () => {
    const { db, cleanup } = freshDb();
    try {
      const result = getSchemaResource(db);
      expect(result.totalNodes).toBe(0);
      expect(result.totalEdges).toBe(0);
      expect(result.nodeLabels).toEqual([]);
      expect(result.edgeRelations).toEqual([]);
    } finally { cleanup(); }
  });

  it('returns correct node label counts', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 's1', name: 'Cls1', label: 'Class' }));
      insertNode(db, makeNode({ id: 's2', name: 'Fn1', label: 'Function' }));
      insertNode(db, makeNode({ id: 's3', name: 'Fn2', label: 'Function' }));

      const result = getSchemaResource(db);
      expect(result.totalNodes).toBe(3);

      const fnEntry = result.nodeLabels.find((l) => l.label === 'Function');
      expect(fnEntry?.count).toBe(2);

      const clsEntry = result.nodeLabels.find((l) => l.label === 'Class');
      expect(clsEntry?.count).toBe(1);
    } finally { cleanup(); }
  });

  it('returns correct edge relation counts', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 'se1', name: 'A', label: 'Function' }));
      insertNode(db, makeNode({ id: 'se2', name: 'B', label: 'Function' }));
      insertNode(db, makeNode({ id: 'se3', name: 'C', label: 'Function' }));
      insertEdge(db, makeEdge('ee1', 'se1', 'se2', 'CALLS'));
      insertEdge(db, makeEdge('ee2', 'se1', 'se3', 'CALLS'));
      insertEdge(db, makeEdge('ee3', 'se2', 'se3', 'IMPORTS'));

      const result = getSchemaResource(db);
      expect(result.totalEdges).toBe(3);

      const callsEntry = result.edgeRelations.find((r) => r.relation === 'CALLS');
      expect(callsEntry?.count).toBe(2);

      const importsEntry = result.edgeRelations.find((r) => r.relation === 'IMPORTS');
      expect(importsEntry?.count).toBe(1);
    } finally { cleanup(); }
  });
});

// ── Graph resource ─────────────────────────────────────────────────────────────

describe('getGraphResource', () => {
  it('returns empty graph for empty database', () => {
    const { db, cleanup } = freshDb();
    try {
      const result = getGraphResource(db);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.communities).toEqual({});
    } finally { cleanup(); }
  });

  it('returns nodes and edges', () => {
    const { db, cleanup } = freshDb();
    try {
      insertNode(db, makeNode({ id: 'gr1', name: 'Foo', label: 'Function' }));
      insertNode(db, makeNode({ id: 'gr2', name: 'Bar', label: 'Function' }));
      insertEdge(db, makeEdge('ge1', 'gr1', 'gr2', 'CALLS'));

      const result = getGraphResource(db);
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].relation).toBe('CALLS');
    } finally { cleanup(); }
  });

  it('groups nodes into communities map', () => {
    const { db, cleanup } = freshDb();
    try {
      const nodeA: MonographNode = { ...makeNode({ id: 'grc1', name: 'ModA', label: 'Class' }), communityId: 5 };
      const nodeB: MonographNode = { ...makeNode({ id: 'grc2', name: 'ModB', label: 'Class' }), communityId: 5 };
      insertNode(db, nodeA);
      insertNode(db, nodeB);

      const result = getGraphResource(db);
      expect(result.communities['5']).toBeDefined();
      expect(result.communities['5']).toContain('grc1');
      expect(result.communities['5']).toContain('grc2');
    } finally { cleanup(); }
  });
});
