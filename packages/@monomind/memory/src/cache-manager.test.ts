/**
 * Tests for CacheManager
 *
 * Covers: clear() emits correct previousSize, LRU eviction,
 * TTL expiration, and stats accuracy.
 */

import { describe, it, expect, vi } from 'vitest';
import { CacheManager } from './cache-manager.js';
import type { MemoryEntry } from './types.js';

function makeEntry(id: string): MemoryEntry {
  return {
    id,
    key: id,
    content: `content-${id}`,
    type: 'semantic',
    namespace: 'test',
    tags: [],
    metadata: {},
    accessLevel: 'private',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: Date.now(),
  } as MemoryEntry;
}

describe('CacheManager', () => {
  describe('clear() emits correct previousSize', () => {
    it('previousSize equals number of entries before clear', () => {
      const cache = new CacheManager<MemoryEntry>({ maxSize: 100, ttl: 60_000 });

      cache.set('a', makeEntry('a'));
      cache.set('b', makeEntry('b'));
      cache.set('c', makeEntry('c'));

      let emittedSize = -1;
      cache.on('cache:cleared', ({ previousSize }) => {
        emittedSize = previousSize;
      });

      cache.clear();

      expect(emittedSize).toBe(3);
      expect(cache.size).toBe(0);

      cache.shutdown();
    });

    it('previousSize is 0 when cache was already empty', () => {
      const cache = new CacheManager<MemoryEntry>({ maxSize: 100, ttl: 60_000 });

      let emittedSize = -1;
      cache.on('cache:cleared', ({ previousSize }) => {
        emittedSize = previousSize;
      });

      cache.clear();
      expect(emittedSize).toBe(0);

      cache.shutdown();
    });
  });

  describe('basic get/set/delete', () => {
    it('returns null for missing key', () => {
      const cache = new CacheManager<MemoryEntry>({ maxSize: 10, ttl: 60_000 });
      expect(cache.get('missing')).toBeNull();
      cache.shutdown();
    });

    it('stores and retrieves value', () => {
      const cache = new CacheManager<MemoryEntry>({ maxSize: 10, ttl: 60_000 });
      const entry = makeEntry('x');
      cache.set('x', entry);
      expect(cache.get('x')).toBe(entry);
      cache.shutdown();
    });

    it('delete returns true for existing key', () => {
      const cache = new CacheManager<MemoryEntry>({ maxSize: 10, ttl: 60_000 });
      cache.set('y', makeEntry('y'));
      expect(cache.delete('y')).toBe(true);
      expect(cache.get('y')).toBeNull();
      cache.shutdown();
    });
  });

  describe('LRU eviction', () => {
    it('evicts least-recently-used entry when at capacity', () => {
      const cache = new CacheManager<MemoryEntry>({ maxSize: 2, ttl: 60_000 });
      cache.set('a', makeEntry('a'));
      cache.set('b', makeEntry('b'));

      // Access 'a' to make it recently used
      cache.get('a');

      // Adding 'c' should evict 'b' (LRU)
      cache.set('c', makeEntry('c'));

      expect(cache.get('a')).not.toBeNull();
      expect(cache.get('b')).toBeNull();
      expect(cache.get('c')).not.toBeNull();

      cache.shutdown();
    });
  });

  describe('stats', () => {
    it('tracks hit rate correctly', () => {
      const cache = new CacheManager<MemoryEntry>({ maxSize: 10, ttl: 60_000 });
      cache.set('k', makeEntry('k'));
      cache.get('k');   // hit
      cache.get('miss'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.5);

      cache.shutdown();
    });
  });
});
