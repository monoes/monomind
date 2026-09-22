/**
 * #318: how a CLI command with no `--port` finds "its" session, and what it
 * does when it finds none — the discovery half of the per-session-browser
 * fix. The allocation half (Chrome binding a free port in a profile of its
 * own) is covered by browser-launch.test.ts and, end to end, by
 * browse-concurrency.test.ts.
 *
 * resolveLiveSession() takes the browser namespace as a parameter, so the
 * real session store (with process.cwd() pointed at a temp dir) can be used
 * while only the CDP liveness probe is faked.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'monobrowse-session-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

async function load() {
  vi.resetModules();
  const store = await import('../browser/ref-cache.js');
  const { resolveLiveSession, pinnedPort, applySessionPortFlag, session } = await import(
    '../cli/session.js'
  );
  // The slice of the browser namespace resolveLiveSession uses.
  const browser = {
    listSessionRecords: store.listSessionRecords,
    removeSessionRecord: store.removeSessionRecord,
    clearRefCache: store.clearRefCache,
  } as unknown as Parameters<typeof resolveLiveSession>[0];
  return { store, browser, resolveLiveSession, pinnedPort, applySessionPortFlag, session };
}

/** Fake the CDP `/json/version` probe: only `live` ports answer. */
function onlyLive(...live: number[]) {
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const port = Number(new URL(String(input)).port);
    if (live.includes(port)) return new Response('{}', { status: 200 });
    throw new Error('connection refused');
  });
}

describe('#318 session discovery', () => {
  it('with no sessions recorded, resolves to none — the caller starts its own', async () => {
    const { browser, resolveLiveSession } = await load();
    onlyLive();
    expect(await resolveLiveSession(browser)).toBeNull();
  });

  it('resolves the newest live session', async () => {
    const { store, browser, resolveLiveSession } = await load();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 5_000);
    await store.saveSessionRecord(41111, { pid: 11 });
    clock.mockReturnValue(now);
    await store.saveSessionRecord(42222, { pid: 22 });
    clock.mockRestore();
    onlyLive(41111, 42222);

    expect((await resolveLiveSession(browser))?.port).toBe(42222);
  });

  it('skips a session whose browser died and resolves the older live one', async () => {
    const { store, browser, resolveLiveSession } = await load();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 5_000);
    await store.saveSessionRecord(41111);
    clock.mockReturnValue(now);
    await store.saveSessionRecord(42222);
    clock.mockRestore();
    onlyLive(41111);

    expect((await resolveLiveSession(browser))?.port).toBe(41111);
  });

  it('self-heals: a dead session is dropped from the store, not left to wedge later commands', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await store.saveSessionRecord(42222);
    onlyLive();

    expect(await resolveLiveSession(browser)).toBeNull();
    expect(await store.loadSessionRecord(42222)).toBeNull();
  });

  it('a dead connect-origin session fails loudly instead of being relaunched under the user', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await store.saveSessionRecord(9229, { launched: false });
    onlyLive();

    await expect(resolveLiveSession(browser)).rejects.toThrow(/Connected browser on port 9229/);
    expect(await store.loadSessionRecord(9229)).toBeNull();
  });

  it('close (strict:false) cleans a dead connect-origin session up instead of throwing', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await store.saveSessionRecord(9229, { launched: false });
    onlyLive();

    expect(await resolveLiveSession(browser, { strict: false })).toBeNull();
    expect(await store.loadSessionRecord(9229)).toBeNull();
  });
});

describe('#318 --port session selector', () => {
  it('reads a usable port from the flags, in either the number or string form', async () => {
    const { pinnedPort } = await load();
    expect(pinnedPort({ _: [], port: 9333 })).toBe(9333);
    expect(pinnedPort({ _: [], port: '9333' })).toBe(9333);
  });

  it('treats absent, out-of-range and unparseable ports as "no selector"', async () => {
    const { pinnedPort } = await load();
    expect(pinnedPort({ _: [] })).toBeUndefined();
    expect(pinnedPort({ _: [], port: 80 })).toBeUndefined();
    expect(pinnedPort({ _: [], port: 70000 })).toBeUndefined();
    expect(pinnedPort({ _: [], port: 1.5 })).toBeUndefined();
    expect(pinnedPort({ _: [], port: 'nope' })).toBeUndefined();
    expect(pinnedPort({ _: [], port: true })).toBeUndefined();
  });

  it('pins the process to the named session', async () => {
    const { applySessionPortFlag, session } = await load();
    applySessionPortFlag({ _: [], port: 9333 });
    expect(session.port).toBe(9333);
  });

  it('a command with no --port leaves an established session alone (batch open → snapshot)', async () => {
    const { applySessionPortFlag, session } = await load();
    session.port = 41111; // as `open` set it earlier in this process
    applySessionPortFlag({ _: [] });
    expect(session.port).toBe(41111);
  });
});
