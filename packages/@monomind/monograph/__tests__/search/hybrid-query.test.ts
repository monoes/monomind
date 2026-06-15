import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { upsertEmbedding, ensureEmbeddingSchema } from '../../src/storage/embedding-store.js';
import { hybridQuery } from '../../src/search/hybrid-query.js';
import type { MonographNode } from '../../src/types.js';

const dbPath = join(tmpdir(), `monograph-hybrid-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

// Deterministic 384-dim vectors (not meaningful but unique per node)
function makeVec(seed: number): Float32Array {
  const v = new Float32Array(384);
  // Fill with a pattern so cosine similarity with seed=0 favours index 0
  v[seed % 384] = 1.0; // sparse one-hot–ish (not normalised but fine for mocking)
  // L2-normalise
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// Fake embedder that always returns the same "query" vector (seed 0)
const fakeEmbedder = async (_text: string | string[]) => ({
  data: makeVec(0),
});

const nodes: MonographNode[] = [
  { id: 'n1', label: 'Function', name: 'authenticate', normLabel: 'authenticate', filePath: 'src/auth.ts', startLine: 1, isExported: true },
  { id: 'n2', label: 'Function', name: 'authorise', normLabel: 'authorise', filePath: 'src/auth.ts', startLine: 10, isExported: true },
  { id: 'n3', label: 'Class', name: 'UserService', normLabel: 'userservice', filePath: 'src/user.ts', startLine: 1, isExported: true },
];

beforeAll(() => {
  db = openDb(dbPath);
  for (const node of nodes) insertNode(db, node);
  // Ensure content_hash column exists before calling upsertEmbedding
  ensureEmbeddingSchema(db);
  // Store embeddings (n1 gets seed=0, others get different seeds)
  upsertEmbedding(db, 'n1', makeVec(0));
  upsertEmbedding(db, 'n2', makeVec(1));
  upsertEmbedding(db, 'n3', makeVec(2));
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

describe('hybridQuery', () => {
  it('falls back to BM25 when embedder is not provided and env not set', async () => {
    const results = await hybridQuery(db, 'authenticate');
    // Without embedder, we still get BM25 results
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.id === 'n1')).toBe(true);
  });

  it('uses hybrid ranking when an explicit embedder is passed', async () => {
    const results = await hybridQuery(db, 'authenticate', { embedder: fakeEmbedder as never });
    expect(results.length).toBeGreaterThan(0);
    // n1 has the same vector as the fake query (seed 0) so it should score well
    expect(results.some((r) => r.id === 'n1')).toBe(true);
  });

  it('returns at most `limit` results', async () => {
    const results = await hybridQuery(db, 'auth', { limit: 1, embedder: fakeEmbedder as never });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns HybridResult objects with required fields', async () => {
    const results = await hybridQuery(db, 'authenticate', { embedder: fakeEmbedder as never });
    for (const r of results) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('score');
    }
  });

  it('returns empty array for a query with no matches', async () => {
    const results = await hybridQuery(db, 'zzznonexistentzzzxxx');
    expect(results).toEqual([]);
  });

  it('respects label filter', async () => {
    const results = await hybridQuery(db, 'auth', { label: 'Class' });
    for (const r of results) {
      expect(r.label).toBe('Class');
    }
  });

  it('scores are numeric', async () => {
    const results = await hybridQuery(db, 'authenticate', { embedder: fakeEmbedder as never });
    for (const r of results) {
      expect(typeof r.score).toBe('number');
      expect(isNaN(r.score)).toBe(false);
    }
  });
});
