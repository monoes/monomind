/**
 * Tests for HybridMemoryRepository
 *
 * Covers: findByCompositeKey colon-splitting bug fix,
 * keyIndex O(1) lookup, isExpired() in findAll, sort options.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HybridMemoryRepository } from './hybrid-memory-repository.js';
import { MemoryEntry } from '../../domain/entities/memory-entry.js';

function makeEntry(namespace: string, key: string, value = 'v'): MemoryEntry {
  return MemoryEntry.create({ namespace, key, value, type: 'semantic' });
}

describe('HybridMemoryRepository', () => {
  let repo: HybridMemoryRepository;

  beforeEach(async () => {
    repo = new HybridMemoryRepository({ sqlitePath: ':memory:' });
    await repo.initialize();
  });

  describe('findByCompositeKey — colon-in-key fix', () => {
    it('finds entry with colon in key', async () => {
      const entry = makeEntry('default', 'ctx-summary:session-abc-123');
      await repo.save(entry);

      // The bug: compositeKey = "default:ctx-summary:session-abc-123"
      // split(':') gave key="ctx-summary" (truncated) — now we split on first colon only
      const found = await repo.findByCompositeKey('default:ctx-summary:session-abc-123');
      expect(found).not.toBeNull();
      expect(found?.key).toBe('ctx-summary:session-abc-123');
    });

    it('returns null for missing composite key', async () => {
      const result = await repo.findByCompositeKey('ns:missing-key');
      expect(result).toBeNull();
    });

    it('returns null when compositeKey has no colon', async () => {
      const result = await repo.findByCompositeKey('nokeyatall');
      expect(result).toBeNull();
    });
  });

  describe('findByKey O(1) via keyIndex', () => {
    it('finds entry by exact namespace+key', async () => {
      const entry = makeEntry('ns1', 'my-key', 'hello');
      await repo.save(entry);

      const found = await repo.findByKey('ns1', 'my-key');
      expect(found).not.toBeNull();
      expect(found?.namespace).toBe('ns1');
    });

    it('returns null for wrong namespace', async () => {
      const entry = makeEntry('ns1', 'my-key', 'hello');
      await repo.save(entry);

      const found = await repo.findByKey('wrong-ns', 'my-key');
      expect(found).toBeNull();
    });

    it('keyIndex stays consistent after delete', async () => {
      const entry = makeEntry('ns', 'key1', 'v');
      await repo.save(entry);
      await repo.delete(entry.id);

      const found = await repo.findByKey('ns', 'key1');
      expect(found).toBeNull();
    });
  });

  describe('findAll with status=active excludes expired entries', () => {
    it('does not return expired active entries', async () => {
      const expired = MemoryEntry.create({
        namespace: 'ns',
        key: 'expires-soon',
        value: 'old',
        type: 'semantic',
        ttl: 1, // 1ms TTL — already expired by the time we query
      });
      await repo.save(expired);
      // Wait a tiny bit to ensure TTL is past
      await new Promise(resolve => setTimeout(resolve, 5));

      const results = await repo.findAll({ status: 'active' });
      const ids = results.map(e => e.id);
      expect(ids).not.toContain(expired.id);
    });

    it('returns non-expired active entries', async () => {
      const fresh = MemoryEntry.create({
        namespace: 'ns',
        key: 'fresh',
        value: 'new',
        type: 'semantic',
        ttl: 60_000, // 1 minute
      });
      await repo.save(fresh);

      const results = await repo.findAll({ status: 'active' });
      expect(results.some(e => e.id === fresh.id)).toBe(true);
    });
  });

  describe('findAll sort options', () => {
    it('returns entries sorted by createdAt desc by default', async () => {
      await repo.save(makeEntry('ns', 'a', 'first'));
      await new Promise(resolve => setTimeout(resolve, 2));
      await repo.save(makeEntry('ns', 'b', 'second'));

      const results = await repo.findAll({ orderBy: 'createdAt', orderDirection: 'desc' });
      expect(results[0].key).toBe('b');
    });
  });
});
