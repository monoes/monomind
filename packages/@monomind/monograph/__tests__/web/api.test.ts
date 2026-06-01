import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { queryGraph, queryNode, querySearch, queryStats } from '../../src/web/api.js';
import { startServer } from '../../src/web/server.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

// ── Shared test DB ────────────────────────────────────────────────────────────

const dbPath = join(tmpdir(), `monograph-web-api-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const nodeA: MonographNode = {
  id: 'web_a',
  label: 'Function',
  name: 'webAlpha',
  normLabel: 'webalpha',
  filePath: 'src/web/a.ts',
  startLine: 1,
  endLine: 10,
  isExported: true,
  communityId: 1,
};

const nodeB: MonographNode = {
  id: 'web_b',
  label: 'Class',
  name: 'WebBeta',
  normLabel: 'webbeta',
  filePath: 'src/web/b.ts',
  startLine: 5,
  endLine: 50,
  isExported: false,
  communityId: 2,
};

const nodeC: MonographNode = {
  id: 'web_c',
  label: 'Function',
  name: 'buildAsync',
  normLabel: 'buildasync',
  filePath: 'src/build.ts',
  startLine: 1,
  endLine: 20,
  isExported: true,
  communityId: 1,
};

const edge: MonographEdge = {
  id: 'web_e_ab',
  sourceId: 'web_a',
  targetId: 'web_b',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, nodeA);
  insertNode(db, nodeB);
  insertNode(db, nodeC);
  insertEdge(db, edge);
});

afterAll(() => {
  closeDb(db);
});

// ── queryGraph ────────────────────────────────────────────────────────────────

describe('queryGraph', () => {
  it('returns nodes array with expected fields', () => {
    const result = queryGraph(db);
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    const a = result.nodes.find((n) => n.id === 'web_a');
    expect(a).toBeDefined();
    expect(a?.name).toBe('webAlpha');
    expect(a?.label).toBe('Function');
  });

  it('returns edges array', () => {
    const result = queryGraph(db);
    const e = result.edges.find(
      (ed) => ed.sourceId === 'web_a' && ed.targetId === 'web_b',
    );
    expect(e).toBeDefined();
    expect(e?.relation).toBe('CALLS');
  });

  it('groups communities by communityId', () => {
    const result = queryGraph(db);
    expect(result.communities['1']).toContain('web_a');
    expect(result.communities['2']).toContain('web_b');
  });
});

// ── queryNode ─────────────────────────────────────────────────────────────────

describe('queryNode', () => {
  it('returns node details for existing id', () => {
    const result = queryNode(db, 'web_b');
    expect(result.node).not.toBeNull();
    expect(result.node?.name).toBe('WebBeta');
  });

  it('returns callers for node b (a calls b)', () => {
    const result = queryNode(db, 'web_b');
    expect(result.callers.some((c) => c.id === 'web_a')).toBe(true);
  });

  it('returns callees for node a (a calls b)', () => {
    const result = queryNode(db, 'web_a');
    expect(result.callees.some((c) => c.id === 'web_b')).toBe(true);
  });

  it('returns null node for unknown id', () => {
    const result = queryNode(db, 'nonexistent');
    expect(result.node).toBeNull();
    expect(result.callers).toHaveLength(0);
  });
});

// ── querySearch ───────────────────────────────────────────────────────────────

describe('querySearch', () => {
  it('returns results for matching query', () => {
    const results = querySearch(db, 'webAlpha');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('webAlpha');
  });

  it('returns empty array for non-matching query', () => {
    const results = querySearch(db, 'zzzunlikelymatch999');
    expect(results).toHaveLength(0);
  });
});

// ── queryStats ────────────────────────────────────────────────────────────────

describe('queryStats', () => {
  it('returns correct node and edge counts', () => {
    const stats = queryStats(db);
    expect(stats.nodeCount).toBeGreaterThanOrEqual(2);
    expect(stats.edgeCount).toBeGreaterThanOrEqual(1);
  });

  it('returns community count', () => {
    const stats = queryStats(db);
    expect(stats.communityCount).toBeGreaterThanOrEqual(2);
  });

  it('returns buildAt (may be null if not built)', () => {
    const stats = queryStats(db);
    // buildAt can be null if index_meta has no indexed_at key
    expect(stats).toHaveProperty('buildAt');
  });
});

// ── startServer / stop ────────────────────────────────────────────────────────

describe('server lifecycle', () => {
  it('starts and stops cleanly on port 0', async () => {
    const handle = await startServer({ port: 0, db });
    expect(handle.url).toMatch(/^http:\/\/localhost:\d+$/);
    await handle.stop();
  });

  it('serves /api/stats endpoint', async () => {
    const handle = await startServer({ port: 0, db });
    try {
      const url = handle.url;
      const res = await fetch(`${url}/api/stats`);
      expect(res.ok).toBe(true);
      const json = await res.json() as { nodeCount: number };
      expect(typeof json.nodeCount).toBe('number');
    } finally {
      await handle.stop();
    }
  });

  it('serves /api/graph endpoint', async () => {
    const handle = await startServer({ port: 0, db });
    try {
      const res = await fetch(`${handle.url}/api/graph`);
      expect(res.ok).toBe(true);
      const json = await res.json() as { nodes: unknown[]; edges: unknown[]; communities: unknown };
      expect(Array.isArray(json.nodes)).toBe(true);
      expect(Array.isArray(json.edges)).toBe(true);
    } finally {
      await handle.stop();
    }
  });

  it('serves /api/search?q=build returns ≥1 result', async () => {
    const handle = await startServer({ port: 0, db });
    try {
      const res = await fetch(`${handle.url}/api/search?q=build`);
      expect(res.ok).toBe(true);
      const json = await res.json() as unknown[];
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  });
});
