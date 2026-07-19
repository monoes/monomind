import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { connect } from 'net';
import { CdpClient, fetchTargets, fetchNewTarget } from './cdp.js';
import type { BrowserConfig, CdpTarget } from './types.js';
import { CHROME_EXECUTABLES } from './types.js';
import { enableConsoleCapture, setupConsoleCapture } from './console-log.js';
import { setupDialogAutoHandling } from './dialog.js';

const DEFAULT_PORT = 9222;
const LAUNCH_TIMEOUT = 10_000;
const POLL_INTERVAL = 200;
const BROWSER_CLOSE_TIMEOUT_MS = 3000;

// Tracks the PID of Chrome instances *we* spawned, keyed by CDP port, so
// closeBrowser() has a kill fallback when the graceful `Browser.close` CDP
// command fails or times out (e.g. a hung renderer). Ports we merely attached
// to (already-running browser) are never recorded here — we only ever kill
// processes we launched ourselves.
const launchedPids = new Map<number, number>();

function findChrome(executablePath?: string): string {
  if (executablePath) {
    if (existsSync(executablePath)) return executablePath;
    throw new Error(`Chrome executable not found: ${executablePath}`);
  }
  for (const candidate of CHROME_EXECUTABLES) {
    if (existsSync(candidate)) return candidate;
  }
  // Try PATH
  try {
    const result = execSync('which google-chrome chromium-browser chromium microsoft-edge microsoft-edge-stable 2>/dev/null', { encoding: 'utf8' }).trim();
    const first = result.split('\n')[0];
    if (first) return first;
  } catch {
    // ignore
  }
  throw new Error(
    'No supported browser found. Install Google Chrome, Microsoft Edge, or Chromium — or pass executablePath in BrowserConfig.'
  );
}

export async function isPortOpen(port: number): Promise<boolean> {
  try {
    await fetchTargets(port);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirm the CDP endpoint on `port` actually identifies as Chrome/Chromium
 * via `/json/version`'s `Browser` field, rather than assuming any CDP-speaking
 * responder is "ours". Reduces (does not eliminate) the risk of silently
 * attaching to an unrelated real browser that happens to be listening there.
 */
async function isChromeIdentity(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const info = (await res.json()) as { Browser?: string };
    return typeof info.Browser === 'string' && /chrom(e|ium)/i.test(info.Browser);
  } catch {
    return false;
  }
}

/** Raw TCP connect probe — distinguishes "nothing listening" from "something listening that isn't CDP". */
function isTcpPortOpen(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port, timeout: timeoutMs });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Ports scanned when the requested one is occupied by a non-Chrome process
 *  (e.g. another local tool that happens to reuse Chrome's conventional CDP
 *  default, 9222 — mirrors the auto-increment convention this monorepo's own
 *  dashboard server uses in bindServer/server.mjs). Only occupied-by-a-
 *  DIFFERENT-process is worked around; an already-attachable Chrome on the
 *  requested port is still returned as-is (existing "attach, don't relaunch"
 *  behavior). */
const LAUNCH_PORT_SCAN_TRIES = 10;

export async function launchBrowser(config: BrowserConfig = {}): Promise<number> {
  const rawPort = config.port ?? DEFAULT_PORT;
  // Validate port is in a safe range for localhost CDP debugging
  if (!Number.isInteger(rawPort) || rawPort < 1024 || rawPort > 65535) {
    throw new Error(`Invalid port: ${rawPort}. Must be an integer between 1024 and 65535.`);
  }

  // strictPort: fail fast on the exact requested port, matching the old
  // behavior (Vite has the same escape hatch for the same reason) — for
  // callers that treat the error as a signal ("this port is taken by
  // something else, bail") rather than consuming the returned port.
  if (config.strictPort) {
    if (await isTcpPortOpen(rawPort)) {
      if (await isChromeIdentity(rawPort)) return rawPort;
      throw new Error(
        `Port ${rawPort} is occupied by a process that does not identify as Chrome/Chromium. ` +
        `Refusing to attach — pass a different port or free port ${rawPort}.`
      );
    }
    return launchOnFreePort(config, rawPort);
  }

  const candidates: number[] = [];
  for (let i = 0; i < LAUNCH_PORT_SCAN_TRIES && rawPort + i <= 65535; i++) candidates.push(rawPort + i);

  // Attach-if-already-Chrome only applies to the EXACT requested port — the
  // original, deliberate, single-port risk ("don't silently take over an
  // unrelated real browser that happens to be on this port"). Scanning past
  // an occupied default must not let that same shortcut attach to a
  // DIFFERENT Chrome instance the caller never named; forward candidates are
  // launch-only (skip if anything is there, Chrome or not).
  if (await isTcpPortOpen(rawPort)) {
    if (await isChromeIdentity(rawPort)) return rawPort;
  } else {
    return launchOnFreePort(config, rawPort);
  }

  for (const candidate of candidates.slice(1)) {
    // TCP-level check for "is anything at all listening" — isPortOpen()
    // does a full CDP /json fetch, which returns false BOTH for a genuinely
    // free port and for one occupied by a non-CDP process (that ambiguity is
    // exactly what the post-spawn isTcpPortOpen fallback below exists to
    // resolve, the hard way, after a 10s launch timeout). Checking the raw
    // socket first tells free and occupied apart up front, so the scan can
    // skip an occupied candidate instead of trying to spawn Chrome on top of
    // it and only discovering the conflict after a timeout.
    if (!(await isTcpPortOpen(candidate))) return launchOnFreePort(config, candidate);
    // Occupied (by anything — not just non-Chrome, per the note above) —
    // try the next candidate instead of failing outright, same as a normal
    // EADDRINUSE retry would.
  }
  throw new Error(
    `Ports ${candidates[0]}-${candidates[candidates.length - 1]} are all occupied and port ${candidates[0]} ` +
    `isn't a Chrome/Chromium instance to attach to. Pass a different --port.`
  );
}

async function launchOnFreePort(config: BrowserConfig, port: number): Promise<number> {
  const chromePath = findChrome(config.executablePath);
  const userDataDir = config.userDataDir ?? join(tmpdir(), `monomind-browser-${port}`);

  const defaultArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--safebrowsing-disable-auto-update',
    '--password-store=basic',
    '--use-mock-keychain',
  ];

  if (config.headless !== false) {
    defaultArgs.push('--headless=new');
  }

  // Cap caller-supplied args to prevent memory exhaustion via huge argument arrays
  const callerArgs = (config.args ?? []).slice(0, 50);
  const args = [...defaultArgs, ...callerArgs];
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  if (child.pid) launchedPids.set(port, child.pid);

  const deadline = Date.now() + LAUNCH_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    if (await isPortOpen(port)) {
      if (await isChromeIdentity(port)) return port;
      throw new Error(
        `Port ${port} is occupied by a CDP-speaking process that does not identify as Chrome/Chromium. ` +
        `Refusing to attach — pass a different port or free port ${port}.`
      );
    }
  }

  // Timed out waiting for our Chrome to come up on the port. Distinguish
  // "nothing is listening" (real launch failure) from "something non-CDP is
  // squatting the port" (confusing generic timeout otherwise) via a raw TCP probe.
  if (await isTcpPortOpen(port)) {
    throw new Error(
      `Port ${port} is occupied by a non-Chrome process (TCP connection succeeds but no CDP response within ${LAUNCH_TIMEOUT}ms). ` +
      `Free the port or pass a different one.`
    );
  }

  throw new Error(`Chrome failed to start on port ${port} within ${LAUNCH_TIMEOUT}ms`);
}

export async function enableSessionDomains(client: CdpClient, sessionId: string): Promise<void> {
  await Promise.all([
    client.send('Page.enable', {}, sessionId),
    client.send('Runtime.enable', {}, sessionId),
    client.send('Network.enable', {}, sessionId),
    client.send('DOM.enable', {}, sessionId),
    client.send('Accessibility.enable', {}, sessionId),
  ]);
  setupConsoleCapture(client, sessionId);
  await enableConsoleCapture(client, sessionId);
  setupDialogAutoHandling(client, sessionId);
}

export async function connectToTarget(port: number, targetId?: string): Promise<{ client: CdpClient; target: CdpTarget; sessionId: string }> {
  const targets = await fetchTargets(port);
  const pageTargets = targets.filter((t) => t.type === 'page');

  let target: CdpTarget;
  if (targetId) {
    const found = pageTargets.find((t) => t.id === targetId);
    if (!found) throw new Error(`Target ${targetId} not found`);
    target = found;
  } else if (pageTargets.length > 0) {
    target = pageTargets[0];
  } else {
    target = await fetchNewTarget(port, 'about:blank');
  }

  const wsUrl = target.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/devtools/page/${target.id}`;
  const client = new CdpClient();
  await client.connect(wsUrl);

  const { sessionId } = await client.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.id,
    flatten: true,
  });

  await enableSessionDomains(client, sessionId);
  return { client, target, sessionId };
}

/**
 * Cleanly terminate a Chrome/Chromium instance we launched on `port`.
 * Sends the `Browser.close` CDP command (the correct graceful shutdown —
 * closes all tabs and exits the process cleanly) over `client`'s connection.
 * If that command fails, times out, or the connection is already gone,
 * falls back to killing the tracked PID directly so a headed/interactive
 * browser window (e.g. one spawned for a login/CAPTCHA flow) never lingers
 * as a visible, authenticated, still-debuggable orphan process.
 */
export async function closeBrowser(client: CdpClient, port: number): Promise<void> {
  let gracefullyClosed = false;
  try {
    await Promise.race([
      client.send('Browser.close', {}),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('Browser.close timed out')), BROWSER_CLOSE_TIMEOUT_MS);
        t.unref?.();
      }),
    ]);
    gracefullyClosed = true;
  } catch {
    // fall through to PID-kill fallback below
  }

  const pid = launchedPids.get(port);
  if (pid === undefined) return; // not a process we launched — nothing to kill
  launchedPids.delete(port);

  if (!gracefullyClosed) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
    return;
  }

  // Browser.close was acknowledged — give the process a moment to exit on
  // its own, then verify and force-kill as a safety net in case it hung.
  const t = setTimeout(() => {
    try {
      process.kill(pid, 0); // throws if the process is already gone
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already exited — expected path */
    }
  }, 1000);
  t.unref?.();
}

export async function openUrl(client: CdpClient, sessionId: string, url: string): Promise<void> {
  // Cap to 2 MB to prevent OOM in CDP message serializer (e.g. data: URI attacks)
  if (url.length > 2_097_152) throw new Error('URL exceeds 2 MB limit');
  await client.send('Page.navigate', { url }, sessionId);
  await waitForNetworkIdle(client, sessionId, 500, 30_000);
}

export async function waitForLoad(
  client: CdpClient,
  sessionId: string,
  condition: 'load' | 'networkidle' | 'domcontentloaded' = 'load',
  timeout = 30_000
): Promise<void> {
  if (condition === 'load' || condition === 'domcontentloaded') {
    // Guard against race where the page loads before the listener is registered
    const readyExpr = condition === 'load' ? 'document.readyState === "complete"' : 'document.readyState !== "loading"';
    const readyCheck = await client.send<{ result: { value?: boolean } }>('Runtime.evaluate', {
      expression: readyExpr, returnByValue: true,
    }, sessionId).catch(() => ({ result: { value: false } }));
    if (readyCheck.result?.value) return;

    const event = condition === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';
    const [eventPromise, cancelOnce] = client.onceWithOff(event, sessionId);
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => { timedOut = true; resolve(); }, timeout);
    });
    try {
      await Promise.race([eventPromise, timeoutPromise]);
      if (timedOut) throw new Error(`Timeout waiting for ${condition}`);
    } finally {
      cancelOnce();
      clearTimeout(timeoutHandle);
    }
    return;
  }

  // networkidle: no network requests for 500ms
  await waitForNetworkIdle(client, sessionId, 500, timeout);
}

async function waitForNetworkIdle(
  client: CdpClient,
  sessionId: string,
  idleMs: number,
  timeout: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = 0;
    const inflight = new Set<string>();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const killTimer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for networkidle'));
    }, timeout);

    const cleanup = () => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      clearTimeout(killTimer);
      offReq(); offResp(); offFail(); offCache(); offResp2();
    };

    const settle = () => {
      cleanup();
      resolve();
    };

    const check = () => {
      if (pending === 0) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(settle, idleMs);
      } else {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      }
    };

    const offReq = client.on('Network.requestWillBeSent', (params, sid) => {
      if (sid !== sessionId) return;
      const id = params.requestId as string;
      if (!inflight.has(id)) { inflight.add(id); pending++; check(); }
    });

    const decrement = (params: Record<string, unknown>, sid?: string) => {
      if (sid !== sessionId) return;
      const id = params.requestId as string;
      if (inflight.delete(id)) { pending = Math.max(0, pending - 1); check(); }
    };

    const offResp  = client.on('Network.loadingFinished',        decrement);
    const offFail  = client.on('Network.loadingFailed',          decrement);
    const offCache = client.on('Network.requestServedFromCache', decrement);
    // Guard against requests that never fire loadingFinished/loadingFailed (e.g. data: URLs)
    // Skip 3xx redirect responses — the request continues under the same requestId
    const offResp2 = client.on('Network.responseReceived', (params, sid) => {
      const p = params as { requestId: string; response: { status: number } };
      if (p.response.status >= 300 && p.response.status < 400) return;
      decrement(params, sid);
    });

    check();
  });
}

export async function getCurrentUrl(client: CdpClient, sessionId: string): Promise<string> {
  const result = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: 'location.href',
    returnByValue: true,
  }, sessionId);
  return result.result?.value ?? '';
}

export async function getCurrentTitle(client: CdpClient, sessionId: string): Promise<string> {
  const result = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  }, sessionId);
  return result.result?.value ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
