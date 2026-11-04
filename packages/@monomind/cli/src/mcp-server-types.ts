/**
 * MCP server option/status types and default configuration.
 * Split out of mcp-server.ts; re-exported from there.
 */

import * as os from 'node:os';
import * as path from 'node:path';

/**
 * MCP Server configuration
 */
export interface MCPServerOptions {
  transport?: 'stdio' | 'http' | 'websocket';
  host?: string;
  port?: number;
  pidFile?: string;
  logFile?: string;
  tools?: string[] | 'all';
  daemonize?: boolean;
  timeout?: number;
}

/**
 * MCP Server status
 */
export interface MCPServerStatus {
  running: boolean;
  pid?: number;
  transport?: string;
  host?: string;
  port?: number;
  uptime?: number;
  tools?: number;
  startedAt?: string;
  health?: {
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  };
}

/**
 * What a running MCP server records about itself next to its PID file, so a
 * separate `mcp status`/`mcp health` process can report the real transport,
 * host and port instead of its own defaults.
 */
export interface McpRuntimeMeta {
  pid: number;
  transport: string;
  host: string;
  port: number;
  startedAt: string;
}

/**
 * Resolve a per-user state directory under $HOME/.monomind. /tmp is shared and
 * world-traversable; placing the PID/log files there made them symlink-
 * attackable (a local attacker pre-creates /tmp/monomind-mcp.pid as a symlink
 * to e.g. ~/.ssh/authorized_keys, then a writeFile clobbers the target).
 */
function getDefaultStateDir(): string {
  const home = os.homedir();
  return path.join(home, '.monomind');
}

export const DEFAULT_OPTIONS: Required<MCPServerOptions> = {
  transport: 'stdio',
  host: 'localhost',
  port: 3000,
  pidFile: path.join(getDefaultStateDir(), 'mcp.pid'),
  logFile: path.join(getDefaultStateDir(), 'mcp.log'),
  tools: 'all',
  daemonize: false,
  timeout: 30000,
};

/**
 * Per-user state file locations the MCP server publishes itself through.
 * `mcp start --daemon` needs them in the *parent* process (to wait for the
 * child's PID and to tell the user where its output went), so they are
 * exposed rather than left buried in DEFAULT_OPTIONS.
 */
export function getDefaultMcpPaths(): { pidFile: string; logFile: string } {
  return { pidFile: DEFAULT_OPTIONS.pidFile, logFile: DEFAULT_OPTIONS.logFile };
}
