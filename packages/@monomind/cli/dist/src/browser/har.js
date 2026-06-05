import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
const _sessions = new Map();
export async function startHarRecording(client, sessionId) {
    if (_sessions.has(sessionId))
        throw new Error('HAR recording already in progress');
    const requests = new Map();
    const startTime = Date.now();
    const startWallMs = startTime;
    let refCdpTs = 0;
    const cdpToWall = (cdpTs) => {
        if (refCdpTs === 0)
            refCdpTs = cdpTs;
        return startWallMs + (cdpTs - refCdpTs) * 1000;
    };
    const offReq = client.on('Network.requestWillBeSent', (params, sid) => {
        if (sid !== sessionId)
            return;
        const p = params;
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
        if (sid !== sessionId)
            return;
        const p = params;
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
        if (sid !== sessionId)
            return;
        const p = params;
        const entry = requests.get(p.requestId);
        if (entry) {
            entry.encodedSize = p.encodedDataLength;
            entry.endTime = cdpToWall(p.timestamp);
        }
    });
    _sessions.set(sessionId, { requests, offReq, offResp, offFinished, startTime, startWallMs });
}
export async function stopHarRecording(client, sessionId, outputPath, captureResponseBodies = false) {
    const state = _sessions.get(sessionId);
    if (!state)
        throw new Error('No active HAR recording for this session');
    state.offReq();
    state.offResp();
    state.offFinished();
    _sessions.delete(sessionId); // remove immediately after detaching listeners to prevent duplicate invocations
    // Optionally fetch response bodies
    if (captureResponseBodies) {
        for (const [reqId, entry] of state.requests.entries()) {
            try {
                const body = await client.send('Network.getResponseBody', { requestId: reqId }, sessionId);
                entry.responseBody = body.body;
                entry.bodyEncoding = body.base64Encoded ? 'base64' : undefined;
                entry.size = body.base64Encoded
                    ? Buffer.byteLength(body.body, 'base64')
                    : Buffer.byteLength(body.body, 'utf8');
            }
            catch {
                // body may not be available for cached/redirected responses
            }
        }
    }
    const har = buildHar(Array.from(state.requests.values()), state.startTime);
    const path = outputPath ?? join(tmpdir(), `monomind-har-${Date.now()}.har`);
    await writeFile(path, JSON.stringify(har, null, 2));
    return path;
}
export function getHarStatus(sessionId) {
    const state = _sessions.get(sessionId);
    return { recording: !!state, requestCount: state?.requests.size ?? 0 };
}
export function getRequests(sessionId) {
    const state = _sessions.get(sessionId);
    return state ? Array.from(state.requests.values()) : [];
}
function buildHar(entries, startTime) {
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
//# sourceMappingURL=har.js.map