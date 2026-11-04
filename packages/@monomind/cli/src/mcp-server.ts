/**
 * CLI MCP Server Management
 *
 * Provides server lifecycle management for MCP integration:
 * - Start/stop/status methods with process management
 * - Health check endpoint integration
 * - Graceful shutdown handling
 * - PID file management for daemon detection
 * - Event-based status monitoring
 *
 * Performance Targets:
 * - Server startup: <400ms
 * - Health check: <10ms
 * - Graceful shutdown: <5s
 *
 * @module @monomind/cli/mcp-server
 * @version 3.0.0
 */

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { startHttpTransport } from './mcp-http-server.js';
import {
  httpRequest,
  isProcessRunning,
  readPidFile,
  readRuntimeMeta,
  removePidFile,
  signalDetachedServer,
  writePidFile,
} from './mcp-server-process.js';
import {
  DEFAULT_OPTIONS,
  type MCPServerOptions,
  type MCPServerStatus,
} from './mcp-server-types.js';
import { runStdioServer } from './mcp-stdio-server.js';

export type { MCPServerOptions, MCPServerStatus } from './mcp-server-types.js';
export { getDefaultMcpPaths } from './mcp-server-types.js';

let standaloneStdioServerStarted = false;

/** Register the standalone stdio entry point after it installs its input loop. */
export function registerStandaloneStdioServer(): void {
  standaloneStdioServerStarted = true;
}

/**
 * MCP Server Manager
 *
 * Manages the lifecycle of the MCP server process
 */
export class MCPServerManager extends EventEmitter {
  private options: Required<MCPServerOptions>;
  private process?: ChildProcess;
  private server?: http.Server;
  private startTime?: Date;
  private _stdioServerStarted = false;
  private healthCheckInterval?: NodeJS.Timeout;
  /**
   * Reference to the underlying @monoes/mcp server when the HTTP/WS transport
   * is in use. Stored so stop() can close it gracefully. Typed loosely because
   * @monoes/mcp is an optional peer resolved at runtime (see vendor.d.ts).
   */
  private _mcpServer?: { close(): Promise<void> };

  constructor(options: MCPServerOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<MCPServerStatus> {
    // Check if already running (skip if status reports our own PID —
    // getStatus() returns running=true for the current process in stdio mode
    // even before the server is actually started)
    const status = await this.getStatus();
    if (status.running && status.pid !== process.pid) {
      throw new Error(`MCP Server already running (PID: ${status.pid})`);
    }

    const startTime = performance.now();
    this.startTime = new Date();

    this.emit('starting', { options: this.options });

    try {
      if (this.options.transport === 'stdio') {
        // For stdio transport, spawn the server process
        await this.startStdioServer();
      } else {
        // For HTTP/WebSocket, start in-process server
        await this.startHttpServer();
      }

      const duration = performance.now() - startTime;

      // Write PID file
      await this.writePidFile();

      // Start health check monitoring
      this.startHealthMonitoring();

      const finalStatus = await this.getStatus();

      this.emit('started', {
        ...finalStatus,
        startupTime: duration,
      });

      return finalStatus;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(force = false): Promise<void> {
    const status = await this.getStatus();

    if (!status.running) {
      return;
    }

    this.emit('stopping', { force });

    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      if (this.process) {
        // Graceful shutdown
        if (!force) {
          this.process.kill('SIGTERM');
          await this.waitForExit(5000);
        }

        // Force kill if still running
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }

        this.process = undefined;
      } else if (status.pid && status.pid !== process.pid) {
        // A daemonized server (`mcp start --daemon`) runs in a process this
        // manager never spawned, so there is no ChildProcess handle — only the
        // PID it published. Without this, stop() merely deleted the PID file
        // and left the daemon running and unreachable.
        await this.signalDetachedServer(status.pid, force);
      }

      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server?.close(() => resolve());
        });
        this.server = undefined;
      }

      if (this._mcpServer) {
        try {
          await this._mcpServer.close();
        } catch {
          /* ignore */
        }
        this._mcpServer = undefined;
      }

      // Remove PID file
      await this.removePidFile();

      this.startTime = undefined;
      this.emit('stopped');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get server status
   */
  async getStatus(): Promise<MCPServerStatus> {
    // An active stdio loop in this process is authoritative even if a
    // different managed server left a PID file behind.
    if (standaloneStdioServerStarted || this._stdioServerStarted) {
      return {
        running: true,
        pid: process.pid,
        transport: 'stdio',
        startedAt: this.startTime?.toISOString(),
        uptime: this.startTime
          ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
          : undefined,
      };
    }

    // A transport setting or non-TTY stdin only describes configuration.
    // Outside an active stdio loop, check the managed server's PID file.
    const pid = await this.readPidFile();
    if (!pid) return { running: false };

    // Check if process is running
    const isRunning = this.isProcessRunning(pid);

    if (!isRunning) {
      // Clean up stale PID file
      await this.removePidFile();
      return { running: false };
    }

    // Report what the *running* server was started with. `this.options` is
    // only right when this manager started it; a separate `mcp status`
    // invocation constructs a manager from DEFAULT_OPTIONS, which is why the
    // transport column always read "stdio" (issue #268).
    const meta = await this.readRuntimeMeta();
    const transport = meta?.transport ?? this.options.transport;
    const startedAt = this.startTime?.toISOString() ?? meta?.startedAt;

    const status: MCPServerStatus = {
      running: true,
      pid,
      transport,
      host: meta?.host ?? this.options.host,
      port: meta?.port ?? this.options.port,
      startedAt,
      uptime: startedAt
        ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
        : undefined,
    };

    // Get health status for HTTP transport
    if (transport !== 'stdio') {
      status.health = await this.checkHealth({
        transport,
        host: status.host,
        port: status.port,
      });
    }

    return status;
  }

  /**
   * Check server health.
   *
   * `target` overrides the configured transport/host/port so getStatus() can
   * probe the server that is *actually* running (recorded next to the PID
   * file) rather than this manager's defaults.
   */
  async checkHealth(target?: { transport?: string; host?: string; port?: number }): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    const transport = target?.transport ?? this.options.transport;
    const host = target?.host ?? this.options.host;
    const port = target?.port ?? this.options.port;

    if (transport === 'stdio') {
      // For stdio, check if process is running
      const pid = await this.readPidFile();
      if (pid === null) {
        return { healthy: false, error: 'No PID file found' };
      }
      if (!this.isProcessRunning(pid)) {
        // Clean up stale PID file
        await this.removePidFile();
        return { healthy: false, error: 'Process not running (cleaned up stale PID)' };
      }
      return { healthy: true };
    }

    // For HTTP/WebSocket, make health check request
    try {
      const response = await this.httpRequest(
        `http://${host}:${port}/health`,
        'GET',
        this.options.timeout,
      );

      return {
        healthy: response.status === 'ok',
        metrics: {
          connections: response.connections || 0,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Restart the server
   */
  async restart(): Promise<MCPServerStatus> {
    await this.stop();
    return await this.start();
  }

  /**
   * Start stdio server in-process
   * Handles stdin/stdout directly like V2 implementation
   */
  private async startStdioServer(): Promise<void> {
    this._stdioServerStarted = true;
    await runStdioServer({
      emit: (event) => this.emit(event),
      clearHealthCheck: () => {
        if (this.healthCheckInterval) {
          clearInterval(this.healthCheckInterval);
          this.healthCheckInterval = undefined;
        }
      },
      removePidFile: () => this.removePidFile(),
    });
  }

  /**
   * Start HTTP server in-process.
   *
   * SECURITY: refuses to bind to non-loopback hosts unless the operator opts
   * in via MONOMIND_MCP_ALLOW_REMOTE=1 AND provides a bearer token via
   * MONOMIND_MCP_TOKEN (enforced in mcp-http-server.ts).
   */
  private async startHttpServer(): Promise<void> {
    this._mcpServer = await startHttpTransport(this.options, (p) => this.emit('log', p));
  }

  private async signalDetachedServer(pid: number, force: boolean): Promise<void> {
    return signalDetachedServer(pid, force);
  }

  /**
   * Wait for process to exit
   */
  private async waitForExit(timeout: number): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, timeout);

      this.process?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        this.emit('health', health);

        if (!health.healthy) {
          this.emit('unhealthy', health);
        }
      } catch (error) {
        this.emit('health-error', error);
      }
    }, 30000);
    this.healthCheckInterval.unref();
  }

  private async writePidFile(): Promise<void> {
    await writePidFile(this.options, this.startTime, this.process?.pid);
  }

  private async readPidFile(): Promise<number | null> {
    return readPidFile(this.options);
  }

  private async removePidFile(): Promise<void> {
    await removePidFile(this.options);
  }

  private async readRuntimeMeta() {
    return readRuntimeMeta(this.options);
  }

  private isProcessRunning(pid: number): boolean {
    return isProcessRunning(pid);
  }

  private async httpRequest(url: string, method: string, timeout: number): Promise<any> {
    return httpRequest(url, method, timeout);
  }
}

/**
 * Create MCP server manager
 */
export function createMCPServerManager(options?: MCPServerOptions): MCPServerManager {
  return new MCPServerManager(options);
}

/**
 * Singleton server manager instance
 */
let serverManager: MCPServerManager | null = null;
let currentTransport: string | undefined;

/**
 * Get or create server manager singleton
 *
 * FIX for issue #942: Recreate singleton if transport type changes
 * Previously, once created with stdio (default), HTTP options were ignored
 */
export function getServerManager(options?: MCPServerOptions): MCPServerManager {
  const requestedTransport = options?.transport;

  // Recreate if transport type changes (fixes HTTP transport not working)
  if (serverManager && requestedTransport && requestedTransport !== currentTransport) {
    serverManager = new MCPServerManager(options);
    currentTransport = requestedTransport;
  }

  if (!serverManager) {
    serverManager = new MCPServerManager(options);
    currentTransport = options?.transport;
  }
  return serverManager;
}

/**
 * Quick start MCP server
 */
export async function startMCPServer(options?: MCPServerOptions): Promise<MCPServerStatus> {
  // Mark as long-lived host so the intelligence/trajectory system stays enabled.
  // In one-shot CLI mode trajectories are discarded on process exit; across
  // MCP calls the registry singleton persists so patterns accumulate correctly.
  process.env.MONOMIND_PERSISTENT_HOST = '1';
  const manager = getServerManager(options);
  return await manager.start();
}

/**
 * Quick stop MCP server
 */
export async function stopMCPServer(force = false): Promise<void> {
  if (serverManager) {
    await serverManager.stop(force);
  }
}

/**
 * Get MCP server status
 */
export async function getMCPServerStatus(): Promise<MCPServerStatus> {
  const manager = getServerManager();
  return await manager.getStatus();
}
