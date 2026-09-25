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
  const {
    resolveLiveSession,
    adoptLegacySession,
    pinnedPort,
    applySessionPortFlag,
    applySessionNameFlag,
    session,
  } = await import('../cli/session.js');
  // The slice of the browser namespace resolveLiveSession uses.
  const browser = {
    listSessionRecords: store.listSessionRecords,
    removeSessionRecord: store.removeSessionRecord,
    clearRefCache: store.clearRefCache,
    loadSessionRecord: store.loadSessionRecord,
    saveSessionRecord: store.saveSessionRecord,
    loadLegacySessionRecord: store.loadLegacySessionRecord,
    removeLegacySessionRecord: store.removeLegacySessionRecord,
  } as unknown as Parameters<typeof resolveLiveSession>[0];
  return {
    store,
    browser,
    resolveLiveSession,
    adoptLegacySession,
    pinnedPort,
    applySessionPortFlag,
    applySessionNameFlag,
    session,
  };
}

/** Write the session file a pre-#318 CLI left behind in this directory. */
async function writeLegacyRecord(record: Record<string, unknown>) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = join(process.cwd(), '.monomind', 'monobrowse');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'active-port.json'), JSON.stringify(record));
}

async function legacyFileExists(): Promise<boolean> {
  const { readFile } = await import('node:fs/promises');
  return readFile(join(process.cwd(), '.monomind', 'monobrowse', 'active-port.json')).then(
    () => true,
    () => false,
  );
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

describe('#318 adoption of a pre-#318 session record', () => {
  it('adopts a live legacy session: the record is rewritten per port and the old file is gone', async () => {
    const { store, browser, resolveLiveSession } = await load();
    const savedAt = Date.now() - 60_000;
    await writeLegacyRecord({ port: 41111, launched: true, pid: 4242, savedAt });
    onlyLive(41111);

    expect((await resolveLiveSession(browser))?.port).toBe(41111);

    expect(await store.loadSessionRecord(41111)).toEqual({
      port: 41111,
      launched: true,
      pid: 4242,
      // Preserved, not reset — the session's real age is what the idle
      // reaper and the newest-first ordering read.
      savedAt,
    });
    expect(await legacyFileExists()).toBe(false);
  });

  it('adoption keeps connect provenance, so close still never kills the user’s browser', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await writeLegacyRecord({ port: 9229, launched: false });
    onlyLive(9229);

    expect((await resolveLiveSession(browser))?.launched).toBe(false);
    expect((await store.loadSessionRecord(9229))!.launched).toBe(false);
  });

  it('a legacy session whose browser is gone is removed, without throwing', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await writeLegacyRecord({ port: 41111, launched: true, pid: 4242 });
    onlyLive();

    expect(await resolveLiveSession(browser)).toBeNull();
    expect(await legacyFileExists()).toBe(false);
    expect(await store.loadSessionRecord(41111)).toBeNull();
  });

  it('a dead legacy connect-origin session is cleaned up too, not raised as an error', async () => {
    const { browser, resolveLiveSession } = await load();
    await writeLegacyRecord({ port: 9229, launched: false });
    onlyLive();

    expect(await resolveLiveSession(browser)).toBeNull();
    expect(await legacyFileExists()).toBe(false);
  });

  it('a live native session wins; the superseded legacy file is dropped', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await store.saveSessionRecord(42222, { pid: 22 });
    await writeLegacyRecord({ port: 41111, launched: true });
    onlyLive(41111, 42222);

    expect((await resolveLiveSession(browser))?.port).toBe(42222);
    // Not adopted while a native session is live — it is the older candidate.
    expect(await legacyFileExists()).toBe(true);
  });

  it('a legacy record for a port that already has a native record is dropped, not adopted twice', async () => {
    const { store, browser, adoptLegacySession } = await load();
    await store.saveSessionRecord(41111, { launched: false });
    await writeLegacyRecord({ port: 41111, launched: true, pid: 4242 });
    onlyLive(41111);

    expect(await adoptLegacySession(browser)).toBeNull();
    expect(await legacyFileExists()).toBe(false);
    expect((await store.loadSessionRecord(41111))!.launched).toBe(false);
  });

  it('adoption restricted to a named port leaves another port’s legacy record alone', async () => {
    const { browser, adoptLegacySession } = await load();
    await writeLegacyRecord({ port: 41111, launched: true });
    onlyLive(41111);

    expect(await adoptLegacySession(browser, { port: 42222 })).toBeNull();
    expect(await legacyFileExists()).toBe(true);
    expect((await adoptLegacySession(browser, { port: 41111 }))?.port).toBe(41111);
    expect(await legacyFileExists()).toBe(false);
  });

  it('with no legacy file at all, adoption is a no-op', async () => {
    const { browser, adoptLegacySession } = await load();
    onlyLive();
    expect(await adoptLegacySession(browser)).toBeNull();
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

describe('--session names a live session', () => {
  /** Record sessions oldest → newest, so newest-first order is deterministic. */
  async function recordInOrder(
    store: Awaited<ReturnType<typeof load>>['store'],
    ...records: Array<{ port: number; name?: string }>
  ) {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    for (const [i, r] of records.entries()) {
      clock.mockReturnValue(now - (records.length - i) * 1_000);
      await store.saveSessionRecord(r.port, { pid: 10 + i, name: r.name });
    }
    clock.mockRestore();
  }

  it('the record keeps its name', async () => {
    const { store } = await load();
    await store.saveSessionRecord(41111, { pid: 11, name: 'ref' });
    expect((await store.loadSessionRecord(41111))?.name).toBe('ref');
  });

  it('resolves the live session with that name, not the newest one', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await recordInOrder(
      store,
      { port: 41111, name: 'ref' },
      { port: 42222, name: 'build' },
      { port: 43333 },
    );
    onlyLive(41111, 42222, 43333);

    expect((await resolveLiveSession(browser, { name: 'ref' }))?.port).toBe(41111);
    expect((await resolveLiveSession(browser, { name: 'build' }))?.port).toBe(42222);
  });

  it('an unknown name resolves to none instead of falling back to another session', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await recordInOrder(store, { port: 41111 }, { port: 42222, name: 'build' });
    onlyLive(41111, 42222);

    expect(await resolveLiveSession(browser, { name: 'ref' })).toBeNull();
  });

  it('a command with no name never lands on a named session', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await recordInOrder(store, { port: 41111 }, { port: 42222, name: 'ref' });
    onlyLive(41111, 42222);

    expect((await resolveLiveSession(browser))?.port).toBe(41111);
  });

  it('a dead named session is dropped, and the name resolves to none', async () => {
    const { store, browser, resolveLiveSession } = await load();
    await recordInOrder(store, { port: 41111, name: 'ref' });
    onlyLive();

    expect(await resolveLiveSession(browser, { name: 'ref' })).toBeNull();
    expect(await store.loadSessionRecord(41111)).toBeNull();
  });

  it('--session sets the process session name; a missing flag leaves it alone', async () => {
    const { applySessionNameFlag, session } = await load();
    applySessionNameFlag({ _: [], session: 'ref' });
    expect(session.name).toBe('ref');
    applySessionNameFlag({ _: [] });
    expect(session.name).toBe('ref');
  });

  it('rejects a session name that is not a plain identifier', async () => {
    const { applySessionNameFlag } = await load();
    for (const bad of ['', '../x', 'a b', 'x'.repeat(65)]) {
      expect(() => applySessionNameFlag({ _: [], session: bad })).toThrow(/Invalid session name/);
    }
  });
});
