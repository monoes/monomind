import type { CdpClient } from './cdp.js';
import type { WaitOptions } from './types.js';
import { getCurrentUrl } from './browser.js';
import { evaluateJs } from './actions.js';

const DEFAULT_TIMEOUT = 30_000;
const POLL_INTERVAL = 250;

export async function waitFor(
  client: CdpClient,
  sessionId: string,
  options: WaitOptions
): Promise<void> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const deadline = Date.now() + timeout;

  if (options.load) {
    await waitForLoad(client, sessionId, options.load, timeout);
    return;
  }

  if (options.url) {
    await waitForUrl(client, sessionId, options.url, deadline);
    return;
  }

  if (options.text) {
    await waitForText(client, sessionId, options.text, deadline);
    return;
  }

  if (options.selector) {
    await waitForSelector(client, sessionId, options.selector, deadline);
    return;
  }

  // Just wait for timeout
  await sleep(timeout);
}

async function waitForLoad(
  client: CdpClient,
  sessionId: string,
  condition: string,
  timeout: number
): Promise<void> {
  if (condition === 'networkidle') {
    await waitForNetworkIdle(client, sessionId, 500, timeout);
    return;
  }

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

    const cleanup = () => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      clearTimeout(killTimer);
      offReq(); offResp(); offFail(); offCache();
    };

    const killTimer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for networkidle'));
    }, timeout);

    const settle = () => { cleanup(); resolve(); };

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

    check();
  });
}

async function waitForUrl(
  client: CdpClient,
  sessionId: string,
  pattern: string,
  deadline: number
): Promise<void> {
  const regex = globToRegex(pattern);
  while (Date.now() < deadline) {
    const url = await getCurrentUrl(client, sessionId);
    if (regex.test(url)) return;
    await sleep(POLL_INTERVAL);
  }
  throw new Error(`Timeout waiting for URL matching: ${pattern}`);
}

async function waitForText(
  client: CdpClient,
  sessionId: string,
  text: string,
  deadline: number
): Promise<void> {
  while (Date.now() < deadline) {
    const bodyText = await evaluateJs(client, sessionId, 'document.body?.innerText ?? ""') as string;
    if (bodyText.includes(text)) return;
    await sleep(POLL_INTERVAL);
  }
  throw new Error(`Timeout waiting for text: ${text}`);
}

async function waitForSelector(
  client: CdpClient,
  sessionId: string,
  selector: string,
  deadline: number
): Promise<void> {
  while (Date.now() < deadline) {
    const found = await evaluateJs(
      client,
      sessionId,
      `!!document.querySelector(${JSON.stringify(selector)})`
    ) as boolean;
    if (found) return;
    await sleep(POLL_INTERVAL);
  }
  throw new Error(`Timeout waiting for selector: ${selector}`);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
