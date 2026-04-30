import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getMonographRouteMap } from '../../src/mcp-tools/route-map.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

/**
 * Graph:
 *   Route node: "ANY /api/users"  → HANDLES_ROUTE → handler function "getUsers"
 *   Route node: "GET /health"     (no handler)
 */

const dbPath = join(tmpdir(), `monograph-route-map-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const routeApiUsers: MonographNode = {
  id: 'route_api_users',
  label: 'Route',
  name: 'ANY /api/users',
  normLabel: 'any /api/users',
  filePath: 'pages/api/users.ts',
  startLine: 0,
  isExported: false,
};

const routeHealth: MonographNode = {
  id: 'route_health',
  label: 'Route',
  name: 'GET /health',
  normLabel: 'get /health',
  filePath: 'pages/health.ts',
  startLine: 0,
  isExported: false,
};

const handlerGetUsers: MonographNode = {
  id: 'fn_get_users',
  label: 'Function',
  name: 'getUsers',
  normLabel: 'getusers',
  filePath: 'pages/api/users.ts',
  startLine: 5,
  isExported: true,
};

const handlesRouteEdge: MonographEdge = {
  id: 'e_route_handler',
  sourceId: 'route_api_users',
  targetId: 'fn_get_users',
  relation: 'HANDLES_ROUTE',
  confidence: 'EXTRACTED',
  confidenceScore: 0.9,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, routeApiUsers);
  insertNode(db, routeHealth);
  insertNode(db, handlerGetUsers);
  insertEdge(db, handlesRouteEdge);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

describe('getMonographRouteMap', () => {
  it('returns all routes when no filter is given', () => {
    const result = getMonographRouteMap(db, {});
    expect(result.total).toBe(2);
    expect(result.routes).toHaveLength(2);
  });

  it('routes array contains route with path /api/users', () => {
    const result = getMonographRouteMap(db, {});
    const userRoute = result.routes.find((r) => r.path === '/api/users');
    expect(userRoute).toBeDefined();
    expect(userRoute!.routeNodeId).toBe('route_api_users');
  });

  it('attaches handler info when HANDLES_ROUTE edge exists', () => {
    const result = getMonographRouteMap(db, {});
    const userRoute = result.routes.find((r) => r.path === '/api/users');
    expect(userRoute).toBeDefined();
    expect(userRoute!.handlerName).toBe('getUsers');
    expect(userRoute!.handlerFile).toBe('pages/api/users.ts');
    expect(userRoute!.handlerLine).toBe(5);
  });

  it('handlerName is null for routes without a handler', () => {
    const result = getMonographRouteMap(db, {});
    const healthRoute = result.routes.find((r) => r.path === '/health');
    expect(healthRoute).toBeDefined();
    expect(healthRoute!.handlerName).toBeNull();
  });

  it('prefix filter /api returns only API routes', () => {
    const result = getMonographRouteMap(db, { prefix: '/api' });
    expect(result.total).toBe(1);
    expect(result.routes[0].path).toBe('/api/users');
  });

  it('prefix filter /health returns only health route', () => {
    const result = getMonographRouteMap(db, { prefix: '/health' });
    expect(result.total).toBe(1);
    expect(result.routes[0].path).toBe('/health');
  });

  it('prefix filter with no match returns empty', () => {
    const result = getMonographRouteMap(db, { prefix: '/nonexistent' });
    expect(result.total).toBe(0);
    expect(result.routes).toHaveLength(0);
  });

  it('method filter GET returns GET routes (and ANY routes since ANY handles all methods)', () => {
    const result = getMonographRouteMap(db, { method: 'GET' });
    // "GET /health" matches strictly; "ANY /api/users" also matches since ANY includes GET
    expect(result.total).toBeGreaterThanOrEqual(1);
    const paths = result.routes.map((r) => r.path);
    expect(paths).toContain('/health');
  });

  it('method filter POST returns routes with POST or ANY method', () => {
    const result = getMonographRouteMap(db, { method: 'POST' });
    // "ANY /api/users" should match POST since ANY handles any method
    const paths = result.routes.map((r) => r.path);
    expect(paths).toContain('/api/users');
  });

  it('total matches routes array length', () => {
    const result = getMonographRouteMap(db, {});
    expect(result.total).toBe(result.routes.length);
  });
});
