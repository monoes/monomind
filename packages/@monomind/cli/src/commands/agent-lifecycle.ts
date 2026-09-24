/**
 * Agent lifecycle commands — spawn, list, status, stop
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { agentCatalog, agentNames } from '../decision/catalogs.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { output } from '../output.js';
import { confirm, input, select } from '../prompt.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { getProjectCwd } from '../utils/paths.js';

// ─── Shared utilities ────────────────────────────────────────────────────────

export function updateSwarmActivityMetrics(agentCountDelta: number): void {
  try {
    const metricsDir = path.join(process.cwd(), '.monomind', 'metrics');
    const activityPath = path.join(metricsDir, 'monoswarm-activity.json');

    let data: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      monoswarm: { active: false, agent_count: 0, coordination_active: false },
    };

    if (fs.existsSync(activityPath) && fs.statSync(activityPath).size <= 10 * 1024 * 1024) {
      data = JSON.parse(fs.readFileSync(activityPath, 'utf-8'));
    }

    const swarm = (data.monoswarm as Record<string, unknown>) ?? {};
    const currentCount = Math.max(0, (swarm.agent_count as number) || 0);
    const newCount = Math.max(0, currentCount + agentCountDelta);

    swarm.agent_count = newCount;
    swarm.active = newCount > 0;
    swarm.coordination_active = newCount > 0;
    data.monoswarm = swarm;
    data.timestamp = new Date().toISOString();

    writeJsonFileAtomic(activityPath, data);
  } catch {
    // Non-critical — don't fail the command if metrics update fails
  }
}

/** Type names `agent spawn --type` used to offer before it read the registry,
 *  mapped to the registry agent that does that job. `coder`, `researcher`,
 *  `tester`, `reviewer` and `coordinator` are registry names already. */
export const AGENT_TYPE_ALIASES: Record<string, string> = {
  architect: 'Software Architect',
  'core-architect': 'Software Architect',
  analyst: 'Performance Benchmarker',
  optimizer: 'Performance Benchmarker',
  'performance-engineer': 'Performance Benchmarker',
  'security-architect': 'Security Engineer',
  'security-auditor': 'Security Engineer',
  'memory-specialist': 'monoswarm-memory-manager',
  'swarm-specialist': 'coordinator',
  'test-architect': 'tdd-london-monoswarm',
};

/** The registry agent a `--type` value names: the value itself when it is a
 *  registry agent name, its alias target, or null when neither exists. With
 *  no registry to check against, the value passes through unchanged. */
export function resolveAgentType(type: string, names: Set<string>): string | null {
  if (names.size === 0 || names.has(type)) return type;
  const alias = AGENT_TYPE_ALIASES[type];
  return alias && names.has(alias) ? alias : null;
}

/** Interactive choices: the registry's non-deprecated agents, by name. */
function agentTypeOptions(root: string): { value: string; label: string; hint?: string }[] {
  return agentCatalog(root)
    .map((a) => ({ value: a.name ?? a.id, label: a.name ?? a.id, hint: a.category }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getAgentCapabilities(type: string): string[] {
  const capabilities: Record<string, string[]> = {
    coder: ['code-generation', 'refactoring', 'debugging', 'testing'],
    researcher: ['web-search', 'data-analysis', 'summarization', 'citation'],
    tester: ['unit-testing', 'integration-testing', 'coverage-analysis', 'automation'],
    reviewer: ['code-review', 'security-audit', 'quality-check', 'documentation'],
    architect: ['system-design', 'pattern-analysis', 'scalability', 'documentation'],
    coordinator: ['task-orchestration', 'agent-management', 'workflow-control'],
    'security-architect': ['threat-modeling', 'security-patterns', 'compliance', 'audit'],
    'memory-specialist': ['vector-search', 'sqlite', 'caching', 'optimization'],
    'performance-engineer': ['benchmarking', 'profiling', 'optimization', 'monitoring'],
  };
  return capabilities[type] || ['general'];
}

export function formatStatus(status: unknown): string {
  const s = String(status);
  switch (s) {
    case 'active':
      return output.success(s);
    case 'idle':
      return output.warning(s);
    case 'inactive':
    case 'stopped':
      return output.dim(s);
    case 'error':
      return output.error(s);
    default:
      return s;
  }
}

// ─── spawn subcommand ────────────────────────────────────────────────────────

export const spawnCommand: Command = {
  name: 'spawn',
  description: 'Spawn a new agent',
  options: [
    {
      name: 'type',
      short: 't',
      description: 'Agent type to spawn: a registry agent name (see `monomind route list-agents`)',
      type: 'string',
    },
    { name: 'name', short: 'n', description: 'Agent name/identifier', type: 'string' },
    {
      name: 'provider',
      short: 'p',
      description: 'Provider to use (anthropic, openrouter, ollama)',
      type: 'string',
      default: 'anthropic',
    },
    { name: 'model', short: 'm', description: 'Model to use', type: 'string' },
    { name: 'task', description: 'Initial task for the agent', type: 'string' },
    { name: 'timeout', description: 'Agent timeout in seconds', type: 'number', default: 300 },
    {
      name: 'auto-tools',
      description: 'Enable automatic tool usage',
      type: 'boolean',
      default: true,
    },
  ],
  examples: [
    {
      command: 'monomind agent spawn --type coder --name bot-1',
      description: 'Spawn a coder agent',
    },
    {
      command: 'monomind agent spawn -t researcher --task "Research React 19"',
      description: 'Spawn researcher with task',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let agentType = (ctx.flags.type as string | undefined)?.slice(0, 64) ?? '';
    let agentName = (ctx.flags.name as string | undefined)?.slice(0, 128) ?? '';

    const root = getProjectCwd();
    if (!agentType && ctx.interactive) {
      agentType = await select({ message: 'Select agent type:', options: agentTypeOptions(root) });
    }
    if (agentType) {
      const resolved = resolveAgentType(agentType, agentNames(root));
      if (!resolved) {
        output.printError(
          `Unknown agent type "${agentType}". Use a registry agent name (see \`monomind route list-agents\`).`,
        );
        return { success: false, exitCode: 1 };
      }
      if (resolved !== agentType) {
        process.stderr.write(
          `[agent] "${agentType}" is an old type name; spawning "${resolved}"\n`,
        );
        agentType = resolved;
      }
    }

    const taskDescription = (ctx.flags.task as string | undefined)?.slice(0, 2048);
    if (!agentType && taskDescription) {
      try {
        const { createConfiguredRouteLayer } = await import('../routing/route-layer-factory.js');
        const layer = await createConfiguredRouteLayer();
        const routeResult = await layer.route(taskDescription);
        agentType = routeResult.agentSlug;
        process.stderr.write(
          `[route] ${routeResult.method}: "${agentType}" (confidence: ${(routeResult.confidence * 100).toFixed(1)}%)\n`,
        );
      } catch {
        // RouteLayer unavailable — fall through to error below
      }
    }

    if (!agentType) {
      output.printError(
        'Agent type is required. Use --type or -t flag, or provide --task for auto-routing.',
      );
      return { success: false, exitCode: 1 };
    }

    if (!agentName) agentName = `${agentType}-${Date.now().toString(36)}`;

    output.printInfo(`Spawning ${agentType} agent: ${output.highlight(agentName)}`);

    try {
      const result = await callMCPTool<{
        success?: boolean;
        error?: string;
        agentId: string;
        agentType: string;
        status: string;
        createdAt: string;
      }>('agent_spawn', {
        agentType,
        id: agentName,
        config: {
          provider: ctx.flags.provider || 'anthropic',
          model: ctx.flags.model,
          task: ctx.flags.task,
          timeout: ctx.flags.timeout,
          autoTools: ctx.flags['auto-tools'],
        },
        priority: 'normal',
        metadata: { name: agentName, capabilities: getAgentCapabilities(agentType) },
      });

      // agent_spawn resolves (doesn't throw) on a tool-level failure like
      // "agent store is unreadable" or "agent already exists" — callMCPTool
      // only throws for registry/infra errors (tool not found/disabled), not
      // for a handler's own {success:false} response. Without this check the
      // CLI silently rendered a "spawned successfully" table full of
      // undefined fields for a spawn that never actually happened.
      if (result.success === false) {
        output.printError(`Failed to spawn agent: ${result.error || 'unknown error'}`);
        return { success: false, exitCode: 1 };
      }

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 15 },
          { key: 'value', header: 'Value', width: 40 },
        ],
        data: [
          { property: 'ID', value: result.agentId },
          { property: 'Type', value: result.agentType },
          { property: 'Name', value: agentName },
          { property: 'Status', value: result.status },
          { property: 'Created', value: result.createdAt },
          { property: 'Capabilities', value: getAgentCapabilities(agentType).join(', ') },
        ],
      });

      output.writeln();
      output.printSuccess(`Agent ${agentName} spawned successfully`);
      updateSwarmActivityMetrics(1);

      if (ctx.flags.format === 'json') output.printJson(result);
      return { success: true, data: result };
    } catch (error) {
      output.printError(
        error instanceof MCPClientError
          ? `Failed to spawn agent: ${error.message}`
          : `Unexpected error: ${String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }
  },
};

// ─── list subcommand ─────────────────────────────────────────────────────────

export const listCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List all active agents',
  options: [
    {
      name: 'all',
      short: 'a',
      description: 'Include inactive agents',
      type: 'boolean',
      default: false,
    },
    { name: 'type', short: 't', description: 'Filter by agent type', type: 'string' },
    { name: 'status', short: 's', description: 'Filter by status', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      // agent_list emits `agentId` (agent-tools.ts), not `id` — reading `id`
      // here rendered a blank ID column for every agent. `id` is kept as a
      // fallback because agent_pool/agent_health project the same records
      // under that key.
      const result = await callMCPTool<{
        agents: Array<{
          agentId?: string;
          id?: string;
          agentType: string;
          status: 'active' | 'idle' | 'terminated';
          createdAt: string;
          lastActivityAt?: string;
        }>;
        total: number;
      }>('agent_list', {
        status: ctx.flags.all ? 'all' : ctx.flags.status || undefined,
        agentType: ctx.flags.type || undefined,
        limit: 100,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Active Agents'));
      output.writeln();

      if (result.agents.length === 0) {
        output.printInfo('No agents found matching criteria');
        return { success: true, data: result };
      }

      const displayAgents = result.agents.map((agent) => ({
        id: agent.agentId ?? agent.id ?? '',
        type: agent.agentType,
        status: agent.status,
        created: new Date(agent.createdAt).toLocaleTimeString(),
        lastActivity: agent.lastActivityAt
          ? new Date(agent.lastActivityAt).toLocaleTimeString()
          : 'N/A',
      }));

      output.printTable({
        columns: [
          { key: 'id', header: 'ID', width: 20 },
          { key: 'type', header: 'Type', width: 15 },
          { key: 'status', header: 'Status', width: 12, format: formatStatus },
          { key: 'created', header: 'Created', width: 12 },
          { key: 'lastActivity', header: 'Last Activity', width: 12 },
        ],
        data: displayAgents,
      });

      output.writeln();
      output.printInfo(`Total: ${result.total} agents`);
      return { success: true, data: result };
    } catch (error) {
      output.printError(
        error instanceof MCPClientError
          ? `Failed to list agents: ${error.message}`
          : `Unexpected error: ${String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }
  },
};

// ─── status subcommand ───────────────────────────────────────────────────────

export const statusCommand: Command = {
  name: 'status',
  description: 'Show detailed status of an agent',
  options: [{ name: 'id', description: 'Agent ID', type: 'string' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let agentId = ctx.args[0] || (ctx.flags.id as string);

    if (!agentId && ctx.interactive) {
      agentId = await input({
        message: 'Enter agent ID:',
        validate: (v) => v.length > 0 || 'Agent ID is required',
      });
    }

    if (!agentId) {
      output.printError('Agent ID is required');
      return { success: false, exitCode: 1 };
    }

    try {
      const status = await callMCPTool<{
        id: string;
        agentType: string;
        status: 'active' | 'idle' | 'terminated' | 'not_found';
        error?: string;
        createdAt: string;
        lastActivityAt?: string;
        config?: Record<string, unknown>;
        metrics?: {
          tasksCompleted: number;
          tasksInProgress: number;
          tasksFailed: number;
          averageExecutionTime: number;
          uptime: number;
        };
      }>('agent_status', { agentId, includeMetrics: true, includeHistory: false });

      // agent_status resolves (doesn't throw) with {status:'not_found', error}
      // for a nonexistent agent — callMCPTool only throws for registry/infra
      // errors, not a handler's own not-found response. Without this check
      // the CLI reported success:true for an agent that was never found.
      if (status.error) {
        output.printError(`Failed to get agent status: ${status.error}`);
        return { success: false, exitCode: 1 };
      }

      if (ctx.flags.format === 'json') {
        output.printJson(status);
        return { success: true, data: status };
      }

      output.writeln();
      output.printBox(
        [
          `Type: ${status.agentType}`,
          `Status: ${formatStatus(status.status)}`,
          `Created: ${new Date(status.createdAt).toLocaleString()}`,
          `Last Activity: ${status.lastActivityAt ? new Date(status.lastActivityAt).toLocaleString() : 'N/A'}`,
        ].join('\n'),
        `Agent: ${status.id}`,
      );

      if (status.metrics) {
        output.writeln();
        output.writeln(output.bold('Metrics'));
        const avgExecTime = status.metrics.averageExecutionTime ?? 0;
        const uptime = status.metrics.uptime ?? 0;
        output.printTable({
          columns: [
            { key: 'metric', header: 'Metric', width: 25 },
            { key: 'value', header: 'Value', width: 15, align: 'right' },
          ],
          data: [
            { metric: 'Tasks Completed', value: status.metrics.tasksCompleted ?? 0 },
            { metric: 'Tasks In Progress', value: status.metrics.tasksInProgress ?? 0 },
            { metric: 'Tasks Failed', value: status.metrics.tasksFailed ?? 0 },
            { metric: 'Avg Execution Time', value: `${avgExecTime.toFixed(2)}ms` },
            { metric: 'Uptime', value: `${(uptime / 1000 / 60).toFixed(1)}m` },
          ],
        });
      }

      return { success: true, data: status };
    } catch (error) {
      output.printError(
        error instanceof MCPClientError
          ? `Failed to get agent status: ${error.message}`
          : `Unexpected error: ${String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }
  },
};

// ─── stop subcommand ─────────────────────────────────────────────────────────

export const stopCommand: Command = {
  name: 'stop',
  aliases: ['kill'],
  description: 'Stop a running agent',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force stop without graceful shutdown',
      type: 'boolean',
      default: false,
    },
    {
      name: 'timeout',
      description: 'Graceful shutdown timeout in seconds',
      type: 'number',
      default: 30,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const agentId = ctx.args[0];

    if (!agentId) {
      output.printError('Agent ID is required');
      return { success: false, exitCode: 1 };
    }

    const force = ctx.flags.force as boolean;

    if (!force && ctx.interactive) {
      const confirmed = await confirm({
        message: `Are you sure you want to stop agent ${agentId}?`,
        default: false,
      });
      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.printInfo(`Stopping agent ${agentId}...`);

    try {
      const result = await callMCPTool<{
        success?: boolean;
        error?: string;
        agentId: string;
        terminated: boolean;
        terminatedAt: string;
      }>('agent_terminate', {
        agentId,
        graceful: !force,
        reason: 'Stopped by user via CLI',
      });

      // agent_terminate resolves (doesn't throw) with {success:false, error}
      // for a nonexistent agent or an unreadable store — callMCPTool only
      // throws for registry/infra errors. Without this check the CLI printed
      // "stopped successfully" for an agent that was never actually stopped.
      if (result.success === false) {
        output.printError(`Failed to stop agent: ${result.error || 'unknown error'}`);
        return { success: false, exitCode: 1 };
      }

      output.printSuccess(`Agent ${agentId} stopped successfully`);
      updateSwarmActivityMetrics(-1);

      if (ctx.flags.format === 'json') output.printJson(result);
      return { success: true, data: result };
    } catch (error) {
      output.printError(
        error instanceof MCPClientError
          ? `Failed to stop agent: ${error.message}`
          : `Unexpected error: ${String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }
  },
};
