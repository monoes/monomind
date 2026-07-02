/**
 * Agent operational commands — metrics, pool, health, logs
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { formatStatus } from './agent-lifecycle.js';

// ─── metrics subcommand ──────────────────────────────────────────────────────

export const metricsCommand: Command = {
  name: 'metrics',
  description: 'Show agent performance metrics',
  options: [
    { name: 'period', short: 'p', description: 'Time period (1h, 24h, 7d, 30d)', type: 'string', default: '24h' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const period = ctx.flags.period as string;

    const { existsSync, readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    let totalAgents = 0;
    let activeAgents = 0;
    let tasksCompleted = 0;
    const typeCounts: Record<string, { count: number; tasks: number; success: number }> = {};

    const swarmDir = join(process.cwd(), '.swarm');
    const agentsDir = join(swarmDir, 'agents');
    if (existsSync(agentsDir)) {
      try {
        const files = readdirSync(agentsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const agentFilePath = join(agentsDir, file);
            if (statSync(agentFilePath).size > 512 * 1024) continue;
            const data = JSON.parse(readFileSync(agentFilePath, 'utf-8'));
            totalAgents++;
            const agType = data.type || 'unknown';
            if (!typeCounts[agType]) typeCounts[agType] = { count: 0, tasks: 0, success: 0 };
            typeCounts[agType].count++;
            if (data.status === 'active' || data.status === 'running') activeAgents++;
            if (data.tasksCompleted) {
              typeCounts[agType].tasks += data.tasksCompleted;
              tasksCompleted += data.tasksCompleted;
            }
            if (data.successCount) typeCounts[agType].success += data.successCount;
          } catch { /* skip malformed */ }
        }
      } catch { /* no agents dir */ }
    }

    const activityFile = join(swarmDir, 'swarm-activity.json');
    if (existsSync(activityFile) && statSync(activityFile).size <= 10 * 1024 * 1024) {
      try {
        const activity = JSON.parse(readFileSync(activityFile, 'utf-8'));
        if (activity.totalAgents && totalAgents === 0) totalAgents = activity.totalAgents;
        if (activity.activeAgents && activeAgents === 0) activeAgents = activity.activeAgents;
      } catch { /* ignore */ }
    }

    let vectorCount = 0;
    const dbPath = join(swarmDir, 'memory.db');
    if (existsSync(dbPath)) {
      try { vectorCount = Math.floor(statSync(dbPath).size / 2048); } catch { /* ignore */ }
    }

    const byType = Object.entries(typeCounts).map(([type, data]) => ({
      type, count: data.count, tasks: data.tasks,
      successRate: data.tasks > 0 ? `${Math.round((data.success / data.tasks) * 100)}%` : 'N/A',
    }));

    const avgSuccessRate = tasksCompleted > 0
      ? `${Math.round(Object.values(typeCounts).reduce((a, d) => a + d.success, 0) / tasksCompleted * 100)}%`
      : 'N/A';

    const metrics = {
      period,
      summary: {
        totalAgents, activeAgents, tasksCompleted, avgSuccessRate, vectorCount,
        note: totalAgents === 0 ? 'No agents spawned yet. Use: agent spawn -t coder' : undefined,
      },
      byType,
      performance: { memoryVectors: `${vectorCount} vectors`, searchBackend: vectorCount > 0 ? 'HNSW-indexed' : 'none' },
    };

    if (ctx.flags.format === 'json') { output.printJson(metrics); return { success: true, data: metrics }; }

    output.writeln();
    output.writeln(output.bold(`Agent Metrics (${period})`));
    output.writeln();

    output.printTable({
      columns: [
        { key: 'metric', header: 'Metric', width: 20 },
        { key: 'value', header: 'Value', width: 15, align: 'right' },
      ],
      data: [
        { metric: 'Total Agents', value: metrics.summary.totalAgents },
        { metric: 'Active Agents', value: metrics.summary.activeAgents },
        { metric: 'Tasks Completed', value: metrics.summary.tasksCompleted },
        { metric: 'Success Rate', value: metrics.summary.avgSuccessRate },
        { metric: 'Memory Vectors', value: metrics.summary.vectorCount },
      ],
    });

    output.writeln();
    output.writeln(output.bold('By Agent Type'));
    output.printTable({
      columns: [
        { key: 'type', header: 'Type', width: 12 },
        { key: 'count', header: 'Count', width: 8, align: 'right' },
        { key: 'tasks', header: 'Tasks', width: 8, align: 'right' },
        { key: 'successRate', header: 'Success', width: 10, align: 'right' },
      ],
      data: metrics.byType,
    });

    if (metrics.summary.note) { output.writeln(); output.writeln(output.dim(metrics.summary.note)); }

    output.writeln();
    output.writeln(output.bold('Memory'));
    output.printList([
      `Vectors: ${output.success(metrics.performance.memoryVectors)}`,
      `Backend: ${output.success(metrics.performance.searchBackend)}`,
    ]);

    return { success: true, data: metrics };
  },
};

// ─── pool subcommand ─────────────────────────────────────────────────────────

export const poolCommand: Command = {
  name: 'pool',
  description: 'Manage agent pool for scaling',
  options: [
    { name: 'size', short: 's', description: 'Pool size', type: 'number' },
    { name: 'min', description: 'Minimum pool size', type: 'number', default: 1 },
    { name: 'max', description: 'Maximum pool size', type: 'number', default: 10 },
    { name: 'auto-scale', short: 'a', description: 'Enable auto-scaling', type: 'boolean', default: true },
  ],
  examples: [
    { command: 'monomind agent pool --size 5', description: 'Set pool size' },
    { command: 'monomind agent pool --min 2 --max 15', description: 'Configure auto-scaling' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const result = await callMCPTool<{
        poolId: string; currentSize: number; minSize: number; maxSize: number;
        autoScale: boolean; utilization: number;
        agents: Array<{ id: string; type: string; status: string }>;
      }>('agent_pool', {
        size: ctx.flags.size, min: ctx.flags.min, max: ctx.flags.max,
        autoScale: ctx.flags['auto-scale'] ?? true,
      });

      if (ctx.flags.format === 'json') { output.printJson(result); return { success: true, data: result }; }

      output.writeln();
      const utilization = result.utilization ?? 0;
      output.printBox([
        `Pool ID: ${result.poolId ?? 'default'}`,
        `Current Size: ${result.currentSize ?? 0}`,
        `Min/Max: ${result.minSize ?? 0}/${result.maxSize ?? 100}`,
        `Auto-Scale: ${result.autoScale ? 'Yes' : 'No'}`,
        `Utilization: ${(utilization * 100).toFixed(1)}%`,
      ].join('\n'), 'Agent Pool');

      const agents = result.agents ?? [];
      if (agents.length > 0) {
        output.writeln();
        output.writeln(output.bold('Pool Agents'));
        output.printTable({
          columns: [
            { key: 'id', header: 'ID', width: 20 },
            { key: 'type', header: 'Type', width: 15 },
            { key: 'status', header: 'Status', width: 12, format: formatStatus },
          ],
          data: agents,
        });
      }

      return { success: true, data: result };
    } catch (error) {
      output.printError(error instanceof MCPClientError ? `Pool error: ${error.message}` : `Unexpected error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// ─── health subcommand ───────────────────────────────────────────────────────

function formatHealthStatus(health: unknown): string {
  switch (String(health)) {
    case 'healthy': return output.success(String(health));
    case 'degraded': return output.warning(String(health));
    case 'unhealthy': return output.error(String(health));
    default: return String(health);
  }
}

export const healthCommand: Command = {
  name: 'health',
  description: 'Show agent health and metrics',
  options: [
    { name: 'id', short: 'i', description: 'Agent ID (all if not specified)', type: 'string' },
    { name: 'detailed', short: 'd', description: 'Show detailed health metrics', type: 'boolean', default: false },
    { name: 'watch', short: 'w', description: 'Watch mode (refresh every 5s)', type: 'boolean', default: false },
  ],
  examples: [
    { command: 'monomind agent health', description: 'Show all agents health' },
    { command: 'monomind agent health -i agent-001 -d', description: 'Detailed health for specific agent' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.args[0] || ctx.flags.id as string;
    const detailed = ctx.flags.detailed as boolean;

    try {
      const result = await callMCPTool<{
        agents: Array<{
          id: string; type: string; health: 'healthy' | 'degraded' | 'unhealthy'; uptime: number;
          memory: { used: number; limit: number }; cpu: number;
          tasks: { active: number; queued: number; completed: number; failed: number };
          latency: { avg: number; p99: number };
          errors: { count: number; lastError?: string };
        }>;
        overall: { healthy: number; degraded: number; unhealthy: number; avgCpu: number; avgMemory: number };
      }>('agent_health', { agentId, detailed });

      if (ctx.flags.format === 'json') { output.printJson(result); return { success: true, data: result }; }

      output.writeln();
      output.writeln(output.bold('Agent Health'));
      output.writeln();

      const overall = result.overall ?? { healthy: 0, degraded: 0, unhealthy: 0, avgCpu: 0, avgMemory: 0 };
      output.printBox([
        `Healthy: ${output.success(String(overall.healthy ?? 0))}`,
        `Degraded: ${output.warning(String(overall.degraded ?? 0))}`,
        `Unhealthy: ${output.error(String(overall.unhealthy ?? 0))}`,
        `Avg CPU: ${(overall.avgCpu ?? 0).toFixed(1)}%`,
        `Avg Memory: ${((overall.avgMemory ?? 0) * 100).toFixed(1)}%`,
      ].join('  |  '), 'Overall Status');

      const healthAgents = result.agents ?? [];
      output.writeln();
      output.printTable({
        columns: [
          { key: 'id', header: 'Agent ID', width: 18 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'health', header: 'Health', width: 10, format: formatHealthStatus },
          { key: 'cpu', header: 'CPU %', width: 8, align: 'right', format: (v) => `${Number(v ?? 0).toFixed(1)}%` },
          { key: 'memory', header: 'Memory', width: 10, align: 'right', format: (v: unknown) => {
            const mem = v as { used: number; limit: number } | undefined;
            return mem ? `${(mem.used / mem.limit * 100).toFixed(0)}%` : '0%';
          }},
          { key: 'tasks', header: 'Tasks', width: 12, align: 'right', format: (v: unknown) => {
            const t = v as { active: number; completed: number } | undefined;
            return t ? `${t.active ?? 0}/${t.completed ?? 0}` : '0/0';
          }},
        ],
        data: healthAgents,
      });

      if (detailed && healthAgents.length > 0) {
        output.writeln();
        output.writeln(output.bold('Detailed Metrics'));
        for (const agent of healthAgents) {
          output.writeln();
          output.writeln(output.highlight(agent.id));
          const uptime = agent.uptime ?? 0;
          const latency = agent.latency ?? { avg: 0, p99: 0 };
          const tasks = agent.tasks ?? { completed: 0, failed: 0, queued: 0 };
          const errors = agent.errors ?? { count: 0 };
          output.printList([
            `Uptime: ${(uptime / 1000 / 60).toFixed(1)} min`,
            `Latency: avg ${(latency.avg ?? 0).toFixed(1)}ms, p99 ${(latency.p99 ?? 0).toFixed(1)}ms`,
            `Tasks: ${tasks.completed ?? 0} completed, ${tasks.failed ?? 0} failed, ${tasks.queued ?? 0} queued`,
            `Errors: ${errors.count ?? 0}${errors.lastError ? ` (${errors.lastError})` : ''}`,
          ]);
        }
      }

      return { success: true, data: result };
    } catch (error) {
      output.printError(error instanceof MCPClientError ? `Health check error: ${error.message}` : `Unexpected error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// ─── logs subcommand ─────────────────────────────────────────────────────────

function formatLogLevel(level: string): string {
  switch (level) {
    case 'debug': return output.dim('[DEBUG]');
    case 'info': return '[INFO] ';
    case 'warn': return output.warning('[WARN] ');
    case 'error': return output.error('[ERROR]');
    default: return `[${level.toUpperCase()}]`;
  }
}

export const logsCommand: Command = {
  name: 'logs',
  description: 'Show agent activity logs',
  options: [
    { name: 'id', short: 'i', description: 'Agent ID', type: 'string' },
    { name: 'tail', short: 'n', description: 'Number of recent entries', type: 'number', default: 50 },
    { name: 'level', short: 'l', description: 'Minimum log level', type: 'string', choices: ['debug', 'info', 'warn', 'error'], default: 'info' },
    { name: 'follow', short: 'f', description: 'Follow log output', type: 'boolean', default: false },
    { name: 'since', description: 'Show logs since (e.g., "1h", "30m")', type: 'string' },
  ],
  examples: [
    { command: 'monomind agent logs -i agent-001', description: 'Show agent logs' },
    { command: 'monomind agent logs -i agent-001 -f', description: 'Follow agent logs' },
    { command: 'monomind agent logs -l error --since 1h', description: 'Show errors from last hour' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ((ctx.args[0] || ctx.flags.id as string) ?? '').slice(0, 128);
    const tail = ctx.flags.tail as number;
    const level = (ctx.flags.level as string | undefined)?.slice(0, 32);

    if (!agentId) {
      output.printError('Agent ID is required. Use --id or -i');
      return { success: false, exitCode: 1 };
    }

    try {
      const result = await callMCPTool<{
        agentId: string;
        entries: Array<{ timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; context?: Record<string, unknown> }>;
        total: number;
      }>('agent_logs', { agentId, tail, level, since: ctx.flags.since });

      if (ctx.flags.format === 'json') { output.printJson(result); return { success: true, data: result }; }

      output.writeln();
      output.writeln(output.bold(`Logs for ${agentId}`));
      output.writeln(output.dim(`Showing ${result.entries.length} of ${result.total} entries`));
      output.writeln();

      for (const entry of result.entries) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        output.writeln(`${output.dim(time)} ${formatLogLevel(entry.level)} ${entry.message}`);
        if (entry.context && Object.keys(entry.context).length > 0) {
          output.writeln(output.dim(`  ${JSON.stringify(entry.context)}`));
        }
      }

      return { success: true, data: result };
    } catch (error) {
      output.printError(error instanceof MCPClientError ? `Logs error: ${error.message}` : `Unexpected error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};
