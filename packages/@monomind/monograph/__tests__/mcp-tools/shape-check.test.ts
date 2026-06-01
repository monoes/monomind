import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getShapeCheck } from '../../src/mcp-tools/shape-check.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dbPath = join(tmpdir(), `monograph-shape-check-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;
let repoPath: string;

const ROUTE_FILE = 'api/users.ts';
const HANDLER_FILE = 'api/users.ts';
const CONSUMER_FILE = 'client/fetchUsers.ts';

const routeNode: MonographNode = {
  id: 'route_users',
  label: 'Route',
  name: 'GET /api/users',
  normLabel: 'get /api/users',
  filePath: ROUTE_FILE,
  startLine: 1,
  isExported: false,
};

const handlerNode: MonographNode = {
  id: 'fn_get_users',
  label: 'Function',
  name: 'getUsers',
  normLabel: 'getusers',
  filePath: HANDLER_FILE,
  startLine: 5,
  isExported: true,
};

const consumerNode: MonographNode = {
  id: 'fn_fetch_users',
  label: 'Function',
  name: 'fetchUsers',
  normLabel: 'fetchusers',
  filePath: CONSUMER_FILE,
  startLine: 3,
  isExported: true,
};

const handlesRouteEdge: MonographEdge = {
  id: 'e_handles_route',
  sourceId: 'route_users',
  targetId: 'fn_get_users',
  relation: 'HANDLES_ROUTE',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

const callsEdge: MonographEdge = {
  id: 'e_calls_handler',
  sourceId: 'fn_fetch_users',
  targetId: 'fn_get_users',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 0.9,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  db = openDb(dbPath);

  // Create a temp repo directory with source files
  repoPath = mkdtempSync(join(tmpdir(), 'shape-check-repo-'));

  // Ensure api/ and client/ directories exist within the temp repo
  const { mkdirSync } = require('fs');
  mkdirSync(join(repoPath, 'api'), { recursive: true });
  mkdirSync(join(repoPath, 'client'), { recursive: true });

  // Handler returns { id, name, email }
  writeFileSync(
    join(repoPath, HANDLER_FILE),
    `
export function getUsers(req, res) {
  const users = db.query('SELECT * FROM users');
  return res.json({ id: users[0].id, name: users[0].name, email: users[0].email });
}
`,
  );

  // Consumer accesses { id, name }
  writeFileSync(
    join(repoPath, CONSUMER_FILE),
    `
export async function fetchUsers() {
  const data = await fetch('/api/users').then(r => r.json());
  console.log(data.id, data.name);
}
`,
  );

  // Insert graph nodes and edges
  insertNode(db, routeNode);
  insertNode(db, handlerNode);
  insertNode(db, consumerNode);
  insertEdge(db, handlesRouteEdge);
  insertEdge(db, callsEdge);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
  rmSync(repoPath, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getShapeCheck', () => {
  it('finds the route and handler by route path substring', () => {
    const result = getShapeCheck(db, repoPath, { route: '/api/users' });
    expect(result.route).not.toBeNull();
    expect(result.route!.path).toBe('/api/users');
    expect(result.route!.method).toBe('GET');
    expect(result.route!.handlerName).toBe('getUsers');
    expect(result.route!.handlerFile).toBe(HANDLER_FILE);
  });

  it('extracts returned keys from handler source', () => {
    const result = getShapeCheck(db, repoPath, { route: '/api/users' });
    expect(result.shape.returnedKeys).toEqual(['email', 'id', 'name']);
  });

  it('extracts accessed keys from consumer source', () => {
    const result = getShapeCheck(db, repoPath, { route: '/api/users' });
    // Consumer accesses data.id and data.name
    expect(result.shape.accessedKeys).toEqual(expect.arrayContaining(['id', 'name']));
  });

  it('lists consumers', () => {
    const result = getShapeCheck(db, repoPath, { route: '/api/users' });
    expect(result.consumers).toHaveLength(1);
    expect(result.consumers[0].name).toBe('fetchUsers');
    expect(result.consumers[0].filePath).toBe(CONSUMER_FILE);
  });

  it('returns MATCH when accessed keys are subset of returned keys', () => {
    const result = getShapeCheck(db, repoPath, { route: '/api/users' });
    // handler returns id, name, email; consumer accesses id, name → MATCH
    expect(result.shape.status).toBe('MATCH');
    expect(result.shape.mismatches).toHaveLength(0);
  });

  it('returns null route when route not found', () => {
    const result = getShapeCheck(db, repoPath, { route: '/nonexistent' });
    expect(result.route).toBeNull();
    expect(result.message).toBe('Route not found');
    expect(result.shape.status).toBe('UNKNOWN');
  });

  it('handles missing source file gracefully (UNKNOWN status)', () => {
    // Insert a route+handler that points to a non-existent file
    const ghostRouteNode: MonographNode = {
      id: 'route_ghost',
      label: 'Route',
      name: 'POST /api/ghost',
      normLabel: 'post /api/ghost',
      filePath: 'api/ghost.ts',
      startLine: 1,
      isExported: false,
    };
    const ghostHandlerNode: MonographNode = {
      id: 'fn_ghost_handler',
      label: 'Function',
      name: 'ghostHandler',
      normLabel: 'ghosthandler',
      filePath: 'api/nonexistent-file-that-does-not-exist.ts',
      startLine: 1,
      isExported: true,
    };
    const ghostEdge: MonographEdge = {
      id: 'e_ghost_handles',
      sourceId: 'route_ghost',
      targetId: 'fn_ghost_handler',
      relation: 'HANDLES_ROUTE',
      confidence: 'EXTRACTED',
      confidenceScore: 1.0,
    };

    insertNode(db, ghostRouteNode);
    insertNode(db, ghostHandlerNode);
    insertEdge(db, ghostEdge);

    const result = getShapeCheck(db, repoPath, { route: '/api/ghost' });
    expect(result.route).not.toBeNull();
    // File doesn't exist → no return keys extracted → UNKNOWN
    expect(result.shape.status).toBe('UNKNOWN');
  });
});
