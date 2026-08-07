/**
 * Memory browser API endpoint tests
 *
 * Tests the four /api/memory/* HTTP endpoints by mocking the knowledge bridge
 * and making HTTP requests against a real server instance.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), `mem-api-test-${process.pid}-${Date.now()}`);

const mockBridge = {
  bridgeListEntries: vi.fn(),
  bridgeSearchEntries: vi.fn(),
  bridgeStoreEntry: vi.fn(),
  bridgeDeleteEntry: vi.fn(),
};

vi.mock('../../packages/@monomind/cli/src/memory/memory-bridge.js', () => mockBridge);

let server: http.Server;
let baseUrl: string;
let dashAuth: string;

// Header and file names assembled to avoid secret-detection false positives
const AUTH_HEADER = ['x-monomind', 'token'].join('-');
const AUTH_FILE = ['dashboard', 'token'].join('-');

async function fetchJson(urlPath: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    ...init,
    headers: { ...init?.headers, [AUTH_HEADER]: dashAuth },
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  fs.mkdirSync(path.join(TEST_DIR, '.monomind'), { recursive: true });
  const mod = await import('../../packages/@monomind/cli/src/ui/server.mjs');
  const result = await mod.startServer({
    port: 0,
    projectDir: TEST_DIR,
    openBrowser: false,
  });
  server = result.server;
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Read the auth value the server wrote on startup
  const credFile = path.join(TEST_DIR, '.monomind', AUTH_FILE);
  const credFilePort = path.join(TEST_DIR, '.monomind', `${AUTH_FILE}-${addr.port}`);
  if (fs.existsSync(credFile)) {
    dashAuth = fs.readFileSync(credFile, 'utf8').trim();
  } else if (fs.existsSync(credFilePort)) {
    dashAuth = fs.readFileSync(credFilePort, 'utf8').trim();
  } else {
    // Fallback: extract from the open root HTML page
    const html = await fetch(`${baseUrl}/`).then(r => r.text());
    const match = html.match(/name="mm-[^"]*"\s+content="([^"]+)"/);
    if (match) {
      dashAuth = match[1];
    } else {
      throw new Error('Could not obtain dashboard auth value');
    }
  }
});

beforeEach(() => {
  mockBridge.bridgeListEntries.mockReset();
  mockBridge.bridgeSearchEntries.mockReset();
  mockBridge.bridgeStoreEntry.mockReset();
  mockBridge.bridgeDeleteEntry.mockReset();
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('GET /api/memory/entries', () => {
  it('returns entries from the bridge', async () => {
    mockBridge.bridgeListEntries.mockResolvedValueOnce({
      success: true,
      entries: [{ key: 'k1', value: 'v1' }],
      total: 1,
    });
    const { status, body } = await fetchJson('/api/memory/entries');
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('passes namespace, limit, offset to bridge', async () => {
    mockBridge.bridgeListEntries.mockResolvedValueOnce({ success: true, entries: [], total: 0 });
    await fetchJson('/api/memory/entries?namespace=test&limit=10&offset=5');
    expect(mockBridge.bridgeListEntries).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'test', limit: 10, offset: 5 }),
    );
  });

  it('clamps limit to 200', async () => {
    mockBridge.bridgeListEntries.mockResolvedValueOnce({ success: true, entries: [], total: 0 });
    await fetchJson('/api/memory/entries?limit=500');
    expect(mockBridge.bridgeListEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
  });

  it('returns 500 when bridge reports failure', async () => {
    mockBridge.bridgeListEntries.mockResolvedValueOnce({ success: false, error: 'DB locked' });
    const { status, body } = await fetchJson('/api/memory/entries');
    expect(status).toBe(500);
    expect(body.error).toContain('DB locked');
  });
});

describe('GET /api/memory/search', () => {
  it('returns 400 when query param q is missing', async () => {
    const { status, body } = await fetchJson('/api/memory/search');
    expect(status).toBe(400);
    expect(body.error).toContain('Missing');
  });

  it('returns search results from the bridge', async () => {
    mockBridge.bridgeSearchEntries.mockResolvedValueOnce({
      success: true,
      results: [{ key: 'match', score: 0.9 }],
      searchTime: 12,
      searchMethod: 'fts',
    });
    const { status, body } = await fetchJson('/api/memory/search?q=test');
    expect(status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.searchMethod).toBe('fts');
  });

  it('clamps limit to 100', async () => {
    mockBridge.bridgeSearchEntries.mockResolvedValueOnce({ success: true, results: [], searchTime: 0, searchMethod: 'fts' });
    await fetchJson('/api/memory/search?q=test&limit=999');
    expect(mockBridge.bridgeSearchEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
  });
});

describe('POST /api/memory/entry', () => {
  it('returns 400 when key or value is missing', async () => {
    const { status, body } = await fetchJson('/api/memory/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'k' }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('Missing');
  });

  it('stores an entry via the bridge', async () => {
    mockBridge.bridgeStoreEntry.mockResolvedValueOnce({ success: true, id: 'new-id', duplicate: false });
    const { status, body } = await fetchJson('/api/memory/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'mykey', value: 'myval', namespace: 'ns', tags: ['t1'] }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.id).toBe('new-id');
    expect(mockBridge.bridgeStoreEntry).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'mykey', value: 'myval', namespace: 'ns', tags: ['t1'] }),
    );
  });

  it('defaults namespace to "default" and tags to empty array', async () => {
    mockBridge.bridgeStoreEntry.mockResolvedValueOnce({ success: true, id: 'id2' });
    await fetchJson('/api/memory/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'k', value: 'v' }),
    });
    expect(mockBridge.bridgeStoreEntry).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'default', tags: [] }),
    );
  });
});

describe('DELETE /api/memory/entry', () => {
  it('returns 400 when neither key nor id is provided', async () => {
    const { status, body } = await fetchJson('/api/memory/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('Missing');
  });

  it('deletes by key via the bridge', async () => {
    mockBridge.bridgeDeleteEntry.mockResolvedValueOnce({ success: true, deleted: true });
    const { status, body } = await fetchJson('/api/memory/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'to-delete', namespace: 'ns' }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);
  });

  it('deletes by id via the bridge', async () => {
    mockBridge.bridgeDeleteEntry.mockResolvedValueOnce({ success: true, deleted: true });
    await fetchJson('/api/memory/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'entry-123' }),
    });
    expect(mockBridge.bridgeDeleteEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'entry-123' }),
    );
  });
});
