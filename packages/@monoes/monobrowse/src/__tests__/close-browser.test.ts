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

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  /** When true, send() acknowledges the CDP command by delivering a matching
   *  empty result — the GRACEFUL path. Default false leaves it hanging so
   *  closeBrowser's own BROWSER_CLOSE_TIMEOUT_MS race settles it (ungraceful). */
  autoAck = false;
  send(data: string, cb?: (err?: Error) => void): void {
    void cb;
    if (!this.autoAck) return;
    const { id } = JSON.parse(data) as { id: number };
    queueMicrotask(() => this.deliver({ id, result: {} }));
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
  // Clean env vars that can interfere with timer behavior in test environment
  delete process.env.MONOMIND_SDK_AGENT;
  delete process.env.MONOMIND_HOOK_QUIET;

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
  const dir = join(tempDir, '.monomind', 'monobrowse', 'sessions');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${port}.json`),
    JSON.stringify({ port, pid, launched: true, savedAt }),
    'utf-8',
  );
}

/**
 * Block (in REAL time) until closeBrowser()'s process-exit poll has actually
 * started, observed via the poll's own first liveness probe — `kill(pid, 0)`
 * is the first thing waitForProcessExit() does.
 *
 * Needed because closeBrowser() awaits the persisted-port read (real
 * filesystem I/O) BEFORE that poll starts, while `advanceTimersByTimeAsync`
 * only moves a FAKE clock and does not wait for real I/O. Advancing a fixed
 * number of times therefore raced the read: every advance can complete in
 * microseconds of real time while the read is still in flight, so on a loaded
 * host the budget ran out with the poll never started — and since nothing
 * then drives the fake clock again, the test did not merely run slow, it
 * deadlocked on an unsettled promise until the test timeout fired.
 *
 * Once this returns, the remaining work is pure fake timers, so a single
 * bounded advance carries it deterministically.
 */
async function exitPollStarted(pid: number): Promise<void> {
  while (!killSpy.mock.calls.some(([p, signal]) => p === pid && signal === 0)) {
    await realDelay(0);
  }
}

async function connectedClient(autoAck = false) {
  vi.resetModules();
  const { CdpClient } = await import('../browser/cdp.js');
  const client = new CdpClient();
  const p = client.connect('ws://127.0.0.1:9333/devtools/page/ABC');
  lastSocket!.autoAck = autoAck;
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

  // The graceful path is what the monodesign detection driver actually takes,
  // and it had no coverage: closeBrowser used to return on the Browser.close
  // ack while Chrome was still exiting, holding its CDP port and its profile's
  // singleton lock, with an unref'd 1s timer as the only force-kill (which
  // never fired at all if the caller's process exited first).
  it('graceful close waits for the process to actually exit, without killing it', async () => {
    vi.resetModules();
    const { closeBrowser } = await import('../browser/browser.js');
    const port = 9337;
    await writePersistedPort(port, 22222, Date.now());

    let alive = true;
    killSpy.mockImplementation((_pid: unknown, signal?: unknown) => {
      if (signal === 0 && !alive) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      return true as never;
    });

    const client = await connectedClient(true);
    const closePromise = closeBrowser(client, port);
    let settled = false;
    void closePromise.then(() => {
      settled = true;
    });

    // Poll is running and the process is still alive — several poll ticks in,
    // close() must NOT have resolved.
    await exitPollStarted(22222);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);

    alive = false; // Chrome finishes exiting
    await vi.advanceTimersByTimeAsync(200);
    await closePromise;
    expect(killSpy).not.toHaveBeenCalledWith(22222, 'SIGKILL');
  });

  it('graceful close force-kills a process that never exits', async () => {
    vi.resetModules();
    const { closeBrowser } = await import('../browser/browser.js');
    const port = 9338;
    await writePersistedPort(port, 33333, Date.now());

    const client = await connectedClient(true);
    const closePromise = closeBrowser(client, port);
    let settled = false;
    void closePromise.then(() => {
      settled = true;
    });

    // Wait for the poll to exist before driving it (see exitPollStarted) —
    // every previous fix here guessed an advance budget instead, which is
    // what made this test hang rather than merely run slow. From here on the
    // poll is the only thing left and it is pure fake timers, so one advance
    // past its PROCESS_EXIT_TIMEOUT_MS (5000ms) deadline settles it, with no
    // dependence on how fast the host happens to be.
    await exitPollStarted(33333);
    await vi.advanceTimersByTimeAsync(6000);
    await closePromise;

    expect(settled).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(33333, 'SIGKILL');
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
