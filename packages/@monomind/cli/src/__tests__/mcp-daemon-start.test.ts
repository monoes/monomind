/**
 * Regression tests for issue #267 — `monomind mcp start -t http -p <port> -d`
 * printed a "Status: Running" banner but left no running server behind.
 *
 * Two independent defects produced that symptom:
 *
 *  1. `--daemon` was a pure no-op. The flag was read, forwarded to
 *     MCPServerOptions.daemonize and then never used by anything: the server
 *     was started *in the foreground process*, so `-d` blocked the terminal
 *     instead of backgrounding, and whatever killed the blocked invocation
 *     took the server with it.
 *
 *  2. Even without `-d`, bin/cli.js armed an unref'd 5s force-exit watchdog
 *     once the action resolved. Being unref'd stops it from *holding* the loop
 *     open — it does not stop it from *firing* when something else (the HTTP
 *     listener) keeps the loop alive. Every `mcp start` therefore died exactly
 *     five seconds after printing "MCP Server started"; the watchdog case is
 *     asserted in bin-cli-exit-path.test.ts.
 *
 * These tests cover (1): the daemon launcher must re-exec the CLI as a real
 * detached, unref'd, stdio-redirected child and report that child's PID only
 * after the child has published it in the PID file that `mcp status` reads.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SpawnArgs = [string, string[], Record<string, unknown>];

let spawnCalls: SpawnArgs[] = [];
let spawnImpl: (...args: SpawnArgs) => { pid?: number; unref: () => void };

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: (...args: SpawnArgs) => {
      spawnCalls.push(args);
      return spawnImpl(...args);
    },
  };
});

let home: string;
let originalHome: string | undefined;
let launchMcpDaemon: typeof import('../commands/mcp-daemon.js')['launchMcpDaemon'];
let pidFile: string;

beforeEach(async () => {
  spawnCalls = [];
  home = mkdtempSync(join(tmpdir(), 'monomind-mcp-daemon-'));
  originalHome = process.env.HOME;
  process.env.HOME = home;

  // The default PID/log paths are resolved from os.homedir() at module load,
  // so the modules have to be (re)imported after HOME is redirected.
  vi.resetModules();
  const { getDefaultMcpPaths } = await import('../mcp-server.js');
  pidFile = getDefaultMcpPaths().pidFile;
  launchMcpDaemon = (await import('../commands/mcp-daemon.js')).launchMcpDaemon;

  // Stand in for a healthy child: publish the PID file the way a real
  // `mcp start` child does once its server is up.
  spawnImpl = () => {
    writeFileSync(pidFile, '424242');
    return { pid: 424242, unref: () => {} };
  };
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { force: true, recursive: true });
});

describe('launchMcpDaemon', () => {
  it("re-execs the CLI as a detached, unref'd child with stdio off the terminal", async () => {
    let unrefCalls = 0;
    spawnImpl = () => {
      writeFileSync(pidFile, '424242');
      return {
        pid: 424242,
        unref: () => {
          unrefCalls++;
        },
      };
    };

    await launchMcpDaemon({
      transport: 'http',
      host: 'localhost',
      port: 8123,
      tools: 'all',
      cliEntry: '/opt/monomind/bin/cli.js',
    });

    expect(spawnCalls).toHaveLength(1);
    const [command, args, options] = spawnCalls[0];

    expect(command).toBe(process.execPath);
    expect(args[0]).toBe('/opt/monomind/bin/cli.js');
    expect(args).toContain('mcp');
    expect(args).toContain('start');

    // detached + unref is what actually survives the parent exiting.
    expect(options.detached).toBe(true);
    expect(unrefCalls).toBe(1);

    // Inherited stdio keeps the child tied to the parent's terminal and makes
    // it die with the shell; the child's output belongs in the log file.
    expect(options.stdio).not.toBe('inherit');
    expect(Array.isArray(options.stdio)).toBe(true);
    expect((options.stdio as unknown[])[0]).toBe('ignore');
  });

  it('never passes --daemon down to the child (that would fork forever)', async () => {
    await launchMcpDaemon({
      transport: 'http',
      host: 'localhost',
      port: 8123,
      tools: 'all',
      cliEntry: '/opt/monomind/bin/cli.js',
    });

    const [, args] = spawnCalls[0];
    expect(args).not.toContain('-d');
    expect(args).not.toContain('--daemon');
  });

  it('forwards the transport, host and port the user asked for', async () => {
    await launchMcpDaemon({
      transport: 'websocket',
      host: '127.0.0.1',
      port: 9911,
      tools: 'all',
      cliEntry: '/opt/monomind/bin/cli.js',
    });

    const [, args] = spawnCalls[0];
    expect(args.join(' ')).toContain('--transport websocket');
    expect(args.join(' ')).toContain('--host 127.0.0.1');
    expect(args.join(' ')).toContain('--port 9911');
  });

  it('reports the PID the child published, so `mcp status`/`mcp stop` agree', async () => {
    const handle = await launchMcpDaemon({
      transport: 'http',
      host: 'localhost',
      port: 8123,
      tools: 'all',
      cliEntry: '/opt/monomind/bin/cli.js',
    });

    expect(handle.pid).toBe(424242);
    expect(readFileSync(pidFile, 'utf8').trim()).toBe('424242');
    expect(handle.logFile).toBe(join(home, '.monomind', 'mcp.log'));
  });

  it('fails loudly when the child could not be spawned at all', async () => {
    spawnImpl = () => ({ pid: undefined, unref: () => {} });

    await expect(
      launchMcpDaemon({
        transport: 'http',
        host: 'localhost',
        port: 8123,
        tools: 'all',
        cliEntry: '/opt/monomind/bin/cli.js',
      }),
    ).rejects.toThrow(/daemon/i);
  });
});
