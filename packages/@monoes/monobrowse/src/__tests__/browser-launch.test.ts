/**
 * Unit tests for launchBrowser's port-scan/attach decisions (browser.ts).
 * Deliberately scoped to branches reachable WITHOUT spawning a real Chrome —
 * each scenario below resolves via attach or a thrown error before
 * launchBrowser would ever exec a browser binary, so these run fast and
 * don't depend on Chrome being installed in CI.
 *
 * Fixed port range (23470-23479) chosen to avoid colliding with real
 * services; each test binds/tears down its own listeners.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'net';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { launchBrowser } from '../browser/browser.js';

const BASE = 23470;

let servers: Array<TcpServer | HttpServer> = [];
let sockets: Socket[] = [];

afterEach(async () => {
  // server.close() only stops accepting NEW connections — it waits for
  // already-open ones (the fetches that hung until their AbortSignal fired)
  // to close on their own, which can outlast the test. Destroy explicitly.
  for (const sock of sockets) sock.destroy();
  sockets = [];
  await Promise.all(servers.map(s => new Promise<void>(resolve => s.close(() => resolve()))));
  servers = [];
}, 5000);

/** Bind a bare TCP listener — accepts connections but speaks no HTTP/CDP. */
function occupyNonChrome(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createTcpServer(sock => { sockets.push(sock); /* accept and do nothing — no CDP response */ });
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => { servers.push(s); resolve(); });
  });
}

/** Bind an HTTP server that answers /json/version like a real Chrome would. */
function occupyChrome(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer((req, res) => {
      if (req.url === '/json/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ Browser: 'Chrome/999.0.0.0' }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    s.on('connection', sock => sockets.push(sock));
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => { servers.push(s); resolve(); });
  });
}

describe('launchBrowser — port scan/attach decisions', () => {
  it('attaches immediately when the EXACT requested port already identifies as Chrome', async () => {
    const port = BASE + 0;
    await occupyChrome(port);
    await expect(launchBrowser({ port })).resolves.toBe(port);
  });

  it('strictPort: throws immediately on an occupied non-Chrome requested port, never scans', async () => {
    const port = BASE + 1;
    await occupyNonChrome(port);
    await occupyChrome(port + 1); // would succeed if scanning happened — must not be reached
    await expect(launchBrowser({ port, strictPort: true }))
      .rejects.toThrow(/does not identify as Chrome/);
  });

  it('strictPort: attaches on an occupied Chrome requested port (identical to non-strict)', async () => {
    const port = BASE + 2;
    await occupyChrome(port);
    await expect(launchBrowser({ port, strictPort: true })).resolves.toBe(port);
  });

  it('all candidates occupied by non-Chrome processes: throws a clear range error', async () => {
    const port = BASE + 3;
    // Occupy the full 10-port scan window with non-Chrome listeners.
    for (let i = 0; i < 10; i++) await occupyNonChrome(port + i);
    await expect(launchBrowser({ port })).rejects.toThrow(
      new RegExp(`Ports ${port}-${port + 9} are all occupied`)
    );
  }, 15000); // generous margin — 10 candidates, each a fast isTcpPortOpen check

  it('a Chrome instance on a SCANNED (not the originally requested) port is skipped, not attached to', async () => {
    // Security-relevant case: the attach-if-Chrome shortcut must apply only
    // to the exact port the caller asked for. A Chrome instance sitting on a
    // later candidate the caller never named must not be silently attached
    // to — occupied candidates (Chrome or not) beyond the first are simply
    // skipped, so if every candidate is occupied the call still fails even
    // though one of them is an attachable Chrome.
    const port = BASE + 4;
    await occupyNonChrome(port);       // requested port: occupied, not Chrome
    await occupyChrome(port + 1);      // scanned candidate: IS Chrome — must be skipped, not attached
    for (let i = 2; i < 10; i++) await occupyNonChrome(port + i); // remaining candidates: occupied
    await expect(launchBrowser({ port })).rejects.toThrow(
      new RegExp(`Ports ${port}-${port + 9} are all occupied`)
    );
  }, 15000); // generous margin — 10 candidates, each a fast isTcpPortOpen check
});
