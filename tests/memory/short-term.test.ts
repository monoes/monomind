/**
 * Tests for ShortTermMemory (Task 09)
 *
 * Run: npx vitest run --globals tests/memory/short-term.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ShortTermMemory } from '../../packages/@monobrain/memory/src/tiers/short-term.js';
import type { MemoryEntry } from '../../packages/@monobrain/memory/src/types.js';

function makeEntry(id: string, content = `content-${id}`): MemoryEntry {
  const now = Date.now();
  return {
    id,
    key: `key-${id}`,
    content,
    type: 'semantic',
    namespace: 'default',
    tags: [],
    metadata: {},
    accessLevel: 'private',
    createdAt: now,
    updatedAt: now,
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: now,
  };
}

describe('ShortTermMemory', () => {
  let mem: ShortTermMemory;

  beforeEach(() => {
    mem = new ShortTermMemory(3);
  });

  it('stores and retrieves by id', () => {
    const entry = makeEntry('a');
    mem.store(entry);
    expect(mem.retrieve('a')).toEqual(entry);
    expect(mem.size).toBe(1);
  });

  it('returns undefined for unknown id', () => {
    expect(mem.retrieve('nope')).toBeUndefined();
  });

  it('evicts oldest when capacity exceeded', () => {
    mem.store(makeEntry('1'));
    mem.store(makeEntry('2'));
    mem.store(makeEntry('3'));
    expect(mem.size).toBe(3);

    // Adding a 4th should evict '1'
    mem.store(makeEntry('4'));
    expect(mem.size).toBe(3);
    expect(mem.retrieve('1')).toBeUndefined();
    expect(mem.retrieve('2')).toBeDefined();
    expect(mem.retrieve('3')).toBeDefined();
    expect(mem.retrieve('4')).toBeDefined();
  });

  it('flush() clears buffer and returns count', async () => {
    mem.store(makeEntry('x'));
    mem.store(makeEntry('y'));

    const flushed: MemoryEntry[] = [];
    const mockBackend = {
      bulkInsert: async (entries: MemoryEntry[]) => {
        flushed.push(...entries);
      },
    } as unknown as import('../../packages/@monobrain/memory/src/types.js').IMemoryBackend;

    const count = await mem.flush(mockBackend);
    expect(count).toBe(2);
    expect(mem.size).toBe(0);
    expect(flushed).toHaveLength(2);
  });

  it('flush() returns 0 when buffer is empty', async () => {
    const mockBackend = {
      bulkInsert: async () => {},
    } as unknown as import('../../packages/@monobrain/memory/src/types.js').IMemoryBackend;

    const count = await mem.flush(mockBackend);
    expect(count).toBe(0);
  });

  it('search() returns substring matches', () => {
    mem.store(makeEntry('a', 'hello world'));
    mem.store(makeEntry('b', 'foo bar'));
    mem.store(makeEntry('c', 'hello there'));

    const results = mem.search('hello');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  it('search() respects limit', () => {
    mem = new ShortTermMemory(100);
    for (let i = 0; i < 10; i++) {
      mem.store(makeEntry(`e${i}`, `match-${i}`));
    }
    const results = mem.search('match', 3);
    expect(results).toHaveLength(3);
  });

  it('clear() empties buffer', () => {
    mem.store(makeEntry('a'));
    mem.store(makeEntry('b'));
    expect(mem.size).toBe(2);
    mem.clear();
    expect(mem.size).toBe(0);
    expect(mem.retrieve('a')).toBeUndefined();
  });
});
