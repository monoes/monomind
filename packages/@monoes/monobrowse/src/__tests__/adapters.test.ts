/**
 * Platform adapters are pure declarations plus two tiny page-probing methods.
 * A fake PageInterface (evaluate + url) is all that's needed — no browser.
 */
import { describe, it, expect, vi } from 'vitest';
import { adapters, getAdapter, type PageInterface } from '../browser/adapters/index.js';

const PLATFORMS = ['linkedin', 'instagram', 'x', 'gemini', 'google', 'microsoft'] as const;

function fakePage(opts: { evaluate?: unknown; url?: string } = {}): PageInterface & {
  evaluated: string[];
} {
  const evaluated: string[] = [];
  return {
    evaluated,
    async evaluate<T>(expression: string): Promise<T> {
      evaluated.push(expression);
      return opts.evaluate as T;
    },
    async url(): Promise<string> {
      return opts.url ?? 'https://example.test/';
    },
  };
}

describe('getAdapter', () => {
  it('returns the adapter whose `platform` matches its registry key', () => {
    for (const key of PLATFORMS) {
      expect(getAdapter(key).platform).toBe(key);
    }
  });

  it('throws for an unknown platform, listing the supported ones', () => {
    expect(() => getAdapter('myspace')).toThrow(
      `Unknown platform: myspace. Supported: ${PLATFORMS.join(', ')}`
    );
  });

  it('is case-sensitive (no silent normalization)', () => {
    expect(() => getAdapter('LinkedIn')).toThrow(/Unknown platform/);
  });

  it('registers exactly the documented platform set', () => {
    expect([...adapters.keys()]).toEqual([...PLATFORMS]);
  });
});

describe('adapter invariants', () => {
  for (const key of PLATFORMS) {
    describe(key, () => {
      const a = getAdapter(key);

      it('exposes an https baseURL with no trailing slash', () => {
        expect(a.baseURL).toMatch(/^https:\/\//);
        expect(a.baseURL.endsWith('/')).toBe(false);
        expect(() => new URL(a.baseURL)).not.toThrow();
      });

      it('exposes a parseable https loginURL', () => {
        const login = a.loginURL();
        expect(login).toMatch(/^https:\/\//);
        expect(() => new URL(login)).not.toThrow();
      });

      it('lists reservedPaths as non-empty root-anchored paths', () => {
        expect(a.reservedPaths.length).toBeGreaterThan(0);
        for (const p of a.reservedPaths) expect(p.startsWith('/')).toBe(true);
      });
    });
  }
});

describe('isLoggedIn', () => {
  it('coerces the page probe to the boolean the caller expects', async () => {
    await expect(getAdapter('linkedin').isLoggedIn(fakePage({ evaluate: true }))).resolves.toBe(true);
    await expect(getAdapter('linkedin').isLoggedIn(fakePage({ evaluate: false }))).resolves.toBe(false);
  });

  it('google short-circuits to false on the sign-in page without probing the DOM', async () => {
    const page = fakePage({ url: 'https://accounts.google.com/signin/v2/identifier', evaluate: true });
    await expect(getAdapter('google').isLoggedIn(page)).resolves.toBe(false);
    expect(page.evaluated).toEqual([]);
  });

  it('google probes the DOM once past the sign-in page', async () => {
    const page = fakePage({ url: 'https://mail.google.com/mail/u/0/', evaluate: true });
    await expect(getAdapter('google').isLoggedIn(page)).resolves.toBe(true);
    expect(page.evaluated).toHaveLength(1);
  });

  it('microsoft short-circuits on both login hostnames', async () => {
    for (const url of [
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      'https://login.microsoft.com/whatever',
    ]) {
      const page = fakePage({ url, evaluate: true });
      await expect(getAdapter('microsoft').isLoggedIn(page)).resolves.toBe(false);
      expect(page.evaluated).toEqual([]);
    }
  });

  it('microsoft probes the DOM elsewhere', async () => {
    const page = fakePage({ url: 'https://teams.microsoft.com/', evaluate: true });
    await expect(getAdapter('microsoft').isLoggedIn(page)).resolves.toBe(true);
    expect(page.evaluated).toHaveLength(1);
  });
});

describe('extractUsername', () => {
  it('returns whatever the page evaluation yields', async () => {
    for (const key of PLATFORMS) {
      await expect(getAdapter(key).extractUsername(fakePage({ evaluate: 'someuser' }))).resolves.toBe(
        'someuser'
      );
    }
  });

  it('propagates evaluation failures so callers can apply their own fallback', async () => {
    const page: PageInterface = {
      evaluate: vi.fn().mockRejectedValue(new Error('detached frame')),
      url: async () => '',
    };
    await expect(getAdapter('x').extractUsername(page)).rejects.toThrow('detached frame');
  });
});
