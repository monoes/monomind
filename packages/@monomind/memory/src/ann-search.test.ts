/**
 * SqlBackend's size-gated ANN (HNSW) fast path inside search().
 *
 * Below MONOMIND_HNSW_THRESHOLD active embedded entries, search() stays on
 * brute-force cosine (existing, already-tested behavior). Above it, an HNSW
 * graph is built once, cached in-memory for the life of the backend, and
 * persisted to disk next to the SQLite file so a second process avoids the
 * rebuild entirely. MONOMIND_HNSW_THRESHOLD is read once at module load, so
 * each test that needs a specific threshold sets the env var and then
 * resets the module registry before importing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SqlBackend ANN (HNSW) fast path', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ann-search-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.MONOMIND_HNSW_THRESHOLD;
    vi.restoreAllMocks();
  });

  function makeEmbedding(seed: number, dim = 16): Float32Array {
    const emb = new Float32Array(dim);
    for (let i = 0; i < dim; i++) emb[i] = Math.sin(seed * 7 + i) * 0.5;
    return emb;
  }

  async function seedEntries(backend: import('./sqlite-backend.js').SQLiteBackend, count: number) {
    const { createDefaultEntry } = await import('./types.js');
    for (let i = 0; i < count; i++) {
      const e = createDefaultEntry({ key: `k${i}`, content: `entry ${i}` });
      e.embedding = makeEmbedding(i);
      await backend.store(e);
    }
  }

  it('above the threshold, search() finds the matching entry via the ANN path and persists a cache file', async () => {
    process.env.MONOMIND_HNSW_THRESHOLD = '3';
    vi.resetModules();
    const { SQLiteBackend } = await import('./sqlite-backend.js');

    const backend = new SQLiteBackend({ databasePath: dbPath, walMode: false });
    await backend.initialize();
    await seedEntries(backend, 5);

    const results = await backend.search(makeEmbedding(2), { k: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].entry.key).toBe('k2');
    expect(results[0].score).toBeGreaterThan(0.99);

    expect(existsSync(join(dir, 'hnsw-index.json'))).toBe(true);
    await backend.shutdown();
  });

  it('below the threshold, no cache file is written and brute force is used', async () => {
    process.env.MONOMIND_HNSW_THRESHOLD = '1000';
    vi.resetModules();
    const { SQLiteBackend } = await import('./sqlite-backend.js');

    const backend = new SQLiteBackend({ databasePath: dbPath, walMode: false });
    await backend.initialize();
    await seedEntries(backend, 5);

    const results = await backend.search(makeEmbedding(2), { k: 1 });
    expect(results[0].entry.key).toBe('k2');
    expect(existsSync(join(dir, 'hnsw-index.json'))).toBe(false);
    await backend.shutdown();
  });

  it('a fresh backend instance loads the persisted graph instead of rebuilding', async () => {
    process.env.MONOMIND_HNSW_THRESHOLD = '3';
    vi.resetModules();
    const { SQLiteBackend } = await import('./sqlite-backend.js');
    const { HNSWIndex } = await import('./hnsw-index.js');

    const backend1 = new SQLiteBackend({ databasePath: dbPath, walMode: false });
    await backend1.initialize();
    await seedEntries(backend1, 5);
    await backend1.search(makeEmbedding(0), { k: 1 }); // builds the graph and writes the cache
    await backend1.shutdown();

    const rebuildSpy = vi.spyOn(HNSWIndex.prototype, 'rebuild');
    const backend2 = new SQLiteBackend({ databasePath: dbPath, walMode: false });
    await backend2.initialize();
    const results = await backend2.search(makeEmbedding(2), { k: 1 });

    expect(results[0].entry.key).toBe('k2');
    expect(rebuildSpy).not.toHaveBeenCalled();
    await backend2.shutdown();
  });

  it('rebuilds (and re-persists) when the entry count changes, invalidating the cache', async () => {
    process.env.MONOMIND_HNSW_THRESHOLD = '3';
    vi.resetModules();
    const { SQLiteBackend } = await import('./sqlite-backend.js');
    const { createDefaultEntry } = await import('./types.js');
    const { HNSWIndex } = await import('./hnsw-index.js');

    const backend = new SQLiteBackend({ databasePath: dbPath, walMode: false });
    await backend.initialize();
    await seedEntries(backend, 5);
    await backend.search(makeEmbedding(0), { k: 1 }); // first build

    const extra = createDefaultEntry({ key: 'k5', content: 'entry 5' });
    extra.embedding = makeEmbedding(5);
    await backend.store(extra);

    const rebuildSpy = vi.spyOn(HNSWIndex.prototype, 'rebuild');
    const results = await backend.search(makeEmbedding(5), { k: 1 });
    expect(results[0].entry.key).toBe('k5');
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    await backend.shutdown();
  });

  it('does not persist to disk for an in-memory database', async () => {
    process.env.MONOMIND_HNSW_THRESHOLD = '3';
    vi.resetModules();
    const { SQLiteBackend } = await import('./sqlite-backend.js');

    const backend = new SQLiteBackend({ databasePath: ':memory:', walMode: false });
    await backend.initialize();
    await seedEntries(backend, 5);

    const results = await backend.search(makeEmbedding(2), { k: 1 });
    expect(results[0].entry.key).toBe('k2');
    // No stable directory to cache next to — nothing should be written anywhere in dir.
    expect(existsSync(join(dir, 'hnsw-index.json'))).toBe(false);
    await backend.shutdown();
  });

  it('namespace and threshold filtering still apply on the ANN path', async () => {
    process.env.MONOMIND_HNSW_THRESHOLD = '3';
    vi.resetModules();
    const { SQLiteBackend } = await import('./sqlite-backend.js');
    const { createDefaultEntry } = await import('./types.js');

    const backend = new SQLiteBackend({ databasePath: dbPath, walMode: false });
    await backend.initialize();
    for (let i = 0; i < 5; i++) {
      const e = createDefaultEntry({ key: `k${i}`, content: `entry ${i}`, namespace: i % 2 === 0 ? 'even' : 'odd' });
      e.embedding = makeEmbedding(i);
      await backend.store(e);
    }

    const results = await backend.search(makeEmbedding(2), { k: 5, filters: { type: 'semantic', namespace: 'odd' } });
    expect(results.every(r => r.entry.namespace === 'odd')).toBe(true);
    await backend.shutdown();
  });
});
