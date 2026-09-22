/**
 * #310: a launched Chrome outlives its session, holding its CDP port (9222 by
 * convention, which other local tools want) with zero targets left to
 * reattach to. reapIdleLaunchedBrowser() gives that port back.
 *
 * No real Chrome is spawned: the CDP HTTP endpoints (/json/version, /json/list)
 * are served by a local http server that answers exactly like Chrome does
 * (same approach as browser-launch.test.ts), the browser-level websocket is a
 * fake `ws` socket (same approach as close-browser.test.ts), and process.kill
 * is spied on rather than actually signaling anything.
 *
 * Fixed port range (23490-23499) chosen to avoid colliding with real services.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpTarget } from '../browser/types.js';

const BASE = 23490;
const MINUTE = 60_000;

let lastSocket: FakeWs | null = null;

/** Minimal `ws` stand-in: opens on its own and acknowledges every command,
 *  so `Browser.close` takes the graceful path without a real browser. */
class FakeWs {
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  sent: string[] = [];
  constructor(public url: string) {
    lastSocket = this;
    queueMicrotask(() => this.emit('open'));
  }
  on(event: string, fn: (...a: unknown[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(fn);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
  }
  send(data: string, cb?: (err?: Error) => void): void {
    void cb;
    this.sent.push(data);
    const { id } = JSON.parse(data) as { id: number };
    queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id, result: {} }))));
  }
  close(): void {}
  /** Methods this socket was asked to run, e.g. ['Browser.close']. */
  methods(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { method: string }).method);
  }
}

vi.mock('ws', () => ({ WebSocket: FakeWs }));

let tempDir: string;
let servers: HttpServer[] = [];
let killSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  lastSocket = null;
  tempDir = await mkdtemp(join(tmpdir(), 'monobrowse-reap-test-'));
  // ref-cache.ts resolves its cache dir from process.cwd() at module load, so
  // this must be in place before the dynamic import in each test.
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  // The browser is "already gone" by the time closeBrowser polls for its exit
  // (ESRCH on the liveness probe) — the realistic outcome of Browser.close.
  killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid: unknown, signal?: unknown) => {
    if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    return true as never;
  });
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

/** An http server answering /json/version and /json/list exactly like Chrome. */
function fakeChrome(port: number, targets: Partial<CdpTarget>[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer((req, res) => {
      if (req.url === '/json/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            Browser: 'Chrome/999.0.0.0',
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake-browser-id`,
          }),
        );
      } else if (req.url === '/json/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(targets));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => {
      servers.push(s);
      resolve();
    });
  });
}

// Sessions are recorded one file per port (#318).
const PORT_FILE = (port: number) =>
  join(tempDir, '.monomind', 'monobrowse', 'sessions', `${port}.json`);

async function writePersistedPort(record: {
  port: number;
  pid?: number;
  launched: boolean;
  savedAt?: number;
}): Promise<void> {
  await mkdir(join(tempDir, '.monomind', 'monobrowse', 'sessions'), { recursive: true });
  await writeFile(PORT_FILE(record.port), JSON.stringify(record), 'utf-8');
}

async function portFileExists(port: number): Promise<boolean> {
  return readFile(PORT_FILE(port), 'utf-8').then(
    () => true,
    () => false,
  );
}

async function loadBrowser() {
  vi.resetModules();
  return import('../browser/browser.js');
}

/** A page target as Chrome reports it when NO debugger is attached to it. */
function idlePageTarget(id: string, port: number): Partial<CdpTarget> {
  return {
    id,
    type: 'page',
    title: 'Example',
    url: 'https://example.com/',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`,
  };
}

describe('#310 reapIdleLaunchedBrowser — give back a CDP port nothing is using', () => {
  it('reaps a launched instance that has had zero targets past the idle threshold', async () => {
    const port = BASE + 0;
    await fakeChrome(port, []);
    await writePersistedPort({
      port,
      pid: 54321,
      launched: true,
      savedAt: Date.now() - 45 * MINUTE,
    });

    const { reapIdleLaunchedBrowser } = await loadBrowser();
    await expect(reapIdleLaunchedBrowser()).resolves.toBe(port);

    expect(lastSocket?.url).toBe(`ws://127.0.0.1:${port}/devtools/browser/fake-browser-id`);
    expect(lastSocket?.methods()).toContain('Browser.close');
    // The port file is the session handle — a reaped session must not leave
    // one behind for the next command to chase.
    expect(await portFileExists(port)).toBe(false);
  });

  it('does NOT reap a launched instance that still has open page targets', async () => {
    const port = BASE + 1;
    await fakeChrome(port, [idlePageTarget('AAA', port)]);
    await writePersistedPort({
      port,
      pid: 54322,
      launched: true,
      savedAt: Date.now() - 45 * MINUTE,
    });

    const { reapIdleLaunchedBrowser } = await loadBrowser();
    await expect(reapIdleLaunchedBrowser()).resolves.toBeNull();

    expect(lastSocket).toBeNull();
    expect(killSpy).not.toHaveBeenCalled();
    expect(await portFileExists(port)).toBe(true);
  });

  it('does NOT reap a browser this tool never launched, however idle or old it is', async () => {
    // `connect` records launched:false — that browser belongs to the user.
    const port = BASE + 2;
    await fakeChrome(port, []);
    await writePersistedPort({
      port,
      pid: 54323,
      launched: false,
      savedAt: Date.now() - 48 * 60 * MINUTE,
    });

    const { reapIdleLaunchedBrowser } = await loadBrowser();
    await expect(reapIdleLaunchedBrowser()).resolves.toBeNull();

    expect(lastSocket).toBeNull();
    expect(killSpy).not.toHaveBeenCalled();
    expect(await portFileExists(port)).toBe(true);
  });

  it('does NOT reap while a client is still attached to a target', async () => {
    // Chrome omits webSocketDebuggerUrl from a target that already has a
    // debugger attached — an in-flight session, not an abandoned browser.
    const port = BASE + 3;
    await fakeChrome(port, [
      { id: 'BBB', type: 'page', title: 'Example', url: 'https://example.com/' },
    ]);
    await writePersistedPort({
      port,
      pid: 54324,
      launched: true,
      savedAt: Date.now() - 45 * MINUTE,
    });

    const { reapIdleLaunchedBrowser } = await loadBrowser();
    await expect(reapIdleLaunchedBrowser()).resolves.toBeNull();

    expect(lastSocket).toBeNull();
    expect(await portFileExists(port)).toBe(true);
  });

  it('does NOT reap an instance that is still inside the idle threshold', async () => {
    // A live session can momentarily have no targets (last tab closed, next
    // command about to open one) — reaping that would break reattach.
    const port = BASE + 4;
    await fakeChrome(port, []);
    await writePersistedPort({ port, pid: 54325, launched: true, savedAt: Date.now() - MINUTE });

    const { reapIdleLaunchedBrowser } = await loadBrowser();
    await expect(reapIdleLaunchedBrowser()).resolves.toBeNull();

    expect(lastSocket).toBeNull();
    expect(await portFileExists(port)).toBe(true);
  });

  it('does NOT reap when the persisted record has no savedAt (age unknowable)', async () => {
    const port = BASE + 5;
    await fakeChrome(port, []);
    await writePersistedPort({ port, pid: 54326, launched: true });

    const { reapIdleLaunchedBrowser } = await loadBrowser();
    await expect(reapIdleLaunchedBrowser()).resolves.toBeNull();
    expect(lastSocket).toBeNull();
  });

  it('is a no-op with no persisted session at all', async () => {
    const { reapIdleLaunchedBrowser } = await loadBrowser();
    await expect(reapIdleLaunchedBrowser()).resolves.toBeNull();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('launchBrowser reaps the stale instance before deciding what to do with the port', async () => {
    // The wiring that makes the reaper run at all: every launch/attach is a
    // chance to give back a port a previous session abandoned.
    const port = BASE + 6;
    await fakeChrome(port, []);
    await writePersistedPort({
      port,
      pid: 54327,
      launched: true,
      savedAt: Date.now() - 45 * MINUTE,
    });

    const { launchBrowser } = await loadBrowser();
    // The fake Chrome stays listening, so launchBrowser attaches to it after
    // the reap rather than spawning a real browser.
    await expect(launchBrowser({ port })).resolves.toBe(port);

    expect(lastSocket?.methods()).toContain('Browser.close');
    expect(await portFileExists(port)).toBe(false);
  });
});
