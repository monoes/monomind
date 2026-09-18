/**
 * Detached launch for `monomind mcp start --daemon` (issue #267).
 *
 * `--daemon` used to be read, forwarded to MCPServerOptions.daemonize and then
 * ignored by every code path that could have acted on it: the server was
 * started in the foreground process, so `-d` blocked the terminal and the
 * server died with whatever eventually killed that blocked invocation.
 *
 * Backgrounding is done the only way that actually outlives the parent: re-exec
 * the CLI as a `detached` child with its stdio pointed at a log file instead of
 * the terminal, unref it, and let the child publish its own PID through the
 * same PID file `mcp status`/`mcp stop` read.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getDefaultMcpPaths } from '../mcp-server.js';

export interface McpDaemonOptions {
  transport: 'stdio' | 'http' | 'websocket';
  host: string;
  port: number;
  /** Comma-separated tool list, or 'all'. */
  tools: string;
  /** CLI entrypoint to re-exec. Defaults to the running one. */
  cliEntry?: string;
}

export interface McpDaemonHandle {
  /** PID of the detached server process, as published in the PID file. */
  pid: number;
  /** Where the daemon's stdout/stderr were redirected. */
  logFile: string;
}

/** How long to wait for the child to publish its PID before giving up. */
const READY_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True once the child has written *its own* PID to the shared PID file. */
function hasPublishedPid(pidFile: string, pid: number): boolean {
  try {
    return fs.readFileSync(pidFile, 'utf8').trim() === String(pid);
  } catch {
    return false;
  }
}

export async function launchMcpDaemon(options: McpDaemonOptions): Promise<McpDaemonHandle> {
  const { pidFile, logFile } = getDefaultMcpPaths();

  await fs.promises.mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 });
  const logFd = fs.openSync(logFile, 'a', 0o600);

  // Deliberately without --daemon: the child is the server, and passing the
  // flag back down would make it spawn another daemon, forever.
  const args = [
    options.cliEntry ?? process.argv[1],
    'mcp',
    'start',
    '--transport',
    options.transport,
    '--host',
    options.host,
    '--port',
    String(options.port),
  ];
  if (options.tools && options.tools !== 'all') {
    args.push('--tools', options.tools);
  }

  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      // 'ignore' for stdin and the log fd for output: inheriting the terminal
      // would tie the daemon to the shell that started it.
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();

    if (!child.pid) {
      throw new Error(`Failed to spawn MCP daemon process (see ${logFile})`);
    }

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (hasPublishedPid(pidFile, child.pid)) {
        return { pid: child.pid, logFile };
      }
      if (!isAlive(child.pid)) {
        throw new Error(`MCP daemon exited before it started listening (see ${logFile})`);
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new Error(
      `MCP daemon did not report ready within ${READY_TIMEOUT_MS}ms (see ${logFile})`,
    );
  } finally {
    fs.closeSync(logFd);
  }
}
