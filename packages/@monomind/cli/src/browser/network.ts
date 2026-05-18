import type { CdpClient } from './cdp.js';
import type { CdpCookie, NetworkRoute } from './types.js';

export async function getCookies(client: CdpClient, sessionId: string): Promise<CdpCookie[]> {
  const result = await client.send<{ cookies: CdpCookie[] }>('Network.getAllCookies', {}, sessionId);
  return result.cookies ?? [];
}

export async function setCookies(client: CdpClient, sessionId: string, cookies: CdpCookie[]): Promise<void> {
  await client.send('Network.setCookies', { cookies }, sessionId);
}

export async function clearCookies(client: CdpClient, sessionId: string): Promise<void> {
  await client.send('Network.clearBrowserCookies', {}, sessionId);
}

export async function setExtraHeaders(
  client: CdpClient,
  sessionId: string,
  headers: Record<string, string>
): Promise<void> {
  await client.send('Network.setExtraHTTPHeaders', { headers }, sessionId);
}

export async function enableInterception(client: CdpClient, sessionId: string): Promise<void> {
  await client.send('Fetch.enable', {
    patterns: [{ requestStage: 'Request' }],
  }, sessionId);
}

const _routeListeners = new Map<string, () => void>();

export async function setupRoutes(
  client: CdpClient,
  sessionId: string,
  routes: NetworkRoute[]
): Promise<void> {
  // Remove previous route listener for this session before registering a new one
  const prevOff = _routeListeners.get(sessionId);
  if (prevOff) { prevOff(); _routeListeners.delete(sessionId); }

  if (routes.length === 0) {
    await client.send('Fetch.disable', {}, sessionId).catch(() => {});
    return;
  }

  // Pre-compile route regexes once — avoids creating new RegExp on every paused request
  const compiledRoutes = routes.map((r) => ({ route: r, regex: globToRegex(r.pattern) }));

  // Register listener BEFORE Fetch.enable to avoid race where Chrome emits
  // Fetch.requestPaused before the handler is in place, leaving requests hung
  const off = client.on('Fetch.requestPaused', async (params, sid) => {
    if (sid !== sessionId) return;

    const { requestId, request } = params as { requestId: string; request: { url: string } };
    try {
      const matchedRoute = compiledRoutes.find((e) => e.regex.test(request.url))?.route;

      if (!matchedRoute) {
        await client.send('Fetch.continueRequest', { requestId }, sessionId);
        return;
      }

      switch (matchedRoute.action) {
        case 'abort':
          await client.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }, sessionId);
          break;
        case 'fulfill':
          await client.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: matchedRoute.response?.status ?? 200,
            responseHeaders: Object.entries(matchedRoute.response?.headers ?? {}).map(([name, value]) => ({ name, value })),
            body: matchedRoute.response?.body ? Buffer.from(matchedRoute.response.body).toString('base64') : '',
          }, sessionId);
          break;
        case 'continue':
        default:
          await client.send('Fetch.continueRequest', { requestId }, sessionId);
          break;
      }
    } catch {
      // Best-effort: resume the request so it doesn't hang in Chrome
      await client.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
    }
  });
  _routeListeners.set(sessionId, off);

  await client.send('Fetch.enable', {
    patterns: routes.map((r) => ({ urlPattern: globToFetchPattern(r.pattern), requestStage: 'Request' })),
  }, sessionId);
}

type CapturedRequest = {
  id: string; url: string; method: string; status?: number; mimeType?: string;
  requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string>;
  startTime: number; endTime?: number; encodedSize?: number;
};

const _capturedRequests = new Map<string, Map<string, CapturedRequest>>();

const _captureListeners = new Map<string, Array<() => void>>();

export function startRequestCapture(client: CdpClient, sessionId: string): void {
  stopRequestCapture(sessionId);
  _capturedRequests.set(sessionId, new Map<string, CapturedRequest>());
  client.send('Network.enable', {}, sessionId).catch(() => {});

  // Use indirection so clearCapturedRequests (which replaces the Map) affects live listeners
  const idx = () => _capturedRequests.get(sessionId)!;

  const offReq = client.on('Network.requestWillBeSent', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as { requestId: string; request: { url: string; method: string; headers: Record<string, string> }; timestamp: number };
    idx().set(p.requestId, { id: p.requestId, url: p.request.url, method: p.request.method, requestHeaders: p.request.headers, startTime: p.timestamp * 1000 });
  });

  const offResp = client.on('Network.responseReceived', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as { requestId: string; response: { status: number; mimeType: string; headers: Record<string, string> }; timestamp: number };
    const entry = idx().get(p.requestId);
    if (entry) { entry.status = p.response.status; entry.mimeType = p.response.mimeType; entry.responseHeaders = p.response.headers; entry.endTime = p.timestamp * 1000; }
  });

  const offFinished = client.on('Network.loadingFinished', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as { requestId: string; encodedDataLength: number; timestamp: number };
    const entry = idx().get(p.requestId);
    if (entry) { entry.encodedSize = p.encodedDataLength; entry.endTime = p.timestamp * 1000; }
  });

  const offFailed = client.on('Network.loadingFailed', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as { requestId: string; timestamp: number };
    const entry = idx().get(p.requestId);
    if (entry) { entry.endTime = p.timestamp * 1000; }
  });

  _captureListeners.set(sessionId, [offReq, offResp, offFinished, offFailed]);
}

export function stopRequestCapture(sessionId: string): void {
  const offs = _captureListeners.get(sessionId);
  if (offs) { for (const off of offs) off(); _captureListeners.delete(sessionId); }
  _capturedRequests.delete(sessionId);
}

export function getCapturedRequests(sessionId: string): CapturedRequest[] {
  return [...(_capturedRequests.get(sessionId)?.values() ?? [])];
}

export function clearCapturedRequests(sessionId: string): void {
  _capturedRequests.set(sessionId, new Map());
}

export async function disableInterception(client: CdpClient, sessionId: string): Promise<void> {
  const prevOff = _routeListeners.get(sessionId);
  if (prevOff) { prevOff(); _routeListeners.delete(sessionId); }
  await client.send('Fetch.disable', {}, sessionId);
}

export function teardownRouteInterception(sessionId: string): void {
  const prevOff = _routeListeners.get(sessionId);
  if (prevOff) { prevOff(); _routeListeners.delete(sessionId); }
}

export async function getLocalStorage(client: CdpClient, sessionId: string): Promise<Record<string, string>> {
  const result = await client.send<{ result: { value?: string }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', {
    expression: 'JSON.stringify(Object.fromEntries(Object.entries(localStorage)))',
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) return {};
  try {
    return JSON.parse(result.result?.value ?? '{}');
  } catch {
    return {};
  }
}

export async function setLocalStorage(
  client: CdpClient,
  sessionId: string,
  data: Record<string, string>
): Promise<void> {
  const script = Object.entries(data)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
    .join('; ');
  if (script) {
    const result = await client.send<{
      result: unknown;
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression: script, returnByValue: true }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(`setLocalStorage failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
  }
}

export async function getSessionStorage(client: CdpClient, sessionId: string): Promise<Record<string, string>> {
  const result = await client.send<{ result: { value?: string }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', {
    expression: 'JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))',
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) return {};
  try {
    return JSON.parse(result.result?.value ?? '{}');
  } catch {
    return {};
  }
}

export async function setSessionStorage(
  client: CdpClient,
  sessionId: string,
  data: Record<string, string>
): Promise<void> {
  const script = Object.entries(data)
    .map(([k, v]) => `sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
    .join('; ');
  if (script) {
    const result = await client.send<{
      result: unknown;
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression: script, returnByValue: true }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(`setSessionStorage failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
  }
}

function globToRegex(pattern: string): RegExp {
  // Chrome's Fetch urlPattern treats '*' as matching everything including '/'
  // and '?' as any single character — match both behaviors here to avoid divergence
  const escaped = pattern
    .replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function globToFetchPattern(pattern: string): string {
  return pattern.replace(/\*\*/g, '*');
}
