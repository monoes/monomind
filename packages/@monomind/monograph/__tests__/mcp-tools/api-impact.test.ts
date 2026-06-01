import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getMonographApiImpact } from '../../src/mcp-tools/api-impact.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

/**
 * Graph:
 *   Route "ANY /api/users"
 *     └─ HANDLES_ROUTE → handler "getUsersHandler"
 *          └─ CALLS → "fetchUsersFromDb"
 *               └─ CALLS → "runQuery"
 *
 *   Route "GET /health" (no handler, no callees)
 */

const dbPath = join(tmpdir(), `monograph-api-impact-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const routeApiUsers: MonographNode = {
  id: 'ai_route_api_users',
  label: 'Route',
  name: 'ANY /api/users',
  normLabel: 'any /api/users',
  filePath: 'pages/api/users.ts',
  startLine: 0,
  isExported: false,
};

const routeHealth: MonographNode = {
  id: 'ai_route_health',
  label: 'Route',
  name: 'GET /health',
  normLabel: 'get /health',
  filePath: 'pages/health.ts',
  startLine: 0,
  isExported: false,
};

const handler: MonographNode = {
  id: 'ai_fn_handler',
  label: 'Function',
  name: 'getUsersHandler',
  normLabel: 'getusershandler',
  filePath: 'pages/api/users.ts',
  startLine: 10,
  isExported: true,
};

const fetchFn: MonographNode = {
  id: 'ai_fn_fetch',
  label: 'Function',
  name: 'fetchUsersFromDb',
  normLabel: 'fetchusersfromdb',
  filePath: 'src/db/users.ts',
  startLine: 20,
  isExported: false,
};

const queryFn: MonographNode = {
  id: 'ai_fn_query',
  label: 'Function',
  name: 'runQuery',
  normLabel: 'runquery',
  filePath: 'src/db/query.ts',
  startLine: 5,
  isExported: false,
};

const edgeHandlesRoute: MonographEdge = {
  id: 'ai_e_handles_route',
  sourceId: 'ai_route_api_users',
  targetId: 'ai_fn_handler',
  relation: 'HANDLES_ROUTE',
  confidence: 'EXTRACTED',
  confidenceScore: 0.9,
};

const edgeHandlerCallsFetch: MonographEdge = {
  id: 'ai_e_handler_fetch',
  sourceId: 'ai_fn_handler',
  targetId: 'ai_fn_fetch',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

const edgeFetchCallsQuery: MonographEdge = {
  id: 'ai_e_fetch_query',
  sourceId: 'ai_fn_fetch',
  targetId: 'ai_fn_query',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, routeApiUsers);
  insertNode(db, routeHealth);
  insertNode(db, handler);
  insertNode(db, fetchFn);
  insertNode(db, queryFn);
  insertEdge(db, edgeHandlesRoute);
  insertEdge(db, edgeHandlerCallsFetch);
  insertEdge(db, edgeFetchCallsQuery);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

describe('getMonographApiImpact', () => {
  it('returns null route for unknown path', () => {
    const result = getMonographApiImpact(db, { routePath: '/nonexistent' });
    expect(result.route).toBeNull();
    expect(result.handler).toBeNull();
    expect(result.callees).toHaveLength(0);
    expect(result.riskScore).toBe(0);
  });

  it('finds route for /api/users', () => {
    const result = getMonographApiImpact(db, { routePath: '/api/users' });
    expect(result.route).not.toBeNull();
    expect(result.route!.path).toBe('/api/users');
    expect(result.route!.nodeId).toBe('ai_route_api_users');
  });

  it('returns handler node for the route', () => {
    const result = getMonographApiImpact(db, { routePath: '/api/users' });
    expect(result.handler).not.toBeNull();
    expect(result.handler!.name).toBe('getUsersHandler');
    expect(result.handler!.id).toBe('ai_fn_handler');
  });

  it('callees array contains the directly called function', () => {
    const result = getMonographApiImpact(db, { routePath: '/api/users' });
    expect(result.callees.length).toBeGreaterThan(0);
    const fetchCallee = result.callees.find((c) => c.node.id === 'ai_fn_fetch');
    expect(fetchCallee).toBeDefined();
    expect(fetchCallee!.depth).toBe(1);
  });

  it('callees array contains transitively called function', () => {
    const result = getMonographApiImpact(db, { routePath: '/api/users' });
    const queryCallee = result.callees.find((c) => c.node.id === 'ai_fn_query');
    expect(queryCallee).toBeDefined();
    expect(queryCallee!.depth).toBe(2);
  });

  it('riskScore is greater than 0 when callees exist', () => {
    const result = getMonographApiImpact(db, { routePath: '/api/users' });
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it('riskScore is capped at 10', () => {
    const result = getMonographApiImpact(db, { routePath: '/api/users' });
    expect(result.riskScore).toBeLessThanOrEqual(10);
  });

  it('route with no handler returns handler null but route set', () => {
    const result = getMonographApiImpact(db, { routePath: '/health' });
    expect(result.route).not.toBeNull();
    expect(result.route!.path).toBe('/health');
    expect(result.handler).toBeNull();
    expect(result.callees).toHaveLength(0);
  });

  it('method filter narrows results correctly', () => {
    // Route is "ANY /api/users" — filtering by GET should still match since ANY is not GET
    // But there's no GET /api/users route, so result.route should be null when strict method is used
    // The implementation falls back to all matches if filtered list is empty
    const result = getMonographApiImpact(db, { routePath: '/health', method: 'GET' });
    expect(result.route).not.toBeNull();
    expect(result.route!.method).toBe('GET');
  });

  it('affectedProcesses is an array (may be empty if no STEP_IN_PROCESS edges)', () => {
    const result = getMonographApiImpact(db, { routePath: '/api/users' });
    expect(Array.isArray(result.affectedProcesses)).toBe(true);
  });
});
