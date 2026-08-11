/**
 * closeBrowser()'s cross-process PID-kill fallback (browser.ts) — previously
 * had zero test coverage anywhere in this package (found in a review pass
 * after commit c4847e22). Covers:
 *   - using a persisted PID when the in-process launchedPids map is empty
 *     (the always-true case for a fresh CLI invocation)
 *   - rejecting a persisted PID that is too old to trust (staleness bound)
 *   - a liveness check (process.kill(pid, 0)) gating the SIGKILL itself
 *
 * No real Chrome or child process is spawned: Browser.close is driven via a
 * fake `ws` socket (same pattern as cdp-client.test.ts), and process.kill is
 * spied on rather than actually signaling anything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let lastSocket: FakeWs | null = null;

class FakeWs {
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  constructor(public url: string) {
    lastSocket = this;
  }
  on(event: string, fn: (...a: unknown[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(fn);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
  }
  send(_data: string, cb?: (err?: Error) => void): void {
    // Never call cb — simulates a hung Browser.close so closeBrowser's own
    // BROWSER_CLOSE_TIMEOUT_MS race is what settles it (ungraceful path).
    void cb;
  }
  close(): void {}
  deliver(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }
}

vi.mock('ws', () => ({ WebSocket: FakeWs }));

let tempDir: string;
let killSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.useFakeTimers();
  lastSocket = null;
  tempDir = await mkdtemp(join(tmpdir(), 'monobrowse-close-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as never);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

async function writePersistedPort(port: number, pid: number, savedAt: number): Promise<void> {
  const dir = join(tempDir, '.monomind', 'monobrowse');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'active-port.json'), JSON.stringify({ port, pid, launched: true, savedAt }), 'utf-8');
}

async function connectedClient() {
  vi.resetModules();
  const { CdpClient } = await import('../browser/cdp.js');
  const client = new CdpClient();
  const p = client.connect('ws://127.0.0.1:9333/devtools/page/ABC');
  lastSocket!.emit('open');
  await p;
  return client;
}

describe('#115 review follow-up: closeBrowser() cross-process PID-kill fallback', () => {
  it('uses a fresh persisted PID (in-process map empty) and SIGKILLs it on an ungraceful close', async () => {
    vi.resetModules();
    const { closeBrowser, getLaunchedPid } = await import('../browser/browser.js');
    const port = 9333;
    await writePersistedPort(port, 54321, Date.now());
    // Confirm the in-process map really is empty for this port (fresh module state).
    expect(getLaunchedPid(port)).toBeUndefined();

    const client = await connectedClient();
    const closePromise = closeBrowser(client, port);
    await vi.advanceTimersByTimeAsync(3000); // BROWSER_CLOSE_TIMEOUT_MS
    await closePromise;

    expect(killSpy).toHaveBeenCalledWith(54321, 0);
    expect(killSpy).toHaveBeenCalledWith(54321, 'SIGKILL');
  });

  it('#124-review: does not trust a persisted PID older than the staleness bound', async () => {
    vi.resetModules();
    const { closeBrowser } = await import('../browser/browser.js');
    const port = 9334;
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await writePersistedPort(port, 99999, twoDaysAgo);

    const client = await connectedClient();
    const closePromise = closeBrowser(client, port);
    await vi.advanceTimersByTimeAsync(3000);
    await closePromise;

    expect(killSpy).not.toHaveBeenCalled();
  });

  it('#124-review: a persisted PID that is no longer alive is not force-killed (liveness check via kill(pid,0))', async () => {
    vi.resetModules();
    const { closeBrowser } = await import('../browser/browser.js');
    const port = 9335;
    await writePersistedPort(port, 11111, Date.now());
    killSpy.mockImplementation((_pid: unknown, signal?: unknown) => {
      if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      return true as never;
    });

    const client = await connectedClient();
    const closePromise = closeBrowser(client, port);
    await vi.advanceTimersByTimeAsync(3000);
    await closePromise;

    expect(killSpy).toHaveBeenCalledWith(11111, 0);
    expect(killSpy).not.toHaveBeenCalledWith(11111, 'SIGKILL');
  });

  it('no persisted port file at all — closeBrowser is a no-op, no kill attempted', async () => {
    vi.resetModules();
    const { closeBrowser } = await import('../browser/browser.js');
    const client = await connectedClient();
    const closePromise = closeBrowser(client, 9336);
    await vi.advanceTimersByTimeAsync(3000);
    await closePromise;

    expect(killSpy).not.toHaveBeenCalled();
  });
});
