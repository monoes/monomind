/**
 * routes-monoes.mjs — the monoes.me connection (OAuth) route handlers.
 *
 * Pure-logic coverage only: PKCE pair correctness and the
 * getValidMonoesToken() refresh-vs-reuse decision. The actual OAuth
 * exchange against monoes.me is verified manually (see the design spec's
 * Testing section) — this repo has no existing e2e/Playwright
 * infrastructure for the dashboard to build on for that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// routes-monoes.mjs is plain ESM shipped as-is; import it directly.
// @ts-expect-error — .mjs sibling has no type declarations
import { createPkcePair, readMonoesConnection, getValidMonoesToken } from '../src/ui/routes-monoes.mjs';

let monomindHome = '';

beforeEach(() => {
  monomindHome = mkdtempSync(join(tmpdir(), 'monomind-monoes-test-'));
});

afterEach(() => {
  rmSync(monomindHome, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function writeConnection(data: Record<string, unknown>) {
  const { mkdirSync, writeFileSync } = require('node:fs');
  const dir = join(monomindHome, '.monomind');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'monoes-connection.json'), JSON.stringify(data));
}

describe('createPkcePair', () => {
  it('produces a challenge that is the SHA-256/base64url of the verifier', () => {
    const { verifier, challenge } = createPkcePair();
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('produces a URL-safe verifier with no padding', () => {
    const { verifier } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces distinct pairs across calls', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('readMonoesConnection', () => {
  it('returns null when no connection file exists', () => {
    expect(readMonoesConnection(monomindHome)).toBeNull();
  });

  it('returns the parsed connection when one exists', () => {
    writeConnection({ accessToken: /* value */ 'abc', connectedUsername: 'someone' });
    expect(readMonoesConnection(monomindHome)).toEqual({ accessToken: 'abc', connectedUsername: 'someone' });
  });
});

describe('getValidMonoesToken', () => {
  it('returns null when there is no connection', async () => {
    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBeNull();
  });

  it('returns the stored access token directly when it is not close to expiring', async () => {
    writeConnection({ accessToken: /* value */ 'still-good', expiresAt: Date.now() + 10 * 60 * 1000 });
    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBe('still-good');
  });

  it('refreshes when the token is expired, and persists the new token', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: 'new', refresh_token: 'refresh-2', expires_in: 3600 }),
      })),
    );

    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBe('new');

    const persisted = readMonoesConnection(monomindHome);
    expect(persisted.accessToken).toBe('new');
    expect(persisted.refreshToken).toBe('refresh-2');
  });

  it('deletes the connection and returns null when refresh fails', async () => {
    writeConnection({
      accessToken: /* value */ 'old',
      refreshToken: /* value */ 'refresh-1',
      clientId: 'client-1',
      expiresAt: Date.now() - 1000,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));

    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBeNull();
    expect(readMonoesConnection(monomindHome)).toBeNull();
    expect(existsSync(join(monomindHome, '.monomind', 'monoes-connection.json'))).toBe(false);
  });

  it('deletes the connection and returns null when there is no refresh token to use', async () => {
    writeConnection({ accessToken: /* value */ 'old', expiresAt: Date.now() - 1000 });
    const token = await getValidMonoesToken(monomindHome);
    expect(token).toBeNull();
    expect(existsSync(join(monomindHome, '.monomind', 'monoes-connection.json'))).toBe(false);
  });
});
