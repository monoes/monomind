/**
 * #314: launchMonobrowseBrowser() returned a promise that never settled on a
 * CI runner — node:test reported `cancelledByParent` / "Promise resolution is
 * still pending but the event loop has already resolved". Two distinct bugs
 * in browser.ts, both fixed here, both reproduced below without a real
 * Chrome:
 *
 *   1. launchOnFreePort() spawned Chrome with no 'error' listener on the
 *      child. A spawn failure (EACCES/ENOENT — the executable existed when
 *      findChrome()'s existsSync() checked it, then failed to actually exec)
 *      fires Node's 'error' event asynchronously; with nothing listening,
 *      Node throws it as an uncaught exception and the whole process goes
 *      down, stranding launchBrowser()'s promise forever pending rather than
 *      rejecting it. A process that execs but dies immediately (missing
 *      shared libraries, a sandboxed container refusing it) hit the same
 *      "poll forever, then possibly crash" shape via 'exit' instead.
 *
 *   2. closeBrowser()'s waitForProcessExit() polled with a deliberately
 *      unref'd setTimeout. unref'd means the timer does not count toward
 *      "does the event loop have anything left to do" — so once nothing else
 *      is pinning the loop (as soon as the CDP websocket closes, which
 *      happens right around here as Chrome shuts down), Node considers the
 *      loop drained and exits WITHOUT ever firing that timer's callback,
 *      leaving closeBrowser()'s promise (and its caller's) pending forever.
 *      This is real and 100% reproducible locally with a genuine launched
 *      Chrome and nothing else running — see the PR description for the
 *      manual repro. vi.useFakeTimers() (used throughout close-browser.test.ts)
 *      cannot catch this class of bug, because fake timers do not model real
 *      event-loop-drain semantics — hence a dedicated, real-timer test here.
 */

import { spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal fake CDP websocket — enough for closeBrowser()'s Browser.close
// round trip, without needing a real Chrome or CDP endpoint. Deliberately
// NOT paired with vi.useFakeTimers(): the bug under test only manifests
// against the real event loop.
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
  send(data: string): void {
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
const children: Array<ReturnType<typeof spawn>> = [];

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'monobrowse-launch-close-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.pid && !child.killed) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  await rm(tempDir, { recursive: true, force: true });
});

async function writePersistedPort(port: number, pid: number, savedAt: number): Promise<void> {
  const dir = join(tempDir, '.monomind', 'monobrowse');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'active-port.json'),
    JSON.stringify({ port, pid, launched: true, savedAt }),
    'utf-8',
  );
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

describe('#314: launchBrowser settles instead of hanging when Chrome fails to start', () => {
  it('rejects promptly (does not hang or crash the process) when the executable cannot be spawned', async () => {
    vi.resetModules();
    const { launchBrowser } = await import('../browser/browser.js');
    const fake = join(tempDir, 'chrome');
    // Exists (passes findChrome()'s existsSync check) but is not a valid
    // executable — a real EACCES/ENOEXEC from spawn(), not a synchronous
    // "file not found" that launchBrowser would reject before ever exec'ing.
    writeFileSync(fake, 'not an executable\n');
    chmodSync(fake, 0o644);

    const start = Date.now();
    await expect(
      launchBrowser({ executablePath: fake, port: 23495, launchTimeoutMs: 3000 }),
    ).rejects.toThrow(/Chrome failed to start on port 23495/);
    // Without a child 'error' listener, this used to depend entirely on
    // whether something outside this function happened to intercept the
    // resulting uncaught exception (a bare node:test process has nothing
    // that does — see the module doc comment); where it happened not to
    // crash the process outright, the promise still only ever settled by
    // burning the full launchTimeoutMs. The fix rejects as soon as the
    // spawn error fires, so this must land in well under a second, not
    // ride the 3000ms timeout out.
    expect(Date.now() - start).toBeLessThan(1000);
  }, 8000);

  it('rejects with a clear message when Chrome exits immediately instead of opening its CDP port', async () => {
    vi.resetModules();
    const { launchBrowser } = await import('../browser/browser.js');
    const fake = join(tempDir, 'chrome.sh');
    writeFileSync(fake, '#!/bin/sh\nexit 1\n');
    chmodSync(fake, 0o755);

    await expect(
      launchBrowser({ executablePath: fake, port: 23496, launchTimeoutMs: 3000 }),
    ).rejects.toThrow(/Chrome exited before the CDP endpoint opened on port 23496/);
  }, 8000);
});

describe('#314: closeBrowser settles under the real event loop, not fake timers', () => {
  it('resolves promptly when nothing else is pinning the event loop', async () => {
    vi.resetModules();
    const { closeBrowser } = await import('../browser/browser.js');
    const port = 23497;

    // A real, short-lived child — not Chrome, just something with a genuine,
    // observable exit so process.kill(pid, 0) behaves for real and there is
    // no other handle (socket, ref'd timer) left to accidentally keep the
    // event loop alive on this bug's behalf.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 150)'], {
      stdio: 'ignore',
    });
    children.push(child);
    await writePersistedPort(port, child.pid!, Date.now());

    const client = await connectedClient();

    const outcome = await Promise.race([
      closeBrowser(client, port).then(() => 'settled' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 4000)),
    ]);

    expect(outcome).toBe('settled');
  }, 8000);
});
