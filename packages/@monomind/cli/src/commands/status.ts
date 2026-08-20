/**
 * CLI Status Command
 * System status display for Monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Status refresh interval (ms)
const DEFAULT_WATCH_INTERVAL = 2000;

// Track CPU usage over time
let lastCpuUsage: { user: number; system: number } | null = null;
let lastCpuTime = Date.now();

// Get real process CPU usage percentage
function getProcessCpuUsage(): number {
  const cpuUsage = process.cpuUsage(lastCpuUsage ? { user: lastCpuUsage.user, system: lastCpuUsage.system } : undefined);
  const now = Date.now();
  const elapsed = now - lastCpuTime;

  // Calculate percentage (cpuUsage is in microseconds)
  const totalCpu = (cpuUsage.user + cpuUsage.system) / 1000; // Convert to ms
  const percentage = elapsed > 0 ? (totalCpu / elapsed) * 100 : 0;

  // Update for next call
  lastCpuUsage = cpuUsage;
  lastCpuTime = now;

  return Math.min(100, Math.max(0, percentage));
}

// Get real process memory usage percentage
function getProcessMemoryUsage(): number {
  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const usedMemory = memoryUsage.heapUsed + memoryUsage.external;

  return (usedMemory / totalMemory) * 100;
}

// Check if project is initialized
function isInitialized(cwd: string): boolean {
  const configPath = path.join(cwd, '.monomind', 'config.yaml');
  return fs.existsSync(configPath);
}

// Check liveness of a pid via a zero-signal, matching the pattern used in
// commands/start.ts (isPidAlive) / .claude/helpers/control-start.cjs.
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Whether the `monomind start --daemon` background process is actually
// alive, determined by reading its real pid file — not assumed.
function isDaemonRunning(cwd: string): boolean {
  const daemonPidPath = path.join(cwd, '.monomind', 'daemon.pid');
  if (!fs.existsSync(daemonPidPath)) return false;
  try {
    const pid = Number(fs.readFileSync(daemonPidPath, 'utf-8').trim());
    return isPidAlive(pid);
  } catch {
    return false;
  }
}

// Format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Get system status data
async function getSystemStatus(cwd: string): Promise<{
  initialized: boolean;
  running: boolean;
  swarm: {
    id: string | null;
    topology: string;
    // monoswarm_status (mcp-tools/monoswarm-tools.ts) only ever returns a `status`
    // string and an `agentCount` number for agents — never a health verdict,
    // an uptime, or an active/idle breakdown. Those used to be read anyway
    // and silently resolved to `undefined`/`NaN` in the display.
    status: string;
    agents: { total: number };
  };
  mcp: {
    running: boolean;
    port: number | null;
    transport: string;
  };
  memory: {
    entries: number;
    size: string;
    backend: string;
    performance: { searchTime: number; cacheHitRate: number };
  };
  tasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  performance: {
    cpuUsage: number;
    memoryUsage: number;
    searchSpeed: string;
  };
}> {
  // Real daemon liveness — replaces a literal `running: true` that claimed
  // "running" for every project where the MCP tool calls below happened not
  // to throw, regardless of whether any Monomind process was actually alive.
  const daemonRunning = isDaemonRunning(cwd);

  try {
    // Get monoswarm status. monoswarm_status genuinely returns: monoswarmId,
    // status, topology, maxAgents, agentCount, taskCount, config, createdAt,
    // updatedAt — no `agents.{total,active,idle}` object, no `health`, no
    // `uptime`. Reading those non-existent fields used to resolve to
    // `undefined`/`NaN` in the rendered table instead of throwing.
    const swarmStatus = await callMCPTool<{
      monoswarmId?: string;
      status?: string;
      topology?: string;
      agentCount?: number;
    }>('monoswarm_status', { verbose: true });

    // Get MCP status
    let mcpStatus = { running: false, port: null as number | null, transport: 'stdio' };
    try {
      const mcp = await callMCPTool<{
        running: boolean;
        port: number;
        transport: string;
      }>('mcp_status', {});
      mcpStatus = mcp;
    } catch {
      // MCP not running
    }

    // Memory status — measured, not assumed.
    //
    // This block used to be hardcoded literals ({entries: 0, size: 0, backend:
    // 'sqlite', ...}) behind the comment "no MCP tool available; use defaults".
    // Every number in the Memory panel was therefore a constant presented as
    // telemetry: a project with a 139KB store and retrievable entries was told
    // "Entries 0, Size 0 B". Worse, the derived Memory Backend health check
    // compared against the same hardcoded 'sqlite', so it could never fail.
    //
    // On failure we report backend 'unknown' rather than a plausible-looking
    // zero, so "cannot measure" is distinguishable from "measured empty".
    const memoryStatus = {
      entries: 0,
      size: 0,
      backend: 'unknown',
      performance: { avgSearchTime: 0, cacheHitRate: 0 },
    };
    try {
      const { bridgeListEntries, bridgeGetDbPath } = await import('../memory/memory-bridge.js');
      const listed = await bridgeListEntries({ limit: 100_000 });
      if (listed?.success) {
        memoryStatus.entries = listed.entries?.length ?? 0;
        memoryStatus.backend = 'sqlite';
        try {
          const { statSync } = await import('node:fs');
          const { join } = await import('node:path');
          memoryStatus.size = statSync(join(bridgeGetDbPath(), 'memory.db')).size;
        } catch { /* size is a nicety; entries and backend are the load-bearing parts */ }
      }
    } catch { /* leaves backend 'unknown' — an honest "could not read" */ }

    // Get task status
    const taskStatus = await callMCPTool<{
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    }>('task_summary', {});

    return {
      initialized: true,
      running: daemonRunning,
      swarm: {
        id: swarmStatus.monoswarmId ?? null,
        topology: swarmStatus.topology ?? 'none',
        status: swarmStatus.status ?? 'no_swarm',
        agents: { total: swarmStatus.agentCount ?? 0 }
      },
      mcp: mcpStatus,
      memory: {
        entries: memoryStatus.entries,
        size: formatBytes(memoryStatus.size),
        backend: memoryStatus.backend,
        performance: {
          searchTime: memoryStatus.performance.avgSearchTime,
          cacheHitRate: memoryStatus.performance.cacheHitRate
        }
      },
      tasks: taskStatus,
      performance: {
        cpuUsage: getProcessCpuUsage(),
        memoryUsage: getProcessMemoryUsage(),
        searchSpeed: 'not measured'
      }
    };
  } catch (error) {
    // Reaching here does NOT prove the system is stopped — it means reading its
    // state threw. The block below reports zeros for every panel, so swallowing
    // the cause made a failed read indistinguishable from a genuinely idle
    // project: a repo with a populated memory store and a live agent was told
    // "Total 0 / Entries 0 / Backend none".
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
      console.error('[status] could not read system state:', error);
    } else {
      output.writeln(output.warning(
        `Could not read full system state (${error instanceof Error ? error.message : String(error)}) — ` +
        'the figures below are defaults, not measurements. Re-run with DEBUG=1 for detail.'
      ));
    }
    return {
      initialized: true,
      running: daemonRunning,
      swarm: {
        id: null,
        topology: 'none',
        status: 'no_swarm',
        agents: { total: 0 }
      },
      mcp: { running: false, port: null, transport: 'stdio' },
      memory: {
        entries: 0,
        size: '0 B',
        backend: 'none',
        performance: { searchTime: 0, cacheHitRate: 0 }
      },
      tasks: { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
      performance: {
        cpuUsage: 0,
        memoryUsage: 0,
        searchSpeed: 'N/A'
      }
    };
  }
}

// Display status in text format
async function displayStatus(status: Awaited<ReturnType<typeof getSystemStatus>>): Promise<void> {
  output.writeln();

  // Header with overall status
  const statusIcon = status.running
    ? output.success('[RUNNING]')
    : output.warning('[STOPPED]');
  output.writeln(`${output.bold('Monomind')} ${statusIcon}`);
  output.writeln();

  // Swarm section. monoswarm_status never returns a health verdict, an uptime,
  // or an active/idle breakdown — only `status`/`topology`/`agentCount` — so
  // those are the only fields shown here.
  output.writeln(output.bold('Swarm'));
  if (status.swarm.id) {
    output.printTable({
      columns: [
        { key: 'property', header: 'Property', width: 15 },
        { key: 'value', header: 'Value', width: 30 }
      ],
      data: [
        { property: 'ID', value: status.swarm.id },
        { property: 'Topology', value: status.swarm.topology },
        { property: 'Status', value: status.swarm.status }
      ]
    });
  } else {
    output.printInfo('  No active swarm');
  }
  output.writeln();

  // Agents section
  output.writeln(output.bold('Agents'));
  output.printTable({
    columns: [
      { key: 'status', header: 'Status', width: 12 },
      { key: 'count', header: 'Count', width: 10, align: 'right' }
    ],
    data: [
      { status: output.bold('Total'), count: status.swarm.agents.total }
    ]
  });
  output.writeln();

  // Tasks section
  output.writeln(output.bold('Tasks'));
  output.printTable({
    columns: [
      { key: 'status', header: 'Status', width: 12 },
      { key: 'count', header: 'Count', width: 10, align: 'right' }
    ],
    data: [
      { status: 'Pending', count: status.tasks.pending },
      { status: 'Running', count: status.tasks.running },
      { status: 'Completed', count: status.tasks.completed },
      { status: 'Failed', count: status.tasks.failed },
      { status: output.bold('Total'), count: status.tasks.total }
    ]
  });
  output.writeln();

  // Memory section
  output.writeln(output.bold('Memory'));
  output.printTable({
    columns: [
      { key: 'property', header: 'Property', width: 18 },
      { key: 'value', header: 'Value', width: 20, align: 'right' }
    ],
    data: [
      { property: 'Backend', value: status.memory.backend },
      { property: 'Entries', value: status.memory.entries },
      { property: 'Size', value: status.memory.size },
      { property: 'Search Time', value: `${status.memory.performance.searchTime.toFixed(2)}ms` },
      { property: 'Cache Hit Rate', value: `${(status.memory.performance.cacheHitRate * 100).toFixed(1)}%` }
    ]
  });
  output.writeln();

  // MCP section
  output.writeln(output.bold('MCP Server'));
  if (status.mcp.running) {
    if (status.mcp.transport === 'stdio') {
      output.printInfo('  Running (stdio mode)');
    } else {
      output.printInfo(`  Running on port ${status.mcp.port} (${status.mcp.transport})`);
    }
  } else {
    output.printInfo('  Not running');
  }
  output.writeln();

  // Performance section
  if (status.running) {
    output.writeln(output.bold('Performance'));
    output.printList([
      `Vector Search: ${output.success(status.performance.searchSpeed)}`,
      `CPU Usage: ${status.performance.cpuUsage.toFixed(1)}%`,
      `Memory Usage: ${status.performance.memoryUsage.toFixed(1)}%`
    ]);
  }

  // System resources section
  output.writeln(output.bold('System Resources'));
  try {
    const { checkResources } = await import('../utils/resource-governor.js');
    const res = checkResources();
    const memColor = res.freeMemPct < 15 ? output.error : res.freeMemPct < 30 ? output.warning : output.success;
    output.printTable({
      columns: [
        { key: 'property', header: 'Property', width: 18 },
        { key: 'value', header: 'Value', width: 25, align: 'right' }
      ],
      data: [
        { property: 'Available RAM', value: memColor(`${res.freeMemMB}MB (${res.freeMemPct}%)`) },
        { property: 'SDK Processes', value: `${res.sdkProcesses} / ${res.maxSdkProcesses} max` },
        { property: 'Status', value: res.ok ? output.success('OK') : output.warning(res.reason ?? 'pressure') },
      ]
    });
  } catch {
    output.printInfo('  Resource governor not available');
  }
}

// Format health status with color
function formatHealth(health: string): string {
  switch (health) {
    case 'healthy':
      return output.success(health);
    case 'degraded':
      return output.warning(health);
    case 'unhealthy':
    case 'stopped':
      return output.error(health);
    default:
      return health;
  }
}

// Main status action
const statusAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const watch = ctx.flags.watch as boolean;
  const rawInterval = (ctx.flags.interval as number) || DEFAULT_WATCH_INTERVAL / 1000;
  const interval = Number.isFinite(rawInterval) ? Math.max(1, Math.min(rawInterval, 3600)) : DEFAULT_WATCH_INTERVAL / 1000;
  const healthCheck = ctx.flags['health-check'] as boolean;
  const cwd = ctx.cwd;

  // Check initialization
  if (!isInitialized(cwd)) {
    output.printError('MonoMind is not initialized in this directory');
    output.printInfo('Run "monomind init" to initialize');
    return { success: false, exitCode: 1 };
  }

  // Get status
  const status = await getSystemStatus(cwd);

  // Health check mode
  if (healthCheck) {
    return performHealthCheck(status);
  }

  // JSON output
  if (ctx.flags.format === 'json') {
    output.printJson(status);
    return { success: true, data: status };
  }

  // Watch mode
  if (watch) {
    return watchStatus(interval, cwd);
  }

  // Single status display
  await displayStatus(status);

  return { success: true, data: status };
};

// Perform health checks
async function performHealthCheck(
  status: Awaited<ReturnType<typeof getSystemStatus>>
): Promise<CommandResult> {
  output.writeln();
  output.writeln(output.bold('Health Check'));
  output.writeln();

  const checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }> = [];

  // Check if system is running
  checks.push({
    name: 'System Running',
    status: status.running ? 'pass' : 'fail',
    message: status.running ? 'System is running' : 'System is not running'
  });

  // Check swarm health
  if (status.running) {
    checks.push({
      name: 'Swarm Status',
      status: status.swarm.status === 'running' ? 'pass' :
              status.swarm.status === 'no_swarm' ? 'fail' : 'warn',
      message: `Swarm status: ${status.swarm.status}`
    });

    // Check agent count
    checks.push({
      name: 'Agents Available',
      status: status.swarm.agents.total > 0 ? 'pass' : 'fail',
      message: `${status.swarm.agents.total} agent(s)`
    });

    // Check MCP
    checks.push({
      name: 'MCP Server',
      status: status.mcp.running ? 'pass' : 'warn',
      message: status.mcp.running
        ? (status.mcp.transport === 'stdio' ? 'Running (stdio mode)' : `Running on port ${status.mcp.port}`)
        : 'Not running'
    });

    // Check memory backend
    checks.push({
      name: 'Memory Backend',
      status: status.memory.backend !== 'none' ? 'pass' : 'fail',
      message: `Using ${status.memory.backend} backend`
    });

    // Check for failed tasks
    const failRate = status.tasks.total > 0
      ? status.tasks.failed / status.tasks.total
      : 0;
    checks.push({
      name: 'Task Success Rate',
      status: failRate < 0.05 ? 'pass' : failRate < 0.2 ? 'warn' : 'fail',
      message: `${((1 - failRate) * 100).toFixed(1)}% success rate`
    });
  }

  // Display results
  for (const check of checks) {
    const icon = check.status === 'pass' ? output.success('[PASS]') :
                 check.status === 'warn' ? output.warning('[WARN]') :
                 output.error('[FAIL]');
    output.writeln(`${icon} ${check.name}: ${check.message}`);
  }

  output.writeln();

  const passed = checks.filter(c => c.status === 'pass').length;
  const warned = checks.filter(c => c.status === 'warn').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  if (failed === 0) {
    output.printSuccess(`All checks passed (${passed} passed, ${warned} warnings)`);
  } else {
    output.printError(`Health check failed (${passed} passed, ${warned} warnings, ${failed} failed)`);
  }

  return {
    success: failed === 0,
    exitCode: failed > 0 ? 1 : 0,
    data: { checks, summary: { passed, warned, failed } }
  };
}

// Watch mode - continuous status updates
async function watchStatus(intervalSeconds: number, cwd: string): Promise<CommandResult> {
  output.writeln();
  output.writeln(output.bold('Watch Mode'));
  output.writeln(output.dim(`Refreshing every ${intervalSeconds}s. Press Ctrl+C to exit.`));
  output.writeln();

  const refresh = async () => {
    // Clear screen
    process.stdout.write('\x1b[2J\x1b[H');

    output.writeln(output.dim(`Last updated: ${new Date().toLocaleTimeString()}`));
    output.writeln();

    const status = await getSystemStatus(cwd);
    await displayStatus(status);
  };

  // Initial display
  await refresh();

  // Set up interval
  const intervalId = setInterval(refresh, intervalSeconds * 1000);

  // Handle exit — use once so repeated calls to watchStatus don't accumulate
  // SIGINT handlers (which would trigger a MaxListenersExceededWarning).
  return new Promise((resolve) => {
    const onSigint = () => {
      clearInterval(intervalId);
      output.writeln();
      output.printInfo('Watch mode stopped');
      resolve({ success: true });
    };
    process.once('SIGINT', onSigint);
  });
}

// Agents subcommand
const agentsCommand: Command = {
  name: 'agents',
  description: 'Show detailed agent status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      // agent_list (mcp-tools/agent-tools.ts) returns agentId/agentType/status/
      // health/taskCount/createdAt/domain — it never returns `id`, `type`,
      // `task`, `uptime`, or a `metrics.successRate` object. Reading
      // `a.metrics.successRate` on the real shape threw a TypeError
      // ("Cannot read properties of undefined") for every agent in the store.
      const result = await callMCPTool<{
        agents: Array<{
          agentId: string;
          agentType: string;
          status: string;
          health: number;
          taskCount: number;
          createdAt: string;
          domain?: string;
        }>;
      }>('agent_list', { includeMetrics: true, status: 'all' });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Agent Status'));
      output.writeln();

      if (result.agents.length === 0) {
        output.printInfo('No agents running');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'status', header: 'Status', width: 10 },
          { key: 'tasks', header: 'Tasks', width: 8 },
          { key: 'created', header: 'Created', width: 22 },
          { key: 'health', header: 'Health', width: 8 }
        ],
        data: result.agents.map(a => ({
          id: a.agentId ?? 'N/A',
          type: a.agentType ?? 'N/A',
          status: a.status ? formatHealth(a.status) : 'N/A',
          tasks: a.taskCount ?? 'N/A',
          created: a.createdAt ?? 'N/A',
          health: typeof a.health === 'number' ? a.health.toFixed(2) : 'N/A'
        }))
      });

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to get agent status: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Tasks subcommand
const tasksCommand: Command = {
  name: 'tasks',
  description: 'Show detailed task status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const result = await callMCPTool<{
        tasks: Array<{
          id: string;
          type: string;
          status: string;
          priority: string;
          agent?: string;
          progress: number;
          createdAt: string;
        }>;
      }>('task_list', { status: 'all', limit: 50 });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Task Status'));
      output.writeln();

      if (result.tasks.length === 0) {
        output.printInfo('No tasks');
        return { success: true, data: result };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 15 },
          { key: 'type', header: 'Type', width: 15 },
          { key: 'status', header: 'Status', width: 12 },
          { key: 'priority', header: 'Priority', width: 10 },
          { key: 'agent', header: 'Agent', width: 15 },
          { key: 'progress', header: 'Progress', width: 10 }
        ],
        data: result.tasks.map(t => ({
          id: t.id,
          type: t.type,
          status: formatHealth(t.status),
          priority: t.priority,
          agent: t.agent || '-',
          progress: `${t.progress}%`
        }))
      });

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to get task status: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Memory subcommand
const memoryCommand: Command = {
  name: 'memory',
  description: 'Show detailed memory status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // memory_detailed-stats MCP tool is not registered; use memory bridge directly
    try {
      const { bridgeListEntries } = await import('../memory/memory-bridge.js');
      const listed = await bridgeListEntries({ limit: 10000 });
      const entries = listed?.success ? listed.entries : [];
      const totalBytes = entries.reduce((s: number, e: any) => s + (e.content || '').length, 0);

      const result = {
        backend: 'SQLite',
        entries: entries.length,
        size: totalBytes,
      };

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Memory Status'));
      output.writeln();

      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 20 },
          { key: 'value', header: 'Value', width: 25 }
        ],
        data: [
          { property: 'Backend', value: result.backend },
          { property: 'Total Entries', value: result.entries.toLocaleString() },
          { property: 'Storage Size', value: formatBytes(result.size) },
        ]
      });

      return { success: true, data: result };
    } catch (error) {
      output.printError(`Failed to get memory status: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  }
};

// Main status command
export const statusCommand: Command = {
  name: 'status',
  description: 'Show system status',
  subcommands: [agentsCommand, tasksCommand, memoryCommand],
  options: [
    {
      name: 'watch',
      short: 'w',
      description: 'Watch mode - continuously update status',
      type: 'boolean',
      default: false
    },
    {
      name: 'interval',
      short: 'i',
      description: 'Watch mode update interval in seconds',
      type: 'number',
      default: 2
    },
    {
      name: 'health-check',
      description: 'Perform health checks and exit',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'monomind status', description: 'Show current system status' },
    { command: 'monomind status --watch', description: 'Watch mode with live updates' },
    { command: 'monomind status --watch -i 5', description: 'Watch mode updating every 5 seconds' },
    { command: 'monomind status --health-check', description: 'Run health checks' },
    { command: 'monomind status --json', description: 'Output status as JSON' },
    { command: 'monomind status agents', description: 'Show detailed agent status' },
    { command: 'monomind status tasks', description: 'Show detailed task status' },
    { command: 'monomind status memory', description: 'Show detailed memory status' }
  ],
  action: statusAction
};

export default statusCommand;
