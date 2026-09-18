/**
 * Regression tests for issue #268 — `mcp status` reported `Transport: stdio`
 * for a server that was started with `-t http`.
 *
 * Nothing about the running server was recorded anywhere. The PID file holds a
 * bare PID, and `getStatus()` filled the transport/host/port columns from
 * `this.options` — which, for a *separate* `mcp status` invocation, is just the
 * DEFAULT_OPTIONS the manager was constructed with (stdio/localhost/3000).
 * Liveness detection was correct; every other field in the table was the
 * default rather than the truth, so an http server on port 39472 printed as
 * stdio (and would have printed localhost:3000 for host/port).
 *
 * The fix records the runtime parameters next to the PID file when the server
 * starts and reads them back when reporting status.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MCPServerManager } from '../mcp-server.js';

let dir: string;
let pidFile: string;
let metaFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monomind-mcp-status-'));
  pidFile = join(dir, 'mcp.pid');
  metaFile = join(dir, 'mcp.json');
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/**
 * The liveness probe shells out to /proc and pattern-matches the command line;
 * these tests are about what the *status* reports for a process it believes is
 * alive, so the probe is pinned rather than exercised.
 */
function pinLiveness(manager: MCPServerManager, alive: boolean): void {
  (manager as unknown as { isProcessRunning: (pid: number) => boolean }).isProcessRunning = () =>
    alive;
}

/** writePidFile is private; the round trip it feeds is the behaviour under test. */
function publishPidFile(manager: MCPServerManager): Promise<void> {
  return (manager as unknown as { writePidFile: () => Promise<void> }).writePidFile();
}

describe('mcp status transport reporting', () => {
  it('reports the transport the running server was started with, not the default', async () => {
    const server = new MCPServerManager({
      pidFile,
      transport: 'http',
      host: '127.0.0.1',
      port: 41234,
    });
    await publishPidFile(server);

    // A separate `mcp status` process: constructed with no options at all, so
    // its own transport/host/port are the stdio defaults.
    const status = new MCPServerManager({ pidFile });
    pinLiveness(status, true);

    const reported = await status.getStatus();

    expect(reported.running).toBe(true);
    expect(reported.transport).toBe('http');
    expect(reported.host).toBe('127.0.0.1');
    expect(reported.port).toBe(41234);
  });

  it('records the runtime parameters alongside the PID file', async () => {
    const server = new MCPServerManager({
      pidFile,
      transport: 'websocket',
      host: 'localhost',
      port: 9191,
    });
    await publishPidFile(server);

    expect(readFileSync(pidFile, 'utf8').trim()).toBe(String(process.pid));
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    expect(meta).toMatchObject({
      pid: process.pid,
      transport: 'websocket',
      host: 'localhost',
      port: 9191,
    });
    expect(typeof meta.startedAt).toBe('string');
  });

  it('falls back to the configured transport when no metadata was recorded', async () => {
    // PID file written by an older version, or by a server started before the
    // metadata existed — status must still work, just without the extra truth.
    writeFileSync(pidFile, String(process.pid));

    const status = new MCPServerManager({ pidFile });
    pinLiveness(status, true);

    const reported = await status.getStatus();

    expect(reported.running).toBe(true);
    expect(reported.transport).toBe('stdio');
  });

  it('cleans the metadata up with the PID file when the server is gone', async () => {
    const server = new MCPServerManager({ pidFile, transport: 'http', port: 41234 });
    await publishPidFile(server);
    expect(existsSync(metaFile)).toBe(true);

    const status = new MCPServerManager({ pidFile });
    pinLiveness(status, false);

    expect((await status.getStatus()).running).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
    expect(existsSync(metaFile)).toBe(false);
  });
});
