/**
 * PID file, runtime-meta sidecar, process probing and health-request helpers
 * for MCPServerManager. Split out of mcp-server.ts; each takes the state it
 * needs explicitly instead of reading `this`.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { isMonomindMcpServer } from './mcp-pid-owner.js';
import type { MCPServerOptions, McpRuntimeMeta } from './mcp-server-types.js';

type PidOptions = Required<MCPServerOptions>;

/**
 * Path of the sidecar that records *how* the running server was started.
 * The PID file itself must stay a bare PID — external tooling reads it.
 */
export function metaFilePath(pidFile: string): string {
  return `${pidFile.replace(/\.pid$/, '')}.json`;
}

export async function writePidFile(
  options: PidOptions,
  startTime: Date | undefined,
  childPid: number | undefined,
): Promise<void> {
  const pid = childPid || process.pid;
  // Ensure the state dir exists (user-private, not /tmp)
  const dir = path.dirname(options.pidFile);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  // wx flag = O_CREAT | O_EXCL: fails fast on a pre-existing path including
  // a symlinked one, so we never follow an attacker-staged link to write
  // PIDs into ~/.ssh/authorized_keys or similar.
  try {
    await fs.promises.writeFile(options.pidFile, String(pid), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      // Stale PID file (the existence-check + isProcessRunning gate above
      // already passed, so the file belongs to a dead daemon). Replace it
      // by unlinking-then-creating with O_EXCL again — never write through
      // an existing path that might be a symlink.
      await fs.promises.unlink(options.pidFile);
      await fs.promises.writeFile(options.pidFile, String(pid), { flag: 'wx', mode: 0o600 });
    } else {
      throw e;
    }
  }

  await writeRuntimeMeta(options, startTime, pid);
}

/** Record the runtime parameters `mcp status`/`mcp health` report back. */
export async function writeRuntimeMeta(
  options: PidOptions,
  startTime: Date | undefined,
  pid: number,
): Promise<void> {
  const meta: McpRuntimeMeta = {
    pid,
    transport: options.transport,
    host: options.host,
    port: options.port,
    startedAt: (startTime ?? new Date()).toISOString(),
  };
  try {
    await fs.promises.writeFile(metaFilePath(options.pidFile), JSON.stringify(meta), {
      mode: 0o600,
    });
  } catch {
    // Best-effort: a missing sidecar only costs status its extra detail,
    // it must never fail an otherwise healthy start.
  }
}

/** Read back the sidecar, if the running server left one. */
export async function readRuntimeMeta(options: PidOptions): Promise<McpRuntimeMeta | null> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(metaFilePath(options.pidFile), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as McpRuntimeMeta) : null;
  } catch {
    return null;
  }
}

/**
 * Read PID file
 */
export async function readPidFile(options: PidOptions): Promise<number | null> {
  try {
    const content = await fs.promises.readFile(options.pidFile, 'utf8');
    const pid = parseInt(content.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Remove PID file
 */
export async function removePidFile(options: PidOptions): Promise<void> {
  try {
    await fs.promises.unlink(options.pidFile);
  } catch {
    // Ignore errors
  }
  try {
    await fs.promises.unlink(metaFilePath(options.pidFile));
  } catch {
    // Ignore — the sidecar is optional (older servers left none).
  }
  // Also clean up legacy PID file location from older versions
  try {
    const legacyPath = path.join(
      process.env.MONOMIND_CWD || process.cwd(),
      '.monomind',
      'mcp-server.pid',
    );
    if (legacyPath !== options.pidFile) {
      await fs.promises.unlink(legacyPath);
    }
  } catch {
    // Ignore — file may not exist
  }
}

/**
 * Check if process is running AND is a node/monomind process.
 * Plain `kill -0` returns true for any process with the same owner,
 * which causes false positives when the OS recycles the PID.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  // Verify it's actually our MCP server process (guards against PID reuse by
  // an unrelated Node.js program that happened to get the same PID).
  // We require the command line to mention both "node"/"npx" AND "monomind"/"mcp".
  try {
    const cmdline = execSync(
      `cat /proc/${pid}/cmdline 2>/dev/null || ps -p ${pid} -o args= 2>/dev/null`,
      {
        encoding: 'utf8',
        timeout: 1000,
      },
    ).trim();
    const isMonomindMcp =
      (cmdline.includes('node') || cmdline.includes('npx')) &&
      (cmdline.includes('monomind') || cmdline.includes('mcp'));
    return isMonomindMcp;
  } catch {
    // If we can't inspect the process (macOS, Windows, permissions), fall back to kill check
    return true;
  }
}

/**
 * Terminate a detached server process by PID (see stop()). SIGTERM first so
 * the daemon can close connections, escalating to SIGKILL if it outstays the
 * grace period.
 */
export async function signalDetachedServer(pid: number, force: boolean): Promise<void> {
  const GRACE_MS = 5000;
  const POLL_MS = 100;

  // #502 review: never signal a pid from mcp.pid that isn't our server.
  if (!isMonomindMcpServer(pid)) return;
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // Already gone — nothing to wait for.
    return;
  }

  const deadline = Date.now() + GRACE_MS;
  while (Date.now() < deadline && isProcessRunning(pid)) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  if (isProcessRunning(pid) && isMonomindMcpServer(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Raced with the process exiting on its own.
    }
  }
}

/**
 * Make HTTP request
 */
export async function httpRequest(url: string, method: string, timeout: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method,
        timeout,
      },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ status: res.statusCode === 200 ? 'ok' : 'error' });
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}
