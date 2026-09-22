/**
 * Coverage for getUpdateTagline()'s stale-cache handling.
 *
 * Bug: the cached "latest" version in ~/.monomind/update-state.json can be
 * OLDER than the currently running version — e.g. the cache was written
 * before an upgrade and never refreshed since. A cached latest that is older
 * than the installed version proves nothing about the registry, yet the old
 * `semver.lte(latest, current)` check treated "older" the same as "equal"
 * and printed a confident "✓ up to date". "Up to date" must only be claimed
 * when the cached latest equals the current version.
 *
 * `node:fs` is mocked so this suite never touches the real
 * ~/.monomind/update-state.json.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState: { content: string | null } = { content: null };

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => fsState.content !== null),
  statSync: vi.fn(() => ({ size: fsState.content ? Buffer.byteLength(fsState.content) : 0 })),
  readFileSync: vi.fn(() => fsState.content as string),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(() => {
    fsState.content = null;
  }),
  mkdirSync: vi.fn(),
}));

import { getUpdateTagline } from '../update/index.js';

const PACKAGE = '@monoes/monomindcli';

function setCachedVersion(version: string): void {
  fsState.content = JSON.stringify({
    lastCheck: new Date().toISOString(),
    checksToday: 1,
    date: new Date().toISOString().split('T')[0],
    packageVersions: { [PACKAGE]: version },
  });
}

describe('getUpdateTagline() stale-cache handling', () => {
  beforeEach(() => {
    fsState.content = null;
  });

  it('returns empty (unknown) when the cached latest is OLDER than the current version', () => {
    // Cache predates this install (e.g. never refreshed since an upgrade) —
    // it cannot honestly claim currency either way.
    setCachedVersion('2.13.0');
    expect(getUpdateTagline('2.15.3')).toBe('');
  });

  it('returns "up to date" when the cached latest equals the current version', () => {
    setCachedVersion('2.15.3');
    expect(getUpdateTagline('2.15.3')).toBe('  ✓ up to date');
  });

  it('returns "available" when the cached latest is newer than the current version', () => {
    setCachedVersion('2.16.0');
    expect(getUpdateTagline('2.15.3')).toBe('  ↑ v2.16.0 available');
  });

  it('returns empty when there is no cache yet', () => {
    fsState.content = null;
    expect(getUpdateTagline('2.15.3')).toBe('');
  });

  it('returns empty when the cached value is not a valid semver string', () => {
    setCachedVersion('not-a-version');
    expect(getUpdateTagline('2.15.3')).toBe('');
  });
});
