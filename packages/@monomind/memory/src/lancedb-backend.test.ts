/**
 * Tests for LanceDBBackend's read-through cache (CacheManager wiring).
 *
 * Prior to this, CacheManager/TieredCacheManager were fully implemented and
 * tested in isolation but never wired into the actual backend — get()/
 * getByKey() always hit LanceDB, and healthCheck()'s "cache" component was a
 * hardcoded stub. These tests cover the wiring: cache hits avoid re-reading
 * the table, and writes/deletes invalidate stale cache entries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanceDBBackend } from './lancedb-backend.js';
import { createDefaultEntry } from './types.js';

describe('LanceDBBackend cache wiring', () => {
  let dbPath: string;
  let backend: LanceDBBackend;

  beforeEach(async () => {
    dbPath = mkdtempSync(join(tmpdir(), 'lancedb-cache-test-'));
    backend = new LanceDBBackend({ dbPath, vectorDimension: 8, namespace: 'default' });
    await backend.initialize();
  });

  afterEach(async () => {
    await backend.shutdown();
    rmSync(dbPath, { recursive: true, force: true });
  });

  it('serves get(id) from cache on the second call', async () => {
    const entry = createDefaultEntry({ key: 'k1', content: 'hello', namespace: 'default' });
    await backend.store(entry);

    const first = await backend.get(entry.id);
    expect(first?.content).toBe('hello');

    const statsAfterFirst = await backend.healthCheck();
    const hitsAfterFirst = (statsAfterFirst.components.cache as any).hitRate;

    const second = await backend.get(entry.id);
    expect(second?.content).toBe('hello');

    const statsAfterSecond = await backend.healthCheck();
    const hitsAfterSecond = (statsAfterSecond.components.cache as any).hitRate;

    // Second get() should be a cache hit, raising the observed hit rate.
    expect(hitsAfterSecond).toBeGreaterThan(hitsAfterFirst);
  });

  it('serves getByKey() from cache and keeps it consistent with get(id)', async () => {
    const entry = createDefaultEntry({ key: 'k2', content: 'world', namespace: 'default' });
    await backend.store(entry);

    const byKey = await backend.getByKey('default', 'k2');
    expect(byKey?.id).toBe(entry.id);

    // getByKey() should have warmed the id-cache too.
    const byId = await backend.get(entry.id);
    expect(byId?.content).toBe('world');
  });

  it('invalidates the cache on update so reads see fresh content', async () => {
    const entry = createDefaultEntry({ key: 'k3', content: 'v1', namespace: 'default' });
    await backend.store(entry);
    await backend.get(entry.id); // warm the cache

    await backend.update(entry.id, { content: 'v2' });

    const updated = await backend.get(entry.id);
    expect(updated?.content).toBe('v2');
  });

  it('invalidates the cache on delete so it does not resurrect deleted entries', async () => {
    const entry = createDefaultEntry({ key: 'k4', content: 'gone-soon', namespace: 'default' });
    await backend.store(entry);
    await backend.get(entry.id); // warm the cache

    const deleted = await backend.delete(entry.id);
    expect(deleted).toBe(true);

    const afterDelete = await backend.get(entry.id);
    expect(afterDelete).toBeNull();
  });

  it('reports cache health via healthCheck().components.cache', async () => {
    const health = await backend.healthCheck();
    expect(health.components.cache).toBeDefined();
    expect(typeof (health.components.cache as any).hitRate).toBe('number');
    expect(typeof (health.components.cache as any).size).toBe('number');
  });
});
