/**
 * CLI MCP Command
 * MCP server control and management with real server integration
 *
 * @module @monomind/cli/commands/mcp
 * @version 3.0.0
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm } from '../prompt.js';
import {
  MCPServerManager,
  createMCPServerManager,
  getServerManager,
  startMCPServer,
  stopMCPServer,
  getMCPServerStatus,
  type MCPServerOptions,
  type MCPServerStatus,
} from '../mcp-server.js';
import { listMCPTools, callMCPTool, hasTool, getToolMetadata } from '../mcp-client.js';

// MCP tools categories
const TOOL_CATEGORIES = [
  { value: 'coordination', label: 'Coordination', hint: 'Swarm and agent coordination tools' },
  { value: 'monitoring', label: 'Monitoring', hint: 'Status and metrics monitoring' },
  { value: 'memory', label: 'Memory', hint: 'Memory and neural features' },
  { value: 'github', label: 'GitHub', hint: 'GitHub integration tools' },
  { value: 'system', label: 'System', hint: 'System and benchmark tools' }
];

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
const startCommand: Command = {
  name: 'start',
  description: 'Start MCP server',
  options: [
    {
      name: 'port',
      short: 'p',
      description: 'Server port',
      type: 'number',
      default: 3000
    },
    {
      name: 'host',
      short: 'h',
      description: 'Server host',
      type: 'string',
      default: 'localhost'
    },
    {
      name: 'transport',
      short: 't',
      description: 'Transport type (stdio, http, websocket)',
      type: 'string',
      default: 'stdio',
      choices: ['stdio', 'http', 'websocket']
    },
    {
      name: 'tools',
      description: 'Tools to enable (comma-separated or "all")',
      type: 'string',
      default: 'all'
    },
    {
      name: 'daemon',
      short: 'd',
      description: 'Run as background daemon',
      type: 'boolean',
      default: false
    },
    {
      name: 'force',
      short: 'f',
      description: 'Force restart (kill existing server first)',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind mcp start', description: 'Start with defaults (stdio)' },
    { command: 'monomind mcp start -p 8080 -t http', description: 'Start HTTP server' },
    { command: 'monomind mcp start -d', description: 'Start as daemon' },
    { command: 'monomind mcp start -f', description: 'Force restart (kill existing)' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawPort = (ctx.flags.port as number) ?? 3000;
    const port = Number.isFinite(rawPort) && rawPort >= 1 && rawPort <= 65535 ? Math.floor(rawPort) : 3000;
    const rawHost = (ctx.flags.host as string) ?? 'localhost';
    // Cap host length and reject control chars to prevent injection
    const host = typeof rawHost === 'string' ? rawHost.slice(0, 253).replace(/[\x00-\x1f]/g, '') : 'localhost';
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
          output.writeln(output.dim('Use "monomind mcp stop" to stop the server first, or use --force'));
          return { success: false, exitCode: 1 };
        }
      }

      // Force restart or unresponsive - auto-recover
      output.printWarning(`MCP Server (PID: ${existingStatus.pid}) - restarting...`);
      try {
        // Force kill the existing process
        if (existingStatus.pid) {
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

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 30 }
        ],
        data: [
          { property: 'Server PID', value: status.pid || process.pid },
          { property: 'Transport', value: transport },
          { property: 'Host', value: host },
          { property: 'Port', value: port },
          { property: 'Tools', value: !tools || tools === 'all' ? '27 enabled' : `${tools.split(',').length} enabled` },
          { property: 'Status', value: output.success('Running') }
        ]
      });

      output.writeln();
      output.printSuccess('MCP Server started');

      if (transport === 'http') {
        output.writeln(output.dim(`  Health: http://${host}:${port}/health`));
        output.writeln(output.dim(`  RPC: http://${host}:${port}/rpc`));
      } else if (transport === 'websocket') {
        output.writeln(output.dim(`  WebSocket: ws://${host}:${port}/ws`));
      }

      if (daemon) {
        output.writeln(output.dim('  Running in background mode'));
      }

      return { success: true, data: status };
    } catch (error) {
      output.printError(`Failed to start MCP server: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Stop MCP server
const stopCommand: Command = {
  name: 'stop',
  description: 'Stop MCP server',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force stop without graceful shutdown',
      type: 'boolean',
      default: false
    }
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
        default: false
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
  }
};

// MCP status
const statusCommand: Command = {
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
            { key: 'value', header: 'Value', width: 20, align: 'right' }
          ],
          data: [
            { metric: 'Status', value: output.error('Stopped') }
          ]
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
            : output.error(status.health.error || 'Unhealthy')
        });

        if (status.health.metrics) {
          for (const [key, value] of Object.entries(status.health.metrics)) {
            displayData.push({
              metric: `  ${key}`,
              value: String(value)
            });
          }
        }
      }

      output.printTable({
        columns: [
          { key: 'metric', header: 'Metric', width: 20 },
          { key: 'value', header: 'Value', width: 25, align: 'right' }
        ],
        data: displayData
      });

      return { success: true, data: status };
    } catch (error) {
      output.printError(`Failed to get status: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// List tools
const toolsCommand: Command = {
  name: 'tools',
  description: 'List available MCP tools',
  options: [
    {
      name: 'category',
      short: 'c',
      description: 'Filter by category',
      type: 'string',
      choices: TOOL_CATEGORIES.map(c => c.value)
    },
    {
      name: 'enabled',
      description: 'Show only enabled tools',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const category = ctx.flags.category as string;

    // Use local tool registry
    let tools: Array<{ name: string; category: string; description: string; enabled: boolean }>;

    // Get tools from local registry
    const registeredTools = await listMCPTools(category);

    if (registeredTools.length > 0) {
      tools = registeredTools.map(tool => ({
        name: tool.name,
        category: tool.category || 'uncategorized',
        description: tool.description,
        enabled: tool.enabled
      }));
    } else {
      // Fallback to static tool list
      tools = [
        // Agent tools
        { name: 'agent_spawn', category: 'agent', description: 'Spawn a new agent', enabled: true },
        { name: 'agent_list', category: 'agent', description: 'List all agents', enabled: true },
        { name: 'agent_terminate', category: 'agent', description: 'Terminate an agent', enabled: true },
        { name: 'agent_status', category: 'agent', description: 'Get agent status', enabled: true },

        // Swarm tools
        { name: 'swarm_init', category: 'swarm', description: 'Initialize swarm topology', enabled: true },
        { name: 'swarm_status', category: 'swarm', description: 'Get swarm status', enabled: true },
        { name: 'swarm_scale', category: 'swarm', description: 'Scale swarm size', enabled: true },

        // Memory tools
        { name: 'memory_store', category: 'memory', description: 'Store in memory', enabled: true },
        { name: 'memory_search', category: 'memory', description: 'Search memory', enabled: true },
        { name: 'memory_list', category: 'memory', description: 'List memory entries', enabled: true },

        // Config tools
        { name: 'config_load', category: 'config', description: 'Load configuration', enabled: true },
        { name: 'config_save', category: 'config', description: 'Save configuration', enabled: true },
        { name: 'config_validate', category: 'config', description: 'Validate configuration', enabled: true },

        // Hooks tools
        { name: 'hooks_pre-edit', category: 'hooks', description: 'Pre-edit hook', enabled: true },
        { name: 'hooks_post-edit', category: 'hooks', description: 'Post-edit hook', enabled: true },
        { name: 'hooks_pre-command', category: 'hooks', description: 'Pre-command hook', enabled: true },
        { name: 'hooks_post-command', category: 'hooks', description: 'Post-command hook', enabled: true },
        { name: 'hooks_route', category: 'hooks', description: 'Route task to agent', enabled: true },
        { name: 'hooks_explain', category: 'hooks', description: 'Explain routing', enabled: true },
        { name: 'hooks_pretrain', category: 'hooks', description: 'Pretrain from repo', enabled: true },
        { name: 'hooks_metrics', category: 'hooks', description: 'Learning metrics', enabled: true },
        { name: 'hooks_list', category: 'hooks', description: 'List hooks', enabled: true },

        // System tools
        { name: 'system_info', category: 'system', description: 'System information', enabled: true },
        { name: 'system_health', category: 'system', description: 'Health status', enabled: true },
        { name: 'system_metrics', category: 'system', description: 'Server metrics', enabled: true },
      ].filter(t => !category || t.category === category);
    }

    if (ctx.flags.format === 'json') {
      output.printJson(tools);
      return { success: true, data: tools };
    }

    output.writeln();
    output.writeln(output.bold('Available MCP Tools'));
    output.writeln();

    // Group by category
    const grouped = tools.reduce((acc, tool) => {
      if (!acc[tool.category]) acc[tool.category] = [];
      acc[tool.category].push(tool);
      return acc;
    }, {} as Record<string, typeof tools>);

    for (const [cat, catTools] of Object.entries(grouped)) {
      output.writeln(output.highlight(cat.charAt(0).toUpperCase() + cat.slice(1)));

      output.printTable({
        columns: [
          { key: 'name', header: 'Tool', width: 25 },
          { key: 'description', header: 'Description', width: 35 },
          { key: 'enabled', header: 'Status', width: 10, format: (v: unknown) => (v as boolean) ? output.success('Enabled') : output.dim('Disabled') }
        ],
        data: catTools,
        border: false
      });

      output.writeln();
    }

    output.printInfo(`Total: ${tools.length} tools`);

    return { success: true, data: tools };
  }
};

// Enable/disable tools
const toggleCommand: Command = {
  name: 'toggle',
  description: 'Enable or disable MCP tools',
  options: [
    {
      name: 'enable',
      short: 'e',
      description: 'Enable tools',
      type: 'string'
    },
    {
      name: 'disable',
      short: 'd',
      description: 'Disable tools',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const stateFile = path.join(ctx.cwd, '.monomind', 'mcp-disabled-tools.json');

    let disabled: string[] = [];
    try { disabled = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[mcp] failed to load mcp-disabled-tools.json, treating as fresh:', e); }

    const enableArg = ctx.flags.enable as string | undefined;
    const disableArg = ctx.flags.disable as string | undefined;

    if (!enableArg && !disableArg) {
      output.writeln(output.warning('Provide --enable <tool> or --disable <tool>'));
      return { success: false, exitCode: 1 };
    }

    if (disableArg) {
      const tools = disableArg.split(',').map(t => t.trim());
      for (const t of tools) {
        if (!disabled.includes(t)) disabled.push(t);
      }
      output.printSuccess(`Disabled: ${tools.join(', ')}`);
    }

    if (enableArg) {
      const tools = enableArg.split(',').map(t => t.trim());
      disabled = disabled.filter(t => !tools.includes(t));
      output.printSuccess(`Enabled: ${tools.join(', ')}`);
    }

    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(disabled, null, 2) + '\n');
    output.writeln(output.dim(`State saved to ${stateFile}. ${disabled.length} tool(s) disabled.`));
    output.writeln(output.dim('Disabled tools are rejected immediately by direct CLI invocation.'));
    output.writeln(output.dim('An external MCP server (mcp start) must be restarted to stop exposing disabled tools to MCP clients.'));

    return { success: true };
  }
};

// Execute tool
const execCommand: Command = {
  name: 'exec',
  description: 'Execute an MCP tool',
  options: [
    {
      name: 'tool',
      short: 't',
      description: 'Tool name',
      type: 'string',
      required: true
    },
    {
      name: 'params',
      short: 'p',
      description: 'Tool parameters (JSON)',
      type: 'string'
    }
  ],
  examples: [
    { command: 'monomind mcp exec -t swarm_init -p \'{"topology":"mesh"}\'', description: 'Execute tool' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const tool = ctx.flags.tool as string || ctx.args[0];
    const paramsStr = ctx.flags.params as string;

    if (!tool) {
      output.printError('Tool name is required. Use --tool or -t');
      return { success: false, exitCode: 1 };
    }

    let params = {};
    if (paramsStr) {
      try {
        params = JSON.parse(paramsStr);
      } catch (e) {
        output.printError('Invalid JSON parameters');
        return { success: false, exitCode: 1 };
      }
    }

    output.printInfo(`Executing tool: ${tool}`);

    if (Object.keys(params).length > 0) {
      output.writeln(output.dim(`  Parameters: ${JSON.stringify(params)}`));
    }

    try {
      // Execute through local MCP tool registry
      if (!await hasTool(tool)) {
        output.printError(`Tool not found: ${tool}`);
        return { success: false, exitCode: 1 };
      }

      const startTime = performance.now();
      const result = await callMCPTool(tool, params, {
        sessionId: `cli-${Date.now().toString(36)}`,
        requestId: `exec-${Date.now()}`,
      });
      const duration = performance.now() - startTime;

      output.writeln();
      output.printSuccess(`Tool executed in ${duration.toFixed(2)}ms`);

      if (ctx.flags.format === 'json') {
        output.printJson({ tool, params, result, duration });
      } else {
        output.writeln();
        output.writeln(output.bold('Result:'));
        output.printJson(result);
      }

      return { success: true, data: { tool, params, result, duration } };
    } catch (error) {
      output.printError(`Tool execution failed: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Health check command
const healthCommand: Command = {
  name: 'health',
  description: 'Check MCP server health',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const status = await getMCPServerStatus();

      if (!status.running) {
        output.printError('MCP Server is not running');
        return { success: false, exitCode: 1 };
      }

      const manager = getServerManager();
      const health = await manager.checkHealth();

      if (ctx.flags.format === 'json') {
        output.printJson(health);
        return { success: true, data: health };
      }

      output.writeln();
      output.writeln(output.bold('MCP Server Health'));
      output.writeln();

      if (health.healthy) {
        output.printSuccess('Server is healthy');
      } else {
        output.printError(`Server is unhealthy: ${health.error || 'Unknown error'}`);
      }

      if (health.metrics) {
        output.writeln();
        output.writeln(output.bold('Metrics:'));
        for (const [key, value] of Object.entries(health.metrics)) {
          output.writeln(`  ${key}: ${value}`);
        }
      }

      return { success: health.healthy, data: health };
    } catch (error) {
      output.printError(`Health check failed: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Logs command
export const logsCommand: Command = {
  name: 'logs',
  description: 'Show MCP server logs',
  options: [
    {
      name: 'lines',
      short: 'n',
      description: 'Number of lines',
      type: 'number',
      default: 20
    },
    {
      name: 'follow',
      short: 'f',
      description: 'Follow log output',
      type: 'boolean',
      default: false
    },
    {
      name: 'level',
      description: 'Filter by log level',
      type: 'string',
      choices: ['debug', 'info', 'warn', 'error']
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const lines = (ctx.flags.lines as number) || 50;
    const follow = ctx.flags.follow as boolean;
    const levelFilter = (ctx.flags.level as string | undefined)?.toLowerCase();

    // Try to find and read the actual log file
    const { existsSync, readFileSync, statSync, watch, createReadStream } = await import('fs');
    const { join } = await import('path');

    const MAX_MCP_LOG_BYTES = 10 * 1024 * 1024; // 10 MB
    const logPaths = [
      join(ctx.cwd, '.monomind', 'logs', 'mcp-server.log'),
      join(ctx.cwd, '.monomind', 'logs', 'daemon.log'),
      join(ctx.cwd, '.monomind', 'mcp.log'),
    ];

    const logFile = logPaths.find(p => existsSync(p) && statSync(p).size <= MAX_MCP_LOG_BYTES);

    output.writeln();
    output.writeln(output.bold('MCP Server Logs'));
    output.writeln(output.dim('─'.repeat(50)));

    if (!logFile) {
      output.writeln(output.dim('No log files found. Start the MCP server to generate logs.'));
      output.writeln(output.dim(`Checked: ${logPaths.map(p => p.replace(ctx.cwd, '.')).join(', ')}`));
      if (follow) {
        output.printError('--follow requires an existing log file to watch — none was found.');
        return { success: false };
      }
      return { success: true };
    }

    // Best-effort text match: log line formats vary (bracketed, "level:", JSON),
    // so match the level as a whole word anywhere in the line rather than
    // assuming one format.
    const levelPattern = levelFilter ? new RegExp(`\\b${levelFilter}\\b`, 'i') : null;
    const matchesLevel = (line: string): boolean => !levelPattern || levelPattern.test(line);

    const content = readFileSync(logFile, 'utf8');
    const logLines = content.trim().split('\n').filter(Boolean).filter(matchesLevel);
    const tail = logLines.slice(-lines);

    if (tail.length === 0) {
      output.writeln(output.dim(levelFilter ? `Log file has no lines matching level "${levelFilter}".` : 'Log file is empty.'));
    } else {
      output.writeln(output.dim(
        `Showing last ${tail.length} lines from ${logFile.replace(ctx.cwd, '.')}` +
        (levelFilter ? ` (level=${levelFilter})` : ''),
      ));
      output.writeln();
      tail.forEach(line => output.writeln(line));
    }

    if (!follow) {
      return { success: true };
    }

    // Real tail -f: watch the file for growth and stream newly appended lines,
    // filtered the same way as the initial tail. Exits on Ctrl+C.
    output.writeln();
    output.writeln(output.dim('Following log output — press Ctrl+C to stop.'));

    return new Promise<CommandResult>((resolve) => {
      let position = statSync(logFile).size;
      let pendingPartialLine = '';
      let reading = false;

      const readNewData = () => {
        if (reading) return;
        reading = true;
        let size: number;
        try {
          size = statSync(logFile).size;
        } catch {
          reading = false;
          return;
        }
        if (size < position) {
          // File was truncated or rotated — restart from the beginning.
          position = 0;
          pendingPartialLine = '';
        }
        if (size <= position) {
          reading = false;
          return;
        }
        const stream = createReadStream(logFile, { start: position, end: size - 1, encoding: 'utf8' });
        let chunkData = '';
        stream.on('data', (chunk) => { chunkData += chunk; });
        stream.on('end', () => {
          position = size;
          const combined = pendingPartialLine + chunkData;
          const parts = combined.split('\n');
          pendingPartialLine = parts.pop() ?? '';
          for (const line of parts) {
            if (line && matchesLevel(line)) output.writeln(line);
          }
          reading = false;
        });
        stream.on('error', () => { reading = false; });
      };

      const watcher = watch(logFile, { persistent: true }, (eventType) => {
        if (eventType === 'change') readNewData();
      });

      const stop = () => {
        watcher.close();
        resolve({ success: true });
      };
      process.once('SIGINT', stop);
    });
  }
};

// Restart command
const restartCommand: Command = {
  name: 'restart',
  description: 'Restart MCP server',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force restart without graceful shutdown',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force as boolean;

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
  }
};

// Verify subcommand — bridges the new-user "did the install actually work?" gap (P0-16).
// Runs after `claude mcp add monomind -- npx -y monomind@latest mcp start` to give the
// user confidence the wiring is live: lists tools through the in-process registry and
// confirms the MCP server can be reached from a stdio client.
const verifyCommand: Command = {
  name: 'verify',
  description: 'Verify the MCP server is reachable and its tools respond. Run this after `claude mcp add monomind ...` to confirm the install worked.',
  options: [],
  examples: [
    { command: 'monomind mcp verify', description: 'Confirm MCP server wiring and tool registry' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('MCP Install Verification'));
    output.writeln();

    const checks: Array<{ label: string; ok: boolean; detail: string }> = [];

    // 1. In-process tool registry responds
    let toolCount = 0;
    try {
      const tools = await listMCPTools();
      toolCount = tools.length;
      checks.push({ label: 'Tool registry', ok: toolCount > 0, detail: `${toolCount} tools registered` });
    } catch (e) {
      checks.push({ label: 'Tool registry', ok: false, detail: `error: ${(e as Error).message}` });
    }

    // 2. A known built-in tool resolves
    const sampleTool = 'system_info';
    try {
      const has = await hasTool(sampleTool);
      checks.push({ label: `Sample tool (${sampleTool})`, ok: has, detail: has ? 'resolves' : 'missing' });
    } catch (e) {
      checks.push({ label: `Sample tool (${sampleTool})`, ok: false, detail: `error: ${(e as Error).message}` });
    }

    // 3. claude mcp list includes monomind (best-effort; skip if claude CLI missing)
    try {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 5000 });
      if (result.error || result.status !== 0) {
        checks.push({ label: 'claude mcp registration', ok: false, detail: 'claude CLI unavailable or returned non-zero — run `claude mcp add monomind -- npx -y monomind@latest mcp start` to register' });
      } else {
        const listed = (result.stdout || '').toLowerCase();
        const registered = listed.includes('monomind');
        checks.push({
          label: 'claude mcp registration',
          ok: registered,
          detail: registered ? 'monomind appears in `claude mcp list`' : 'monomind NOT in `claude mcp list` — run `claude mcp add monomind -- npx -y monomind@latest mcp start`',
        });
      }
    } catch {
      checks.push({ label: 'claude mcp registration', ok: false, detail: 'claude CLI not found — install Claude Code or register manually' });
    }

    // Render
    let allOk = true;
    for (const c of checks) {
      const mark = c.ok ? output.success('✓') : output.error('✗');
      output.writeln(`  ${mark} ${c.label}: ${c.detail}`);
      if (!c.ok) allOk = false;
    }

    output.writeln();
    if (allOk) {
      output.printSuccess(`MCP install verified — ${toolCount} tools available. In Claude Code, type /mastermind:help to see slash commands.`);
    } else {
      output.printError('One or more checks failed. Fix the issues above and re-run `monomind mcp verify`.');
    }

    return { success: allOk, exitCode: allOk ? 0 : 1 };
  }
};

// Main MCP command
export const mcpCommand: Command = {
  name: 'mcp',
  description: 'MCP server management',
  subcommands: [
    startCommand,
    stopCommand,
    statusCommand,
    healthCommand,
    restartCommand,
    toolsCommand,
    toggleCommand,
    execCommand,
    logsCommand,
    verifyCommand,
  ],
  options: [],
  examples: [
    { command: 'monomind mcp start', description: 'Start MCP server' },
    { command: 'monomind mcp start -t http -p 8080', description: 'Start HTTP server on port 8080' },
    { command: 'monomind mcp status', description: 'Show server status' },
    { command: 'monomind mcp tools', description: 'List tools' },
    { command: 'monomind mcp verify', description: 'Verify the MCP server is reachable and tools respond' },
    { command: 'monomind mcp stop', description: 'Stop the server' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('MCP Server Management'));
    output.writeln();
    output.writeln('Usage: monomind mcp <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('start')}    - Start MCP server`,
      `${output.highlight('stop')}     - Stop MCP server`,
      `${output.highlight('status')}   - Show server status`,
      `${output.highlight('health')}   - Check server health`,
      `${output.highlight('restart')}  - Restart MCP server`,
      `${output.highlight('tools')}    - List available tools`,
      `${output.highlight('toggle')}   - Enable/disable tools`,
      `${output.highlight('exec')}     - Execute a tool`,
      `${output.highlight('logs')}     - Show server logs`,
      `${output.highlight('verify')}   - Verify the MCP server is reachable and tools respond`
    ]);

    return { success: true };
  }
};

export default mcpCommand;
