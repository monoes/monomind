/**
 * refreshUpdateCacheInBackground(): `monomind --version` returns before the
 * startup update check runs, so on its own it never refreshed the update
 * cache — a stale cache kept `--version` silent about new releases forever.
 * When the cache is missing or stale, `--version` now reserves a check slot
 * and spawns a detached, output-less child that rewrites the cache.
 *
 * The gate is the startup check's own (reserveCheck): CI,
 * CONTINUOUS_INTEGRATION, MONOMIND_AUTO_UPDATE=false, the 24h interval and
 * the daily cap. `node:fs` is mocked so the real
 * ~/.monomind/update-state.json is never touched, and spawn is injected so
 * no real process starts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsState: { content: string | null; pending: string | null } = {
  content: null,
  pending: null,
};

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => fsState.content !== null),
  statSync: vi.fn(() => ({ size: fsState.content ? Buffer.byteLength(fsState.content) : 0 })),
  readFileSync: vi.fn(() => fsState.content as string),
  // saveState() writes a tmp file then renames it over the state file.
  writeFileSync: vi.fn((_p: string, data: string) => {
    fsState.pending = data;
  }),
  renameSync: vi.fn(() => {
    fsState.content = fsState.pending;
  }),
  unlinkSync: vi.fn(() => {
    fsState.content = null;
  }),
  mkdirSync: vi.fn(),
}));

import { getUpdateTagline, refreshUpdateCacheInBackground } from '../update/index.js';

const PACKAGE = '@monoes/monomindcli';
const HOUR = 60 * 60 * 1000;
const ENV_KEYS = ['CI', 'CONTINUOUS_INTEGRATION', 'MONOMIND_AUTO_UPDATE', 'MONOMIND_FORCE_UPDATE'];

function setState(lastCheckAgoMs: number | null, checksToday = 1, version = '2.15.4'): void {
  fsState.content = JSON.stringify({
    lastCheck: lastCheckAgoMs === null ? '' : new Date(Date.now() - lastCheckAgoMs).toISOString(),
    checksToday,
    date: new Date().toISOString().split('T')[0],
    packageVersions: { [PACKAGE]: version },
  });
}

function fakeSpawn() {
  const child = { unref: vi.fn(), on: vi.fn() };
  const spawn = vi.fn(() => child);
  return { spawn, child };
}

describe('refreshUpdateCacheInBackground()', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    fsState.content = null;
    fsState.pending = null;
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('spawns a detached, unref’d, output-less child when the cache is stale', () => {
    setState(25 * HOUR);
    const { spawn, child } = fakeSpawn();

    expect(refreshUpdateCacheInBackground(spawn as never)).toBe(true);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toMatch(/refresh-worker\.(js|ts)$/);
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalled();
    // An async spawn failure emits 'error'; without a listener it would crash.
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('spawns when there is no cache at all', () => {
    const { spawn } = fakeSpawn();
    expect(refreshUpdateCacheInBackground(spawn as never)).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('leaves the tagline --version prints unchanged', () => {
    setState(25 * HOUR, 1, '2.16.0');
    const before = getUpdateTagline('2.15.3');
    refreshUpdateCacheInBackground(fakeSpawn().spawn as never);
    expect(getUpdateTagline('2.15.3')).toBe(before);
  });

  it('does not spawn when the cache is fresh', () => {
    setState(1 * HOUR);
    const { spawn } = fakeSpawn();
    expect(refreshUpdateCacheInBackground(spawn as never)).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not spawn again right after a refresh was started (reserves the slot)', () => {
    setState(25 * HOUR);
    const first = fakeSpawn();
    const second = fakeSpawn();
    expect(refreshUpdateCacheInBackground(first.spawn as never)).toBe(true);
    expect(refreshUpdateCacheInBackground(second.spawn as never)).toBe(false);
    expect(second.spawn).not.toHaveBeenCalled();
  });

  it('does not spawn once the daily check cap is reached', () => {
    setState(25 * HOUR, 10);
    const { spawn } = fakeSpawn();
    expect(refreshUpdateCacheInBackground(spawn as never)).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['MONOMIND_AUTO_UPDATE', 'false'],
    ['CI', 'true'],
    ['CONTINUOUS_INTEGRATION', 'true'],
  ])('does not spawn when %s=%s', (key, value) => {
    process.env[key] = value;
    setState(25 * HOUR);
    const { spawn } = fakeSpawn();
    expect(refreshUpdateCacheInBackground(spawn as never)).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('never throws when spawn itself fails', () => {
    setState(25 * HOUR);
    const spawn = vi.fn(() => {
      throw new Error('EAGAIN');
    });
    expect(refreshUpdateCacheInBackground(spawn as never)).toBe(false);
  });
});
