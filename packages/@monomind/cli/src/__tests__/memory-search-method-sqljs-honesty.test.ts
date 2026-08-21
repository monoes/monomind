// packages/@monomind/cli/src/__tests__/memory-search-method-sqljs-honesty.test.ts
//
// Companion to memory-search-method-honesty.test.ts, which covers the SQLite
// *bridge*. This file covers the path that runs when the bridge is
// unavailable and searchEntries() falls through to raw sql.js: brute-force
// cosine + keyword-overlap scan. (A separate mocked "HNSW index path" used
// to be covered here too, but it queried a `.swarm/memory.db` that nothing
// wrote to post-rename and was removed — see hnsw-operations.ts's module
// docstring. The real ANN fast path now lives inside the SQLite bridge's
// backend, exercised by memory-search-method-honesty.test.ts and
// ann-search.test.ts in @monoes/memory, not this legacy fallback.)
//
// generateEmbedding() silently degrades to generateHashEmbedding()
// ("hash-fallback") when no ONNX model can be loaded. A cosine over those
// hashes is a deterministic lexical trick with no semantic content, so this
// path may not report "hybrid" in that state.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Flipped per test: does generateEmbedding return a real model vector or the hash fallback? */
let embedModel: 'onnx' | 'hash-fallback' = 'onnx';

const DIM = 8;
function vec(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % DIM] += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / n);
}

// Force the "bridge unavailable" branch of memory-read.getBridge().
vi.mock('../memory/memory-bridge.js', () => ({
  bridgeSearchEntries: async () => null,
  safeParseEmbedding: (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : null;
    } catch { return null; }
  },
}));

vi.mock('../memory/memory-migrations.js', () => ({
  ensureSchemaColumns: async () => ({ success: true }),
}));

vi.mock('../memory/embedding-operations.js', () => ({
  generateEmbedding: async (text: string) => ({
    embedding: vec(text),
    dimensions: DIM,
    model: embedModel,
  }),
}));

import { searchEntries } from '../memory/memory-read.js';

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'mm-sqljs-method-'));
const DB_PATH = join(FIXTURE_DIR, 'memory.db');

describe('sql.js fallback paths report the method that actually ran', () => {
  beforeAll(async () => {
    // A real sql.js database so the brute-force branch has something to scan.
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT,
      embedding TEXT, status TEXT
    )`);
    db.run(
      `INSERT INTO memory_entries VALUES (?, ?, ?, ?, ?, 'active')`,
      ['id-jwt-auth-0001', 'jwt-auth', 'ns', 'JWT refresh token rotation', JSON.stringify(vec('JWT refresh token rotation'))]
    );
    writeFileSync(DB_PATH, Buffer.from(db.export()));
    db.close();
  }, 60_000);

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    embedModel = 'onnx';
  });

  it('brute-force path reports "hybrid" with a real model', async () => {
    const res = await searchEntries({ query: 'jwt refresh', namespace: 'ns', dbPath: DB_PATH, threshold: 0.1 });
    expect(res.success).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.searchMethod).toBe('hybrid');
    expect(res.fallbackReason).toBeUndefined();
  }, 60_000);

  it('brute-force path does NOT claim "hybrid" cosine when the vectors are hash fallbacks', async () => {
    embedModel = 'hash-fallback';
    const res = await searchEntries({ query: 'jwt refresh', namespace: 'ns', dbPath: DB_PATH, threshold: 0.1 });
    expect(res.success).toBe(true);
    expect(res.searchMethod).not.toBe('hybrid');
    expect(res.searchMethod).toBe('hash-hybrid');
    expect(res.fallbackReason).toBe('no-embedding-model');
  }, 60_000);
});
