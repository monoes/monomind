/**
 * Tests for PartitionedHNSW
 *
 * Covers: eviction of oldest-TIME bucket (not oldest-insertion bucket),
 * basic add/search, temporal filtering.
 */

import { describe, it, expect } from 'vitest';
import { PartitionedHNSW } from './partitioned-hnsw.js';
import type { MemoryEntry } from './types.js';

function makeEntry(id: string, createdAt: number, content = 'test'): MemoryEntry {
  return {
    id,
    key: id,
    content,
    type: 'semantic',
    namespace: 'test',
    tags: [],
    metadata: {},
    accessLevel: 'private',
    createdAt,
    updatedAt: createdAt,
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: createdAt,
  } as MemoryEntry;
}

describe('PartitionedHNSW', () => {
  describe('evictOldBuckets — evicts oldest-TIME bucket', () => {
    it('evicts the bucket with smallest bucketKey even if added later', () => {
      // Use 1-hour buckets, keep max 2 buckets
      const idx = new PartitionedHNSW({ bucketMs: 3_600_000, maxBuckets: 2 });

      const hourMs = 3_600_000;
      const t0 = 0; // epoch 0
      const t1 = hourMs; // epoch 1
      const t2 = 2 * hourMs; // epoch 2

      // Insert in NON-chronological order: t1 first, then t0, then t2
      // Old bucket (t0) is inserted AFTER new bucket (t1) — insertion order ≠ temporal order
      idx.add(makeEntry('e1', t1));
      idx.add(makeEntry('e0', t0));
      // Now maxBuckets=2, both t0 and t1 fit
      idx.add(makeEntry('e2', t2));
      // Now 3 buckets (t0, t1, t2) but max is 2 — should evict t0 (smallest key)

      expect(idx.totalEntries).toBe(2);
      // e0 (at t0) should be gone; e1 and e2 should remain
      const results = idx.search(null, undefined, 10);
      const ids = results.map(e => e.id);
      expect(ids).not.toContain('e0');
      expect(ids).toContain('e2');
    });

    it('evicts chronologically oldest, not insertion-oldest, under out-of-order inserts', () => {
      const idx = new PartitionedHNSW({ bucketMs: 1000, maxBuckets: 2 });

      // Bucket keys: 5 (t=5000), 3 (t=3000), then 7 (t=7000) → should evict 3
      idx.add(makeEntry('a', 5000));
      idx.add(makeEntry('b', 3000)); // older in time, added after
      idx.add(makeEntry('c', 7000)); // triggers eviction

      expect(idx.totalEntries).toBe(2);
      const results = idx.search(null, undefined, 10);
      const ids = results.map(e => e.id);
      expect(ids).not.toContain('b'); // b is at t=3000, oldest bucket key
    });
  });

  describe('basic add and search', () => {
    it('returns entries matching text query', () => {
      const idx = new PartitionedHNSW();
      idx.add(makeEntry('x', Date.now(), 'unique needle content'));
      idx.add(makeEntry('y', Date.now(), 'other content here'));

      const results = idx.search(null, 'needle', 5);
      expect(results.some(e => e.id === 'x')).toBe(true);
    });

    it('counts total entries correctly', () => {
      const idx = new PartitionedHNSW({ maxBuckets: 10 });
      for (let i = 0; i < 5; i++) {
        idx.add(makeEntry(`e${i}`, Date.now() + i * 100));
      }
      expect(idx.totalEntries).toBe(5);
    });
  });
});
