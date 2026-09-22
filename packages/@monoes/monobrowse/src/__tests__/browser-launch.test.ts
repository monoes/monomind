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

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Socket, type Server as TcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getLaunchedPid, getLaunchedUserDataDir, launchBrowser } from '../browser/browser.js';

const BASE = 23470;

let servers: Array<TcpServer | HttpServer> = [];
let sockets: Socket[] = [];

afterEach(async () => {
  // server.close() only stops accepting NEW connections — it waits for
  // already-open ones (the fetches that hung until their AbortSignal fired)
  // to close on their own, which can outlast the test. Destroy explicitly.
  for (const sock of sockets) sock.destroy();
  sockets = [];
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
}, 5000);

/** Bind a bare TCP listener — accepts connections but speaks no HTTP/CDP. */
function occupyNonChrome(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createTcpServer((sock) => {
      sockets.push(sock); /* accept and do nothing — no CDP response */
    });
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => {
      servers.push(s);
      resolve();
    });
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
        res.writeHead(404);
        res.end();
      }
    });
    s.on('connection', (sock) => sockets.push(sock));
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => {
      servers.push(s);
      resolve();
    });
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
    await expect(launchBrowser({ port, strictPort: true })).rejects.toThrow(
      /does not identify as Chrome/,
    );
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
      new RegExp(`Ports ${port}-${port + 9} are all occupied`),
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
    await occupyNonChrome(port); // requested port: occupied, not Chrome
    await occupyChrome(port + 1); // scanned candidate: IS Chrome — must be skipped, not attached
    for (let i = 2; i < 10; i++) await occupyNonChrome(port + i); // remaining candidates: occupied
    await expect(launchBrowser({ port })).rejects.toThrow(
      new RegExp(`Ports ${port}-${port + 9} are all occupied`),
    );
  }, 15000); // generous margin — 10 candidates, each a fast isTcpPortOpen check
});

// A stand-in for the Chrome binary: like real Chrome given
// --remote-debugging-port=0, it binds a kernel-assigned port and only then
// writes that port to <user-data-dir>/DevToolsActivePort.
const FAKE_CHROME = `#!/usr/bin/env node
const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = process.argv.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(req.url === '/json/version' ? JSON.stringify({ Browser: 'Chrome/999.0.0.0' }) : '[]');
});
// Start slower than launchBrowser's first poll, so a stale file is read first.
setTimeout(() => server.listen(0, '127.0.0.1', () => {
  writeFileSync(join(dir, 'DevToolsActivePort'), server.address().port + '\\n/devtools/browser/fake');
}), 600);
`;

describe.skipIf(process.platform === 'win32')(
  'launchBrowser — port 0 (Chrome picks the port)',
  () => {
    it('returns the port its own Chrome reported, never another CDP endpoint', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'monobrowse-port0-'));
      const exe = join(dir, 'fake-chrome.cjs');
      writeFileSync(exe, FAKE_CHROME);
      chmodSync(exe, 0o755);
      const profile = join(dir, 'profile');
      // A Chrome-looking endpoint that is NOT ours, named by a stale
      // DevToolsActivePort left in the profile dir by an earlier run.
      const foreign = BASE + 5;
      const s = createHttpServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(req.url === '/json/version' ? JSON.stringify({ Browser: 'Chrome/1.0' }) : '[]');
      });
      s.on('connection', (sock) => sockets.push(sock));
      await new Promise<void>((resolve) => s.listen(foreign, '127.0.0.1', () => resolve()));
      servers.push(s);
      mkdirSync(profile);
      writeFileSync(join(profile, 'DevToolsActivePort'), `${foreign}\n/devtools/browser/stale`);

      let port: number | undefined;
      try {
        port = await launchBrowser({ port: 0, userDataDir: profile, executablePath: exe });
        expect(port).not.toBe(foreign);
        expect(port).toBeGreaterThan(0);
        expect(getLaunchedPid(port)).toBeTypeOf('number');
      } finally {
        const pid = port === undefined ? undefined : getLaunchedPid(port);
        if (pid) process.kill(pid, 'SIGKILL');
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('refuses port 0 without a dedicated userDataDir', async () => {
      await expect(launchBrowser({ port: 0 })).rejects.toThrow(/requires a dedicated userDataDir/);
    });
  },
);

// A stand-in for the Chrome binary that, unlike FAKE_CHROME above, actually
// binds the FIXED port it is given via --remote-debugging-port (real Chrome,
// launched with no --port flag, always resolves to the same literal default
// port too — see cli/commands.ts's `port` option default). If the bind
// fails (another process already has it), it exits the way real Chrome does
// when a concurrent launch wins the same "free-looking" port: before its
// CDP endpoint ever opens.
const FAKE_CHROME_FIXED_PORT = `#!/usr/bin/env node
const { createServer } = require('node:http');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const port = Number(
  process.argv.find((a) => a.startsWith('--remote-debugging-port=')).slice('--remote-debugging-port='.length),
);
const dir = process.argv.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(req.url === '/json/version' ? JSON.stringify({ Browser: 'Chrome/999.0.0.0' }) : '[]');
});
server.on('error', () => {
  process.exit(21);
});
server.listen(port, '127.0.0.1', () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DevToolsActivePort'), port + '\\n/devtools/browser/fake');
});
`;

describe.skipIf(process.platform === 'win32')(
  'launchBrowser — concurrent launches with no explicit --port (TOCTOU race)',
  () => {
    it('two concurrent launches racing for the same default port both succeed, on different ports and profiles', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'monobrowse-concurrent-'));
      const exe = join(dir, 'fake-chrome.cjs');
      writeFileSync(exe, FAKE_CHROME_FIXED_PORT);
      chmodSync(exe, 0o755);
      // Both calls target the SAME literal port on purpose: that is exactly
      // what two real `monomind browse open` invocations with no --port flag
      // do, since the CLI's `port` option always defaults to the same value
      // whether or not the user passed it (cli/commands.ts:288).
      const port = BASE + 10;

      let ports: number[] = [];
      try {
        ports = await Promise.all([
          launchBrowser({ port, executablePath: exe, launchTimeoutMs: 5000 }),
          launchBrowser({ port, executablePath: exe, launchTimeoutMs: 5000 }),
        ]);
      } finally {
        for (const p of ports) {
          const pid = getLaunchedPid(p);
          if (pid) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              /* already gone */
            }
          }
        }
        rmSync(dir, { recursive: true, force: true });
      }

      expect(ports).toHaveLength(2);
      // The old probe-then-launch race let both calls observe the same
      // candidate as free and spawn Chrome on it — one bind wins, the
      // other's Chrome exits before its CDP endpoint opens and the whole
      // launchBrowser() call rejects. Both resolving at all is the
      // regression check; landing on different ports (rather than one
      // silently adopting the other's browser) proves the scan actually
      // moved on instead of colliding.
      expect(ports[0]).not.toBe(ports[1]);
      const dirs = ports.map((p) => getLaunchedUserDataDir(p));
      expect(dirs[0]).not.toBe(dirs[1]);
      expect(dirs[0]).toBeTruthy();
      expect(dirs[1]).toBeTruthy();
    }, 15000);
  },
);
