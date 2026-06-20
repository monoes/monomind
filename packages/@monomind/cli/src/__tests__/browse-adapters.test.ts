// src/__tests__/browse-adapters.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getAdapter, adapters } from '../browser/adapters/index.js';
import type { PageInterface } from '../browser/adapters/index.js';

function mockPage(isLoggedIn: boolean, username = 'testuser'): PageInterface {
  return {
    evaluate: vi.fn().mockImplementation((expr: string) => {
      if (expr.includes('querySelector')) return Promise.resolve(isLoggedIn ? true : false);
      return Promise.resolve(username);
    }),
    url: vi.fn().mockResolvedValue('https://example.com'),
  };
}

describe('adapter registry', () => {
  it('has all 4 platforms', () => {
    expect(adapters.size).toBe(4);
    for (const p of ['linkedin', 'instagram', 'x', 'gemini']) {
      expect(adapters.has(p)).toBe(true);
    }
  });

  it('getAdapter throws for unknown platform', () => {
    expect(() => getAdapter('myspace')).toThrow('Unknown platform');
  });
});

describe('each adapter', () => {
  const platforms = ['linkedin', 'instagram', 'x', 'gemini'] as const;

  for (const platform of platforms) {
    describe(platform, () => {
      const adapter = getAdapter(platform as string);

      it('has required fields', () => {
        expect(typeof adapter.platform).toBe('string');
        expect(adapter.baseURL).toMatch(/^https?:\/\//);
        expect(Array.isArray(adapter.reservedPaths)).toBe(true);
        expect(adapter.reservedPaths.length).toBeGreaterThan(0);
        expect(typeof adapter.loginURL()).toBe('string');
      });

      it('isLoggedIn returns boolean', async () => {
        const page = mockPage(true);
        const result = await adapter.isLoggedIn(page);
        expect(typeof result).toBe('boolean');
      });

      it('extractUsername returns string', async () => {
        const page = mockPage(true);
        page.evaluate = vi.fn().mockResolvedValue('johndoe');
        const username = await adapter.extractUsername(page);
        expect(typeof username).toBe('string');
      });
    });
  }
});
