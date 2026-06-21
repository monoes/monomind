import type { CdpClient } from './cdp.js';
import { writeFile } from 'fs/promises';
import { join, resolve, relative, isAbsolute } from 'path';
import { tmpdir, homedir } from 'os';

interface HarRequest {
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  mimeType: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  startTime: number;
  endTime: number;
  size: number;
  encodedSize: number;
  fromCache: boolean;
  responseBody?: string;
  bodyEncoding?: 'base64';
}

const MAX_CONCURRENT_SESSIONS = 100;
const MAX_REQUESTS_PER_SESSION = 5_000;

const _sessions = new Map<string, {
  requests: Map<string, Partial<HarRequest>>;
  offReq: () => void;
  offResp: () => void;
  offFinished: () => void;
  startTime: number;
  startWallMs: number;
}>();

/** Validate output path is within cwd or home dir to prevent path traversal. */
function safeOutputPath(p: string): string {
  const resolved = resolve(p);
  const cwd = process.cwd();
  const home = homedir();
  const relCwd = relative(cwd, resolved);
  const relHome = relative(home, resolved);
  if ((!relCwd.startsWith('..') && !isAbsolute(relCwd)) ||
      (!relHome.startsWith('..') && !isAbsolute(relHome))) {
    return resolved;
  }
  // Reject out-of-scope paths — fall back to tmpdir
  return join(tmpdir(), `monomind-har-${Date.now()}.har`);
}

export async function startHarRecording(client: CdpClient, sessionId: string): Promise<void> {
  if (_sessions.has(sessionId)) throw new Error('HAR recording already in progress');
  if (_sessions.size >= MAX_CONCURRENT_SESSIONS) {
    throw new Error(`HAR recording limit reached (max ${MAX_CONCURRENT_SESSIONS} concurrent sessions)`);
  }

  const requests = new Map<string, Partial<HarRequest>>();
  const startTime = Date.now();
  const startWallMs = startTime;
  let refCdpTs = 0;

  const cdpToWall = (cdpTs: number) => {
    if (refCdpTs === 0) refCdpTs = cdpTs;
    return startWallMs + (cdpTs - refCdpTs) * 1000;
  };

  const offReq = client.on('Network.requestWillBeSent', (params, sid) => {
    if (sid !== sessionId) return;
    // Cap to prevent unbounded memory growth on high-traffic pages
    if (requests.size >= MAX_REQUESTS_PER_SESSION) return;
    const p = params as { requestId: string; request: { url: string; method: string; headers: Record<string, string> }; timestamp: number };
    requests.set(p.requestId, {
      id: p.requestId,
      url: p.request.url,
      method: p.request.method,
      requestHeaders: p.request.headers,
      startTime: cdpToWall(p.timestamp),
      fromCache: false,
    });
  });

  const offResp = client.on('Network.responseReceived', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as { requestId: string; response: { url: string; status: number; statusText: string; mimeType: string; headers: Record<string, string>; fromDiskCache: boolean; fromServiceWorker: boolean }; timestamp: number };
    const entry = requests.get(p.requestId);
    if (entry) {
      entry.status = p.response.status;
      entry.statusText = p.response.statusText;
      entry.mimeType = p.response.mimeType;
      entry.responseHeaders = p.response.headers;
      entry.fromCache = p.response.fromDiskCache || p.response.fromServiceWorker;
      entry.endTime = cdpToWall(p.timestamp);
    }
  });

  const offFinished = client.on('Network.loadingFinished', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as { requestId: string; encodedDataLength: number; timestamp: number };
    const entry = requests.get(p.requestId);
    if (entry) {
      entry.encodedSize = p.encodedDataLength;
      entry.endTime = cdpToWall(p.timestamp);
    }
  });

  _sessions.set(sessionId, { requests, offReq, offResp, offFinished, startTime, startWallMs });
}

export async function stopHarRecording(
  client: CdpClient,
  sessionId: string,
  outputPath?: string,
  captureResponseBodies = false
): Promise<string> {
  const state = _sessions.get(sessionId);
  if (!state) throw new Error('No active HAR recording for this session');

  state.offReq();
  state.offResp();
  state.offFinished();
  _sessions.delete(sessionId); // remove immediately after detaching listeners to prevent duplicate invocations

  // Optionally fetch response bodies
  if (captureResponseBodies) {
    for (const [reqId, entry] of state.requests.entries()) {
      try {
        const body = await client.send<{ body: string; base64Encoded: boolean }>(
          'Network.getResponseBody', { requestId: reqId }, sessionId
        );
        entry.responseBody = body.body;
        entry.bodyEncoding = body.base64Encoded ? 'base64' : undefined;
        entry.size = body.base64Encoded
          ? Buffer.byteLength(body.body, 'base64')
          : Buffer.byteLength(body.body, 'utf8');
      } catch {
        // body may not be available for cached/redirected responses
      }
    }
  }

  const har = buildHar(Array.from(state.requests.values()), state.startTime);
  const safePath = outputPath ? safeOutputPath(outputPath) : join(tmpdir(), `monomind-har-${Date.now()}.har`);
  await writeFile(safePath, JSON.stringify(har, null, 2));
  return safePath;
}

export function getHarStatus(sessionId: string): { recording: boolean; requestCount: number } {
  const state = _sessions.get(sessionId);
  return { recording: !!state, requestCount: state?.requests.size ?? 0 };
}

export function getRequests(sessionId: string): Partial<HarRequest>[] {
  const state = _sessions.get(sessionId);
  return state ? Array.from(state.requests.values()) : [];
}

function buildHar(entries: Partial<HarRequest>[], startTime: number) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'monomind browse', version: '1.0.0' },
      pages: [{
        startedDateTime: new Date(startTime).toISOString(),
        id: 'page_1',
        title: '',
        pageTimings: {},
      }],
      entries: entries.map((e) => ({
        startedDateTime: new Date(e.startTime ?? startTime).toISOString(),
        time: (e.endTime ?? e.startTime ?? startTime) - (e.startTime ?? startTime),
        request: {
          method: e.method ?? 'GET',
          url: e.url ?? '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: Object.entries(e.requestHeaders ?? {}).map(([name, value]) => ({ name, value })),
          queryString: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: e.status ?? 0,
          statusText: e.statusText ?? '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: Object.entries(e.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
          content: {
            size: e.size ?? -1,
            mimeType: e.mimeType ?? 'application/octet-stream',
            text: e.responseBody,
            encoding: e.bodyEncoding,
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: e.encodedSize ?? -1,
        },
        cache: {},
        timings: { send: 0, wait: 0, receive: 0 },
      })),
    },
  };
}
