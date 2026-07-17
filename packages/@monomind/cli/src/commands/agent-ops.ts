/**
 * Agent operational commands — metrics, pool, health
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { formatStatus } from './agent-lifecycle.js';

// ─── metrics subcommand ──────────────────────────────────────────────────────

export const metricsCommand: Command = {
  name: 'metrics',
  description: 'Show agent performance metrics',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Previously read from .swarm/agents/*.json (one file per agent) — a
    // directory nothing in the codebase has ever written to. agent_spawn
    // (agent-tools.ts) persists to a single store.json at
    // getMonomindDataRoot()/agents/store.json, keyed by agentId. This
    // command was structurally incapable of reflecting a single real
    // spawned agent; always reported zero regardless of activity. Read the
    // real store instead.
    const { loadAgentStore } = await import('../mcp-tools/agent-tools.js');
    const store = loadAgentStore();
    const agents = Object.values(store.agents);

    let totalAgents = 0;
    let activeAgents = 0;
    let tasksCompleted = 0;
    const typeCounts: Record<string, { count: number; tasks: number }> = {};

    for (const agent of agents) {
      totalAgents++;
      const agType = agent.agentType || 'unknown';
      if (!typeCounts[agType]) typeCounts[agType] = { count: 0, tasks: 0 };
      typeCounts[agType].count++;
      if (agent.status !== 'terminated') activeAgents++;
      // AgentRecord tracks a single taskCount, not a completed/failed
      // breakdown — this is the best available proxy for "task activity",
      // not literally "completed" tasks. Success-rate data doesn't exist
      // anywhere in the current agent store schema, so it's reported as
      // N/A below rather than fabricated.
      const taskCount = agent.taskCount || 0;
      typeCounts[agType].tasks += taskCount;
      tasksCompleted += taskCount;
    }

    let vectorCount = 0;
    try {
      const { bridgeGetBackendStats } = await import('../memory/memory-bridge.js');
      const backendStats = await bridgeGetBackendStats();
      vectorCount = backendStats?.totalEntries ?? 0;
    } catch { /* backend unavailable */ }

    const byType = Object.entries(typeCounts).map(([type, data]) => ({
      type, count: data.count, tasks: data.tasks,
      successRate: 'N/A', // not tracked in the current agent store schema
    }));

    const avgSuccessRate = 'N/A'; // not tracked in the current agent store schema

    const metrics = {
      summary: {
        totalAgents, activeAgents, tasksCompleted, avgSuccessRate, vectorCount,
        note: totalAgents === 0 ? 'No agents spawned yet. Use: agent spawn -t coder' : undefined,
      },
      byType,
      performance: { memoryEntries: `${vectorCount} entries`, searchBackend: vectorCount > 0 ? 'LanceDB' : 'none' },
    };

    if (ctx.flags.format === 'json') { output.printJson(metrics); return { success: true, data: metrics }; }

    output.writeln();
    output.writeln(output.bold('Agent Metrics'));
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
        { metric: 'Memory Entries', value: metrics.summary.vectorCount },
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
      `Entries: ${output.success(metrics.performance.memoryEntries)}`,
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

