import { describe, it, expect, beforeEach } from 'vitest';
import { createAugmentCache, type AugmentCache } from '../../cache/augment-cache.js';

describe('AugmentCache', () => {
  let cache: AugmentCache;

  beforeEach(() => {
    cache = createAugmentCache({ maxSize: 3, ttlMs: 60_000 });
  });

  it('stores and retrieves a value by key', () => {
    cache.set('k1', 'result1');
    expect(cache.get('k1')).toBe('result1');
  });

  it('returns undefined for a missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the oldest entry when maxSize is exceeded', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.set('k3', 'v3');
    cache.set('k4', 'v4');
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k4')).toBe('v4');
  });

  it('expires entries after TTL', async () => {
    const shortCache = createAugmentCache({ maxSize: 10, ttlMs: 10 });
    shortCache.set('k1', 'v1');
    await new Promise(r => setTimeout(r, 20));
    expect(shortCache.get('k1')).toBeUndefined();
  });

  it('reports size correctly', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    expect(cache.size()).toBe(2);
  });

  it('clears all entries', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('provides a makeKey helper that encodes all relevant params', () => {
    const { makeKey } = cache;
    const k = makeKey('query', '/repo', 10, 'markdown');
    expect(k).toContain('query');
    expect(k).toContain('/repo');
  });
});
