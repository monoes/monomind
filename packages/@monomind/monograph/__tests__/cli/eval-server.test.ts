import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createEvalServer } from '../../src/cli/eval-server.js';
import { openDb, closeDb } from '../../src/storage/db.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monograph-eval-'));
  const monographDir = path.join(dir, '.monograph');
  fs.mkdirSync(monographDir, { recursive: true });

  // Create a minimal valid monograph DB
  const db = openDb(path.join(monographDir, 'graph.db'));
  closeDb(db);

  return dir;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createEvalServer', () => {
  let repoDir: string;
  let port: number;
  let baseUrl: string;
  let handle: ReturnType<typeof createEvalServer>;

  beforeAll(async () => {
    repoDir = makeTempRepo();
    port = 47820; // unlikely to be in use
    handle = createEvalServer(repoDir, port);
    await handle.start(port);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    handle.stop();
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns an object with app, start, and stop', () => {
    expect(handle).toHaveProperty('app');
    expect(typeof handle.start).toBe('function');
    expect(typeof handle.stop).toBe('function');
  });

  it('app is an Express application', () => {
    // Express apps are functions with a `listen` method
    expect(typeof handle.app).toBe('function');
    expect(typeof (handle.app as any).listen).toBe('function');
  });

  it('GET /health returns { status: "ok" } with nodeCount and edgeCount', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(typeof body['nodeCount']).toBe('number');
    expect(typeof body['edgeCount']).toBe('number');
  });

  it('POST /query with { q: "test" } returns { results: [] } on empty DB', async () => {
    const res = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'test' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body['results'])).toBe(true);
    expect((body['results'] as unknown[]).length).toBe(0);
  });

  it('POST /search with { query: "test" } returns { results: [] } on empty DB', async () => {
    const res = await fetch(`${baseUrl}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body['results'])).toBe(true);
    expect((body['results'] as unknown[]).length).toBe(0);
  });
});
