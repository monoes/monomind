/**
 * CLI MCP lifecycle subcommands: start, stop, status, restart.
 * Split from mcp.ts.
 *
 * @module @monomind/cli/commands/mcp-lifecycle
 */

import { listMCPTools } from '../mcp-client.js';
import { isMonomindMcpServer } from '../mcp-pid-owner.js';
import { getMCPServerStatus, getServerManager, type MCPServerOptions } from '../mcp-server.js';
import { output } from '../output.js';
import { confirm } from '../prompt.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

/**
 * Format uptime for display
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Start MCP server
export const startCommand: Command = {
  name: 'start',
  description: 'Start MCP server',
  options: [
    {
      name: 'port',
      short: 'p',
      description: 'Server port',
      type: 'number',
      default: 3000,
    },
    {
      // No `short: 'h'` here on purpose: it is the only place in the entire
      // CLI that reassigned '-h', and the parser's buildScopedAliases()
      // deliberately lets a resolved command's own short flags shadow global
      // ones (so subcommands can reuse letters like -t) — which meant
      // `monomind mcp start -h` silently set --host instead of showing help,
      // the universal meaning of -h in virtually every CLI. --host is still
      // available by its long form.
      name: 'host',
      description: 'Server host',
      type: 'string',
      default: 'localhost',
    },
    {
      name: 'transport',
      short: 't',
      description: 'Transport type (stdio, http, websocket)',
      type: 'string',
      default: 'stdio',
      choices: ['stdio', 'http', 'websocket'],
    },
    {
      name: 'tools',
      description: 'Tools to enable (comma-separated or "all")',
      type: 'string',
      default: 'all',
    },
    {
      name: 'daemon',
      short: 'd',
      description: 'Run as background daemon',
      type: 'boolean',
      default: false,
    },
    {
      name: 'force',
      short: 'f',
      description: 'Force restart (kill existing server first)',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'monomind mcp start', description: 'Start with defaults (stdio)' },
    { command: 'monomind mcp start -p 8080 -t http', description: 'Start HTTP server' },
    { command: 'monomind mcp start -d', description: 'Start as daemon' },
    { command: 'monomind mcp start -f', description: 'Force restart (kill existing)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawPort = (ctx.flags.port as number) ?? 3000;
    const port =
      Number.isFinite(rawPort) && rawPort >= 1 && rawPort <= 65535 ? Math.floor(rawPort) : 3000;
    const rawHost = (ctx.flags.host as string) ?? 'localhost';
    // Cap host length and reject control chars to prevent injection
    const host =
      typeof rawHost === 'string' ? rawHost.slice(0, 253).replace(/[\x00-\x1f]/g, '') : 'localhost';
    const transport = (ctx.flags.transport as 'stdio' | 'http' | 'websocket') ?? 'stdio';
    const rawTools = (ctx.flags.tools as string) || 'all';
    // Cap tools string to prevent DoS via oversized comma-separated lists
    const tools = typeof rawTools === 'string' ? rawTools.slice(0, 2000) : 'all';
    const daemon = (ctx.flags.daemon as boolean) ?? false;
    const force = (ctx.flags.force as boolean) ?? false;

    output.writeln();
    output.printInfo('Starting MCP Server...');
    output.writeln();

    // Check if already running (skip self-detection for stdio — getStatus()
    // reports the current process as "running" when transport=stdio and no
    // PID file exists, which would cause us to SIGKILL ourselves)
    const existingStatus = await getMCPServerStatus();
    const isSelfDetected = existingStatus.pid === process.pid;
    if (existingStatus.running && !isSelfDetected) {
      // For stdio transport, always force restart since we can't health check it
      // For other transports, check health unless --force is specified
      const shouldForceRestart = force || transport === 'stdio';

      if (!shouldForceRestart) {
        // Verify the server is actually healthy/responsive
        const manager = getServerManager();
        const health = await manager.checkHealth();

        if (health.healthy) {
          output.printWarning(`MCP Server already running (PID: ${existingStatus.pid})`);
          output.writeln(
            output.dim('Use "monomind mcp stop" to stop the server first, or use --force'),
          );
          return { success: false, exitCode: 1 };
        }
      }

      // Force restart or unresponsive - auto-recover
      output.printWarning(`MCP Server (PID: ${existingStatus.pid}) - restarting...`);
      try {
        // Force kill the existing process
        // #502 review: only a pid whose command line is our MCP server.
        if (existingStatus.pid && isMonomindMcpServer(existingStatus.pid)) {
          try {
            process.kill(existingStatus.pid, 'SIGKILL');
          } catch {
            // Process may already be dead
          }
        }
        const manager = getServerManager();
        await manager.stop();
        output.writeln(output.dim('  Cleaned up existing server'));
      } catch {
        // Continue anyway - the stop/cleanup may partially fail
      }
    }

    // --daemon means "hand the terminal back and leave a server behind", which
    // an in-process server can never do: re-exec ourselves detached instead.
    if (daemon) {
      try {
        const { launchMcpDaemon } = await import('./mcp-daemon.js');
        const handle = await launchMcpDaemon({ transport, host, port, tools });

        output.writeln();
        output.printTable({
          columns: [
            { key: 'property', header: 'Property', width: 15 },
            { key: 'value', header: 'Value', width: 30 },
          ],
          data: [
            { property: 'Server PID', value: handle.pid },
            { property: 'Transport', value: transport },
            { property: 'Host', value: host },
            { property: 'Port', value: port },
            { property: 'Status', value: output.success('Running') },
          ],
        });

        output.writeln();
        output.printSuccess('MCP Server started in background');
        if (transport === 'http') {
          output.writeln(output.dim(`  Health: http://${host}:${port}/health`));
          output.writeln(output.dim(`  RPC: http://${host}:${port}/rpc`));
        } else if (transport === 'websocket') {
          output.writeln(output.dim(`  WebSocket: ws://${host}:${port}/ws`));
        }
        output.writeln(output.dim(`  Logs: ${handle.logFile}`));
        output.writeln(output.dim(`  Stop with: monomind mcp stop`));

        return { success: true, data: { running: true, pid: handle.pid, transport, host, port } };
      } catch (error) {
        output.printError(`Failed to start MCP daemon: ${(error as Error).message}`);
        return { success: false, exitCode: 1 };
      }
    }

    const options: MCPServerOptions = {
      transport,
      host,
      port,
      tools: !tools || tools === 'all' ? 'all' : tools.split(','),
      daemonize: daemon,
    };

    try {
      output.writeln(output.dim('  Initializing server...'));

      const manager = getServerManager(options);

      // Setup event handlers for progress display
      manager.on('starting', () => {
        output.writeln(output.dim('  Loading tool registry...'));
      });

      manager.on('started', (data: any) => {
        output.writeln(output.dim(`  Server started in ${data.startupTime?.toFixed(2) || 0}ms`));
      });

      manager.on('log', (log: { level: string; msg: string; data?: unknown }) => {
        if (ctx.flags.verbose) {
          output.writeln(output.dim(`  [${log.level}] ${log.msg}`));
        }
      });

      // Start the server
      const status = await manager.start();

      let toolsValue: string;
      if (!tools || tools === 'all') {
        // Report the real count of tools that will actually be advertised,
        // rather than a hardcoded figure — this varies with MONOMIND_MCP_FULL
        // and any disabled-tools config.
        const registeredTools = await listMCPTools();
        const enabledCount = registeredTools.filter((t) => t.enabled).length;
        toolsValue = `${enabledCount} enabled`;
      } else {
        toolsValue = `${tools.split(',').length} enabled`;
      }

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 30 },
        ],
        data: [
          { property: 'Server PID', value: status.pid || process.pid },
          { property: 'Transport', value: transport },
          { property: 'Host', value: host },
          { property: 'Port', value: port },
          { property: 'Tools', value: toolsValue },
          { property: 'Status', value: output.success('Running') },
        ],
      });

      output.writeln();
      output.printSuccess('MCP Server started');

      if (transport === 'http') {
        output.writeln(output.dim(`  Health: http://${host}:${port}/health`));
        output.writeln(output.dim(`  RPC: http://${host}:${port}/rpc`));
      } else if (transport === 'websocket') {
        output.writeln(output.dim(`  WebSocket: ws://${host}:${port}/ws`));
      }

      return { success: true, data: status };
    } catch (error) {
      output.printError(`Failed to start MCP server: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Stop MCP server
export const stopCommand: Command = {
  name: 'stop',
  description: 'Stop MCP server',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force stop without graceful shutdown',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force as boolean;

    // Check if server is running
    const status = await getMCPServerStatus();
    if (!status.running) {
      output.printInfo('MCP Server is not running');
      return { success: true };
    }

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Stop MCP server (PID: ${status.pid})?`,
        default: false,
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.printInfo('Stopping MCP Server...');

    try {
      const manager = getServerManager();

      if (!force) {
        output.writeln(output.dim('  Completing pending requests...'));
        output.writeln(output.dim('  Closing connections...'));
      }

      await manager.stop(force);

      output.writeln(output.dim('  Releasing resources...'));
      output.printSuccess('MCP Server stopped');

      return { success: true, data: { stopped: true, force } };
    } catch (error) {
      output.printError(`Failed to stop MCP server: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// MCP status
export const statusCommand: Command = {
  name: 'status',
  description: 'Show MCP server status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      let status = await getMCPServerStatus();

      // If PID-based check says not running, detect stdio mode.
      // SECURITY/CORRECTNESS: must NOT use a TTY heuristic here — any
      // non-interactive invocation (piped, CI, scripted) has
      // `!process.stdin.isTTY === true`, which previously reported
      // "running" even when nothing was actually running. Only the
      // explicit stdio-transport env var counts as a real signal.
      if (!status.running) {
        const envTransport = process.env.MONOMIND_MCP_TRANSPORT;
        if (envTransport === 'stdio') {
          status = {
            running: true,
            pid: process.pid,
            transport: 'stdio',
          };
        }
      }

      if (ctx.flags.format === 'json') {
        output.printJson(status);
        return { success: true, data: status };
      }

      output.writeln();
      output.writeln(output.bold('MCP Server Status'));
      output.writeln();

      if (!status.running) {
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 20 },
            { key: 'value', header: 'Value', width: 20, align: 'right' },
          ],
          data: [{ metric: 'Status', value: output.error('Stopped') }],
        });

        output.writeln();
        output.writeln(output.dim('Run "monomind mcp start" to start the server'));
        return { success: true, data: status };
      }

      const displayData: Array<{ metric: string; value: unknown }> = [
        { metric: 'Status', value: output.success('Running') },
        { metric: 'PID', value: status.pid },
        { metric: 'Transport', value: status.transport },
      ];

      // Only show host/port for non-stdio transports
      if (status.transport !== 'stdio') {
        displayData.push({ metric: 'Host', value: status.host });
        displayData.push({ metric: 'Port', value: status.port });
      }

      if (status.uptime !== undefined) {
        displayData.push({ metric: 'Uptime', value: formatUptime(status.uptime) });
      }

      if (status.startedAt) {
        displayData.push({ metric: 'Started At', value: status.startedAt });
      }

      if (status.health) {
        displayData.push({
          metric: 'Health',
          value: status.health.healthy
            ? output.success('Healthy')
            : output.error(status.health.error || 'Unhealthy'),
        });

        if (status.health.metrics) {
          for (const [key, value] of Object.entries(status.health.metrics)) {
            displayData.push({
              metric: `  ${key}`,
              value: String(value),
            });
          }
        }
      }

      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 20 },
          { key: 'value', header: 'Value', width: 25, align: 'right' },
        ],
        data: displayData,
      });

      return { success: true, data: status };
    } catch (error) {
      output.printError(`Failed to get status: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Restart command
export const restartCommand: Command = {
  name: 'restart',
  description: 'Restart MCP server',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force restart without graceful shutdown',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.printInfo('Restarting MCP Server...');

    try {
      const manager = getServerManager();
      const status = await manager.restart();

      output.printSuccess('MCP Server restarted');
      output.writeln(output.dim(`  PID: ${status.pid}`));

      return { success: true, data: status };
    } catch (error) {
      output.printError(`Failed to restart: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  },
};
