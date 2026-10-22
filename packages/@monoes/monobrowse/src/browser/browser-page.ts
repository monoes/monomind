// Split out of browser.ts (file-size sweep). Pure move: no behaviour change.

import { CdpClient, fetchNewTarget, fetchTargets } from './cdp.js';
import { enableConsoleCapture, setupConsoleCapture } from './console-log.js';
import { setupDialogAutoHandling } from './dialog.js';
import type { CdpTarget } from './types.js';

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

export async function connectToTarget(
  port: number,
  targetId?: string,
): Promise<{ client: CdpClient; target: CdpTarget; sessionId: string }> {
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

export async function openUrl(client: CdpClient, sessionId: string, url: string): Promise<void> {
  // Cap to 2 MB to prevent OOM in CDP message serializer (e.g. data: URI attacks)
  if (url.length > 2_097_152) throw new Error('URL exceeds 2 MB limit');
  // Page.navigate reports a protocol-level failure (e.g. a refused connection)
  // via errorText in its own response, before Chrome ever settles on the
  // chrome-error://chromewebdata/ page — without this check a refused
  // connection previously reported success against that error page.
  const nav = await client.send<{ errorText?: string }>('Page.navigate', { url }, sessionId);
  if (nav.errorText) throw new Error(`Navigation to ${url} failed: ${nav.errorText}`);
  await waitForLoad(client, sessionId, 'load', 30_000);
  // Best-effort settle for SPAs that keep fetching after `load`. A page holding
  // an SSE/long-poll connection (e.g. the monomind dashboard) never goes idle,
  // so a timeout here is not a failure (#670).
  await waitForNetworkIdle(client, sessionId, 500, 5_000).catch(() => undefined);
}

export async function waitForLoad(
  client: CdpClient,
  sessionId: string,
  condition: 'load' | 'networkidle' | 'domcontentloaded' = 'load',
  timeout = 30_000,
): Promise<void> {
  if (condition === 'load' || condition === 'domcontentloaded') {
    // Guard against race where the page loads before the listener is registered
    const readyExpr =
      condition === 'load'
        ? 'document.readyState === "complete"'
        : 'document.readyState !== "loading"';
    const readyCheck = await client
      .send<{ result: { value?: boolean } }>(
        'Runtime.evaluate',
        {
          expression: readyExpr,
          returnByValue: true,
        },
        sessionId,
      )
      .catch(() => ({ result: { value: false } }));
    if (readyCheck.result?.value) return;

    const event = condition === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired';
    const [eventPromise, cancelOnce] = client.onceWithOff(event, sessionId);
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeout);
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
  timeout: number,
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
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      clearTimeout(killTimer);
      offReq();
      offResp();
      offFail();
      offCache();
      offResp2();
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
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      }
    };

    const offReq = client.on('Network.requestWillBeSent', (params, sid) => {
      if (sid !== sessionId) return;
      const id = params.requestId as string;
      if (!inflight.has(id)) {
        inflight.add(id);
        pending++;
        check();
      }
    });

    const decrement = (params: Record<string, unknown>, sid?: string) => {
      if (sid !== sessionId) return;
      const id = params.requestId as string;
      if (inflight.delete(id)) {
        pending = Math.max(0, pending - 1);
        check();
      }
    };

    const offResp = client.on('Network.loadingFinished', decrement);
    const offFail = client.on('Network.loadingFailed', decrement);
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
  const result = await client.send<{ result: { value: string } }>(
    'Runtime.evaluate',
    {
      expression: 'location.href',
      returnByValue: true,
    },
    sessionId,
  );
  return result.result?.value ?? '';
}

export async function getCurrentTitle(client: CdpClient, sessionId: string): Promise<string> {
  const result = await client.send<{ result: { value: string } }>(
    'Runtime.evaluate',
    {
      expression: 'document.title',
      returnByValue: true,
    },
    sessionId,
  );
  return result.result?.value ?? '';
}
