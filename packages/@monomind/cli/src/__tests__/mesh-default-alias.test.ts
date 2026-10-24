import { describe, expect, it } from 'vitest';
import { defaultAlias, joinWithFreeAlias } from '../mesh/default-alias.js';

describe('defaultAlias', () => {
  it('is the project name plus the local start time as plain numbers', () => {
    expect(defaultAlias('/work/monomind', new Date(2026, 9, 24, 14, 30, 5))).toBe(
      'monomind-20261024-143005',
    );
  });

  it('keeps the alias legal and inside 64 characters', () => {
    const a = defaultAlias(`/w/${'x y'.repeat(40)}`, new Date(2026, 0, 2, 3, 4, 5));
    expect(a).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(a.length + 3).toBeLessThanOrEqual(64);
  });
});

describe('joinWithFreeAlias', () => {
  it('adds -2, -3… while the alias is taken', async () => {
    const taken = new Set(['p-1', 'p-1-2']);
    const tried: string[] = [];
    const addr = await joinWithFreeAlias('p-1', async (a) => {
      tried.push(a);
      if (taken.has(a)) throw new Error('alias_taken');
      return 'addr';
    });
    expect(addr).toBe('addr');
    expect(tried).toEqual(['p-1', 'p-1-2', 'p-1-3']);
  });

  it('rethrows any other failure at once', async () => {
    await expect(
      joinWithFreeAlias('p', async () => {
        throw new Error('limit');
      }),
    ).rejects.toThrow('limit');
  });
});
