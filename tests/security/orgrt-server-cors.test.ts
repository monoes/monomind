/**
 * SEC-3 — Strict CORS + DNS-rebinding defence on the org server.
 *
 * Before fix: `Access-Control-Allow-Origin: '*'` on the SSE stream plus
 * no Host-header check. The server binds to 127.0.0.1 but, unlike the
 * main dashboard (`ui/server.mjs:1356-1373`), performs no Origin or
 * Host filtering — a malicious website visited by the operator could
 * read authenticated SSE events via DNS-rebinding.
 *
 * After fix: Host must be in `{localhost, 127.0.0.1, ::1}` (overridable
 * via MONOMIND_ORG_SERVER_ALLOWED_HOSTS); ACAO is only emitted when the
 * request Origin matches the server's own loopback origin.
 *
 * Probe: send `Origin: http://evil.com` → no ACAO header (or 403 if the
 * Host check fails too). Send `Origin: http://localhost:<port>` → ACAO
 * reflected. Send a non-loopback Host → 403 regardless of cred.
 */

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startOrgServer } from '../../packages/@monomind/cli/src/orgrt/server.js';

interface Spawned {
  close: () => void;
}
const spawned: Spawned[] = [];

// Pass port 0 so the OS assigns a free ephemeral port atomically at bind
// time. A separate "find a free port, close it, rebind to that number"
// step (the previous approach) has a TOCTOU race — another test or
// process can grab the port in the gap — which surfaced as sporadic
// EADDRINUSE failures.
async function startServer(): Promise<Awaited<ReturnType<typeof startOrgServer>>> {
  const srv = await startOrgServer(stubDaemon(), 0, 'sekret');
  spawned.push(srv);
  return srv;
}

const stubDaemon = () =>
  ({
    getStatusSnapshot: () => ({ orgs: [] }),
  }) as unknown as Parameters<typeof startOrgServer>[0];

afterEach(() => {
  for (const s of spawned) {
    try {
      s.close();
    } catch {
      /* best effort */
    }
  }
  spawned.length = 0;
});

function get(
  port: number,
  headers: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { port, host: '127.0.0.1', path: '/api/status', method: 'GET', headers },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      },
    );
    r.on('error', reject);
    r.end();
  });
}

// /api/events is the only endpoint that ever emitted ACAO (`*` pre-fix,
// allow-listed post-fix). It's an SSE stream — open it, read headers,
// then abort the connection so the test doesn't hang on the stream.
function getEvents(
  port: number,
  headers: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, _reject) => {
    const r = http.request(
      { port, host: '127.0.0.1', path: '/api/events', method: 'GET', headers },
      (res) => {
        // Capture headers immediately, then destroy the socket so the SSE
        // stream doesn't keep the test alive.
        const captured = { status: res.statusCode ?? 0, headers: res.headers };
        res.destroy();
        resolve(captured);
      },
    );
    r.on('error', () => {
      // ECONNRESET is expected because we destroy the response above.
      // Headers were already captured in the success branch; this branch
      // only fires for connection-level errors.
    });
    r.end();
  });
}

describe('SEC-3 — org server strict CORS + Host check', () => {
  it('does NOT reflect Access-Control-Allow-Origin for a foreign origin', async () => {
    const srv = await startServer();
    const port = srv.port;
    const r = await getEvents(port, {
      'x-monomind-cred': 'sekret',
      origin: 'http://evil.com',
      host: `localhost:${port}`,
    });
    expect(r.status).toBe(200);
    // Header must be absent (NOT '*' and NOT 'http://evil.com').
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("reflects ACAO for the server's own loopback origin (localhost)", async () => {
    const srv = await startServer();
    const port = srv.port;
    const r = await getEvents(port, {
      'x-monomind-cred': 'sekret',
      origin: `http://localhost:${port}`,
      host: `localhost:${port}`,
    });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe(`http://localhost:${port}`);
  });

  it("reflects ACAO for the server's own loopback origin (127.0.0.1)", async () => {
    const srv = await startServer();
    const port = srv.port;
    const r = await getEvents(port, {
      'x-monomind-cred': 'sekret',
      origin: `http://127.0.0.1:${port}`,
      host: `127.0.0.1:${port}`,
    });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe(`http://127.0.0.1:${port}`);
  });

  it('rejects requests with a non-loopback Host header (DNS-rebinding defence)', async () => {
    const srv = await startServer();
    const port = srv.port;
    // Even with the correct cred, a foreign Host must be rejected before
    // any auth logic runs.
    const r = await get(port, {
      'x-monomind-cred': 'sekret',
      host: 'evil.com',
    });
    expect(r.status).toBe(403);
  });

  it('rejects requests with an attacker-controlled subdomain Host', async () => {
    const srv = await startServer();
    const port = srv.port;
    const r = await get(port, {
      'x-monomind-cred': 'sekret',
      host: `evil.localhost:${port}`,
    });
    expect(r.status).toBe(403);
  });

  it('omits ACAO when no Origin header is present (no echo)', async () => {
    const srv = await startServer();
    const port = srv.port;
    const r = await getEvents(port, {
      'x-monomind-cred': 'sekret',
      host: `localhost:${port}`,
    });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Host check fires before the auth gate (403 not 401 for bad Host + bad cred)', async () => {
    const srv = await startServer();
    const port = srv.port;
    const r = await get(port, {
      'x-monomind-cred': 'wrong',
      host: 'evil.com',
    });
    expect(r.status).toBe(403);
  });
});
