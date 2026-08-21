/**
 * CLI Monoswarm Command
 * Monoswarm coordination and management commands
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, confirm, multiSelect } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as fs from 'fs';
import * as path from 'path';
import { getMonomindDataRoot, getProjectCwd, migrateLegacyStoreFile } from '../utils/paths.js';

// Canonical paths — resolved through getMonomindDataRoot() so the CLI and the MCP
// tools (agent-tools.ts / monoswarm-tools.ts / task-tools.ts) read and write the
// SAME physical files: `.monomind/monoswarm/state.json`. This is a clean break from
// the pre-rename `.monomind/swarm/swarm-state.json` layout — no migration from that
// legacy path is performed.
const SWARM_STATE_SUBDIR = 'monoswarm';
const SWARM_STATE_FILE = 'state.json';
const AGENT_STORE_SUBDIR = 'agents';
const AGENT_STORE_FILE = 'store.json';

function getSwarmDir(): string {
  return path.join(getMonomindDataRoot(), SWARM_STATE_SUBDIR);
}

// Canonical state.json path — `.monomind/monoswarm/state.json`, shared with the
// MCP tools.
function getSwarmStateFile(): string {
  return path.join(getSwarmDir(), SWARM_STATE_FILE);
}

function getAgentStoreFile(): string {
  const file = path.join(getMonomindDataRoot(), AGENT_STORE_SUBDIR, AGENT_STORE_FILE);
  migrateLegacyStoreFile(file, path.join(AGENT_STORE_SUBDIR, AGENT_STORE_FILE));
  return file;
}

// Get dynamic swarm status from MCP-canonical state files
function getSwarmStatus(swarmId?: string) {
  const projectCwd = getProjectCwd();
  const sessionDir = path.join(projectCwd, '.claude', 'sessions');
  const memoryPaths = [
    path.join(projectCwd, '.monomind', 'memory.db'),
    path.join(projectCwd, '.claude', 'memory.db'),
  ];

  // Read swarm state from the MCP-canonical path
  const swarmStateFile = getSwarmStateFile();
  let swarmState: Record<string, unknown> | null = null;

  if (fs.existsSync(swarmStateFile)) {
    try {
      const swarmStatSz = fs.statSync(swarmStateFile).size;
      if (swarmStatSz <= 10_485_760) {
        const state = JSON.parse(fs.readFileSync(swarmStateFile, 'utf-8'));
        // monoswarm-tools.ts writes a single flat MonoswarmState object — there
        // is only one monoswarm per project, so there is no per-id map to look
        // up (a `swarmId` argument is accepted purely as a display override).
        if (state?.initialized) {
          swarmState = state;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Count agents from the MCP-canonical agent store (the same physical file
  // agent_spawn writes to — see getAgentStoreFile()).
  let activeAgents = 0;
  let totalAgents = 0;
  const agentStoreFile = getAgentStoreFile();
  if (fs.existsSync(agentStoreFile)) {
    try {
      const agentSz = fs.statSync(agentStoreFile).size;
      if (agentSz <= 52_428_800) {
        const agentStore = JSON.parse(fs.readFileSync(agentStoreFile, 'utf-8'));
        if (agentStore?.agents && typeof agentStore.agents === 'object') {
          for (const agent of Object.values(agentStore.agents) as Array<Record<string, unknown>>) {
            totalAgents++;
            if (agent.status === 'idle' || agent.status === 'busy') {
              activeAgents++;
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  // Get session count
  let sessionCount = 0;
  if (fs.existsSync(sessionDir)) {
    try {
      sessionCount = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json')).length;
    } catch {
      // Ignore
    }
  }

  // Get memory size as rough indicator of activity
  let memorySize = 0;
  for (const dbPath of memoryPaths) {
    if (fs.existsSync(dbPath)) {
      try {
        memorySize = fs.statSync(dbPath).size;
        break;
      } catch {
        // Ignore
      }
    }
  }

  // Count task files if they exist
  let completedTasks = 0;
  let inProgressTasks = 0;
  let pendingTasks = 0;
  const tasksDir = path.join(getSwarmDir(), 'tasks');
  if (fs.existsSync(tasksDir)) {
    try {
      const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
      for (const file of taskFiles) {
        try {
          const taskFilePath = path.join(tasksDir, file);
          const taskSz = fs.statSync(taskFilePath).size;
          if (taskSz <= 524_288) {
            const task = JSON.parse(fs.readFileSync(taskFilePath, 'utf-8'));
            if (task.status === 'completed' || task.status === 'done') {
              completedTasks++;
            } else if (task.status === 'in_progress' || task.status === 'running') {
              inProgressTasks++;
            } else {
              pendingTasks++;
            }
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore
    }
  }

  // Calculate dynamic progress based on actual state
  // If no swarm state, show 0%. Otherwise calculate from completed tasks
  const totalTasks = completedTasks + inProgressTasks + pendingTasks;
  let progress = 0;
  if (totalTasks > 0) {
    progress = Math.round((completedTasks / totalTasks) * 100);
  } else if (swarmState) {
    // Swarm initialized but no tasks yet
    progress = 5;
  }

  // Determine status
  let status = 'idle';
  if (inProgressTasks > 0 || activeAgents > 0) {
    status = 'running';
  } else if (completedTasks > 0 && pendingTasks === 0 && inProgressTasks === 0) {
    status = 'completed';
  } else if (swarmState) {
    status = 'ready';
  }

  const swarmConfig = (swarmState as { config?: Record<string, unknown> })?.config;

  return {
    id:
      swarmId ||
      (swarmState as Record<string, string>)?.monoswarmId ||
      'no-active-swarm',
    topology: (swarmState as Record<string, string>)?.topology || 'none',
    status,
    // Not tracked in the merged monoswarm state — the state file records
    // topology/strategy/votes, not a free-text objective.
    objective: 'No active objective',
    strategy: (swarmConfig?.strategy as string) || 'none',
    agents: {
      total: totalAgents,
      active: activeAgents,
      idle: Math.max(0, totalAgents - activeAgents),
      // Not tracked anywhere — nothing distinguishes a "completed" agent
      // from an active/idle one in the agent store. '--' rather than a
      // fake 0.
      completed: '--',
    },
    progress,
    tasks: {
      total: totalTasks,
      completed: completedTasks,
      inProgress: inProgressTasks,
      pending: pendingTasks,
    },
    metrics: {
      // Token usage isn't tracked here — '--' rather than a fake 0.
      tokensUsed: '--',
      avgResponseTime: '--',
      successRate: totalTasks > 0 ? `${Math.round((completedTasks / totalTasks) * 100)}%` : '--',
      elapsedTime: '--',
    },
    hasActiveSwarm: !!swarmState || totalAgents > 0,
  };
}

// Swarm topologies
const TOPOLOGIES = [
  {
    value: 'hierarchical',
    label: 'Hierarchical',
    hint: 'Queen-led coordination with worker agents',
  },
  { value: 'mesh', label: 'Mesh', hint: 'Fully connected peer-to-peer network' },
  { value: 'ring', label: 'Ring', hint: 'Circular communication pattern' },
  { value: 'star', label: 'Star', hint: 'Central coordinator with spoke agents' },
  { value: 'hybrid', label: 'Hybrid', hint: 'Hierarchical mesh for maximum flexibility' },
  {
    value: 'hierarchical-mesh',
    label: 'Hierarchical Mesh',
    hint: 'v1 15-agent queen + peer communication (recommended)',
  },
];

// Swarm strategies
const STRATEGIES = [
  { value: 'specialized', label: 'Specialized', hint: 'Clear roles, no overlap (anti-drift)' },
  { value: 'balanced', label: 'Balanced', hint: 'Even distribution of work' },
  { value: 'adaptive', label: 'Adaptive', hint: 'Dynamic strategy based on task' },
  { value: 'research', label: 'Research', hint: 'Distributed research and analysis' },
  { value: 'development', label: 'Development', hint: 'Collaborative code development' },
  { value: 'testing', label: 'Testing', hint: 'Comprehensive test coverage' },
  { value: 'optimization', label: 'Optimization', hint: 'Performance optimization' },
  { value: 'maintenance', label: 'Maintenance', hint: 'Codebase maintenance and refactoring' },
  { value: 'analysis', label: 'Analysis', hint: 'Code analysis and documentation' },
];

// Initialize swarm
const initCommand: Command = {
  name: 'init',
  description: 'Initialize a new swarm',
  options: [
    {
      name: 'topology',
      short: 't',
      description: 'Monoswarm topology',
      type: 'string',
      choices: TOPOLOGIES.map((t) => t.value),
      default: 'hierarchical',
    },
    {
      name: 'max-agents',
      short: 'm',
      description: 'Maximum number of agents',
      type: 'number',
      default: 15,
    },
    {
      name: 'strategy',
      short: 's',
      description: 'Coordination strategy',
      type: 'string',
      choices: STRATEGIES.map((s) => s.value),
    },
    {
      name: 'v1-mode',
      description: 'Enable v1 15-agent hierarchical mesh mode',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let topology = ctx.flags.topology as string;
    const maxAgents = (ctx.flags['max-agents'] as number) || 15;
    const v1Mode = ctx.flags.v1Mode as boolean;

    // mode enables hierarchical-mesh hybrid
    if (v1Mode) {
      topology = 'hierarchical-mesh';
      output.printInfo('v1 Mode: Using hierarchical-mesh topology with 15-agent coordination');
    }

    // Interactive topology selection
    if (!topology && ctx.interactive) {
      topology = await select({
        message: 'Select swarm topology:',
        options: TOPOLOGIES,
        default: 'hierarchical',
      });
    }

    output.writeln();
    output.printInfo('Initializing swarm...');

    try {
      // Call MCP tool to initialize swarm
      const result = await callMCPTool<{
        monoswarmId: string;
        topology: string;
        initializedAt: string;
        config: {
          topology: string;
          maxAgents: number;
        };
      }>('monoswarm_init', {
        topology: topology as
          | 'hierarchical'
          | 'mesh'
          | 'adaptive'
          | 'ring'
          | 'star'
          | 'hybrid'
          | 'hierarchical-mesh',
        maxAgents,
        config: {
          failureHandling: 'retry',
          loadBalancing: true,
        },
        metadata: {
          v1Mode,
          strategy: ctx.flags.strategy || 'development',
        },
      });

      // Display initialization progress
      output.writeln(output.dim(`  Wrote swarm config: ${result.monoswarmId}`));

      if (v1Mode) {
        output.writeln(output.dim('  (v1-mode: topology renamed to hierarchical-mesh; no ANN or keyword routing is performed during init)'));
      }

      output.writeln();
      output.printTable({
        columns: [
          { key: 'property', header: 'Property', width: 20 },
          { key: 'value', header: 'Value', width: 35 },
        ],
        data: [
          { property: 'Monoswarm ID', value: result.monoswarmId },
          { property: 'Topology', value: result.topology },
          { property: 'Max Agents', value: result.config.maxAgents },
          { property: 'v1 Mode', value: v1Mode ? 'Enabled' : 'Disabled' },
        ],
      });

      output.writeln();
      output.printSuccess('Monoswarm initialized successfully');

      // No further write here: monoswarm_init already persisted the canonical
      // state to `.monomind/monoswarm/state.json` (a single flat record — the
      // CLI and the MCP tools share exactly that one file, so writing a second,
      // differently-shaped copy would overwrite the tool's own record).

      if (ctx.flags.format === 'json') {
        output.printJson(result);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Failed to initialize swarm: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  },
};

// Start swarm execution
const startCommand: Command = {
  name: 'start',
  description: 'Start swarm execution',
  options: [
    {
      name: 'objective',
      short: 'o',
      description: 'Monoswarm objective/task',
      type: 'string',
      required: true,
    },
    {
      name: 'strategy',
      short: 's',
      description: 'Execution strategy',
      type: 'string',
      choices: STRATEGIES.map((s) => s.value),
    },
    {
      name: 'parallel',
      short: 'p',
      description: 'Enable parallel execution',
      type: 'boolean',
      default: true,
    },
  ],
  examples: [
    {
      command: 'monomind monoswarm start -o "Build REST API" -s development',
      description: 'Start development swarm',
    },
    {
      command: 'monomind monoswarm start -o "Analyze codebase" --parallel',
      description: 'Parallel analysis',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const objective = ctx.args[0] || (ctx.flags.objective as string);
    let strategy = ctx.flags.strategy as string;

    if (!objective) {
      output.printError('Objective is required. Use -o or provide as argument.');
      return { success: false, exitCode: 1 };
    }

    // Interactive strategy selection
    if (!strategy && ctx.interactive) {
      strategy = await select({
        message: 'Select execution strategy:',
        options: STRATEGIES,
        default: 'development',
      });
    }

    strategy = strategy || 'development';

    output.writeln();
    output.printInfo(`Starting swarm with objective: ${output.highlight(objective)}`);
    output.writeln();

    // Compute agent deployment plan based on strategy
    const agentPlan = getAgentPlan(strategy);

    output.writeln(output.bold('Agent Deployment Plan'));
    output.printTable({
      columns: [
        { key: 'role', header: 'Role', width: 20 },
        { key: 'type', header: 'Type', width: 15 },
        { key: 'count', header: 'Count', width: 8, align: 'right' },
        { key: 'purpose', header: 'Purpose', width: 30 },
      ],
      data: agentPlan,
    });

    // Confirm execution
    if (ctx.interactive) {
      const confirmed = await confirm({
        message: `Deploy ${agentPlan.reduce((sum, a) => sum + a.count, 0)} agents?`,
        default: true,
      });

      if (!confirmed) {
        output.printInfo('Monoswarm execution cancelled');
        return { success: true };
      }
    }

    // Initialize swarm via MCP and persist state (#1423: was stub-only, no actual execution)
    const swarmId = `swarm-${Date.now().toString(36)}`;
    const totalAgents = agentPlan.reduce((sum: number, a: { count: number }) => sum + a.count, 0);

    output.writeln();
    const spinner = output.createSpinner({
      text: 'Initializing swarm via MCP...',
      spinner: 'dots',
    });
    spinner.start();

    let resolvedSwarmId = swarmId;
    try {
      // Actually call MCP to initialize the swarm
      const initResult = await callMCPTool('monoswarm_init', {
        topology: 'hierarchical',
        maxAgents: totalAgents,
        strategy: strategy === 'development' ? 'specialized' : strategy,
      });
      const mcpData = typeof initResult === 'string' ? JSON.parse(initResult) : initResult;
      // Prefer the canonical ID assigned by the MCP tool over the locally generated one
      resolvedSwarmId = mcpData?.monoswarmId ?? swarmId;
      spinner.succeed('Monoswarm initialized via MCP');
    } catch (err) {
      // monoswarm_init runs in-process via the local MCP tool registry — there is no
      // separate MCP server to "start" here. A failure means the handler itself
      // threw (bad input, filesystem/config issue, etc.), not that a server is down.
      spinner.fail('monoswarm_init failed — monoswarm metadata saved locally only');
      output.writeln(output.dim(`  Error: ${err instanceof Error ? err.message : String(err)}`));
      output.writeln(
        output.dim(
          '  Run with -v/--verbose for more detail, or `monomind doctor` to check config/permission issues.',
        ),
      );
    }

    // No further write here: monoswarm_init (called above) already persisted
    // the canonical state to `.monomind/monoswarm/state.json` — a single flat
    // record shared with the MCP tools, not a per-id map. `objective` and
    // `agentPlan` are display-only for this command; they are not tracked in
    // the merged monoswarm state (see getSwarmStatus()'s objective field).

    output.writeln();
    output.printSuccess(`Monoswarm ${resolvedSwarmId} config written (${totalAgents} agent slots reserved). No agents are running — use 'agent spawn' to dispatch Task-tool agents.`);
    output.writeln(output.dim(`  Monitor: monomind monoswarm status ${resolvedSwarmId}`));

    return {
      success: true,
      data: { swarmId: resolvedSwarmId, objective, strategy, agents: totalAgents },
    };
  },
};

// Swarm status
const statusCommand: Command = {
  name: 'status',
  description: 'Show swarm status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const swarmId = ctx.args[0];

    // Get dynamic status from actual swarm state files
    const status = getSwarmStatus(swarmId);

    if (ctx.flags.format === 'json') {
      output.printJson(status);
      return { success: true, data: status };
    }

    output.writeln();

    // Show different message if no active swarm
    if (!status.hasActiveSwarm) {
      output.writeln(output.warning('No active swarm'));
      output.writeln();
      output.writeln(output.dim('Start a swarm with:'));
      output.writeln(output.dim('  npx monomind@latest monoswarm init'));
      output.writeln(output.dim('  npx monomind@latest monoswarm start'));
      output.writeln();
      return { success: true, data: status };
    }

    output.writeln(output.bold(`Monoswarm Status: ${status.id}`));
    output.writeln();

    // Progress bar
    output.writeln(`Overall Progress: ${output.progressBar(status.progress, 100, 40)}`);
    output.writeln();

    // Agent status
    output.writeln(output.bold('Agents'));
    output.printTable({
      columns: [
        { key: 'status', header: 'Status', width: 12 },
        { key: 'count', header: 'Count', width: 10, align: 'right' },
      ],
      data: [
        { status: output.success('Active'), count: status.agents.active },
        { status: output.warning('Idle'), count: status.agents.idle },
        { status: output.dim('Completed'), count: status.agents.completed },
        { status: 'Total', count: status.agents.total },
      ],
    });

    output.writeln();

    // Task status
    output.writeln(output.bold('Tasks'));
    output.printTable({
      columns: [
        { key: 'status', header: 'Status', width: 12 },
        { key: 'count', header: 'Count', width: 10, align: 'right' },
      ],
      data: [
        { status: output.success('Completed'), count: status.tasks.completed },
        { status: output.info('In Progress'), count: status.tasks.inProgress },
        { status: output.dim('Pending'), count: status.tasks.pending },
        { status: 'Total', count: status.tasks.total },
      ],
    });

    output.writeln();

    // Metrics
    output.writeln(output.bold('Performance Metrics'));
    output.printList([
      `Tokens Used: ${status.metrics.tokensUsed}`,
      `Avg Response Time: ${status.metrics.avgResponseTime}`,
      `Success Rate: ${status.metrics.successRate}`,
      `Elapsed Time: ${status.metrics.elapsedTime}`,
    ]);

    return { success: true, data: status };
  },
};

// Stop swarm
const stopCommand: Command = {
  name: 'stop',
  description: 'Stop swarm execution',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Force immediate stop',
      type: 'boolean',
      default: false,
    },
    {
      name: 'save-state',
      description: 'Save current state for resume',
      type: 'boolean',
      default: true,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const swarmId = ctx.args[0];
    const force = ctx.flags.force as boolean;

    if (!swarmId) {
      output.printError('Monoswarm ID is required');
      return { success: false, exitCode: 1 };
    }

    if (ctx.interactive && !force) {
      const confirmed = await confirm({
        message: `Stop swarm ${swarmId}? Progress will be saved.`,
        default: false,
      });

      if (!confirmed) {
        output.printInfo('Operation cancelled');
        return { success: true };
      }
    }

    output.printInfo(`Stopping swarm ${swarmId}...`);

    // monoswarm_shutdown marks the canonical state file terminated and clears
    // the roster itself — no further local write is needed here.
    try {
      await callMCPTool('monoswarm_shutdown', { swarmId, force });
      output.writeln(output.dim('  Monoswarm state updated'));
    } catch (err) {
      output.printWarning(`MCP stop failed: ${String(err)}`);
      return { success: false, message: `MCP stop failed: ${String(err)}`, exitCode: 1 };
    }

    output.printSuccess(`Monoswarm ${swarmId} stopped`);

    return { success: true, data: { swarmId, stopped: true, force } };
  },
};

// Scale swarm
const scaleCommand: Command = {
  name: 'scale',
  description: 'Scale swarm agent count',
  options: [
    {
      name: 'agents',
      short: 'a',
      description: 'Target number of agents',
      type: 'number',
      required: true,
    },
    {
      name: 'type',
      short: 't',
      description: 'Agent type to scale',
      type: 'string',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const swarmId = ctx.args[0];
    const targetAgents = ctx.flags.agents as number;
    const agentType = ctx.flags.type as string;

    if (!swarmId) {
      output.printError('Monoswarm ID is required');
      return { success: false, exitCode: 1 };
    }

    // 0 is a valid target (scale a swarm down to no agents) — check for
    // presence, not truthiness.
    if (targetAgents === undefined || Number.isNaN(targetAgents)) {
      output.printError('Target agent count required. Use --agents or -a');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Scaling swarm ${swarmId} to ${targetAgents} agents...`);

    try {
      const result = await callMCPTool<{
        success: boolean;
        error?: string;
        previousCount: number;
        currentCount: number;
        spawned: string[];
        terminated: string[];
      }>('monoswarm_scale', { swarmId, targetAgents, agentType });

      if (!result.success) {
        output.printError(result.error || 'Failed to scale swarm');
        return { success: false, exitCode: 1 };
      }

      if (result.spawned.length === 0 && result.terminated.length === 0) {
        output.printInfo('Monoswarm already at target size');
        return { success: true, data: result };
      }

      if (result.spawned.length > 0) {
        output.printSuccess(
          `Spawned ${result.spawned.length} agent(s): ${result.spawned.join(', ')}`,
        );
      }
      if (result.terminated.length > 0) {
        output.printSuccess(
          `Terminated ${result.terminated.length} agent(s): ${result.terminated.join(', ')}`,
        );
      }
      output.writeln(output.dim(`  ${result.previousCount} → ${result.currentCount} agents`));

      return { success: true, data: result };
    } catch (error) {
      output.printError(
        `Scale error: ${error instanceof MCPClientError ? error.message : String(error)}`,
      );
      return { success: false, exitCode: 1 };
    }
  },
};

// Main swarm command
export const monoswarmCommand: Command = {
  name: 'monoswarm',
  description: 'Monoswarm coordination commands',
  subcommands: [
    initCommand,
    startCommand,
    statusCommand,
    stopCommand,
    scaleCommand,
  ],
  options: [],
  examples: [
    { command: 'monomind monoswarm init --v1-mode', description: 'Initialize monoswarm' },
    {
      command: 'monomind monoswarm start -o "Build API" -s development',
      description: 'Start development monoswarm',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Monoswarm Coordination Commands'));
    output.writeln();
    output.writeln('Usage: monomind monoswarm <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('init')}        - Initialize a new monoswarm`,
      `${output.highlight('start')}       - Start monoswarm execution`,
      `${output.highlight('status')}      - Show monoswarm status`,
      `${output.highlight('stop')}        - Stop monoswarm execution`,
      `${output.highlight('scale')}       - Scale monoswarm agent count`,
    ]);

    return { success: true };
  },
};

// Helper function
function getAgentPlan(
  strategy: string,
): Array<{ role: string; type: string; count: number; purpose: string }> {
  const plans: Record<
    string,
    Array<{ role: string; type: string; count: number; purpose: string }>
  > = {
    specialized: [
      {
        role: 'Coordinator',
        type: 'coordinator',
        count: 1,
        purpose: 'Central orchestration (anti-drift)',
      },
      { role: 'Researcher', type: 'researcher', count: 1, purpose: 'Requirements analysis' },
      { role: 'Architect', type: 'architect', count: 1, purpose: 'System design' },
      { role: 'Coder', type: 'coder', count: 2, purpose: 'Implementation' },
      { role: 'Tester', type: 'tester', count: 1, purpose: 'Quality assurance' },
      { role: 'Reviewer', type: 'reviewer', count: 1, purpose: 'Code review' },
    ],
    balanced: [
      { role: 'Coordinator', type: 'coordinator', count: 1, purpose: 'Orchestrate workflow' },
      { role: 'Worker', type: 'coder', count: 4, purpose: 'General implementation' },
      { role: 'Reviewer', type: 'reviewer', count: 1, purpose: 'Quality review' },
    ],
    adaptive: [
      { role: 'Coordinator', type: 'coordinator', count: 1, purpose: 'Dynamic orchestration' },
      { role: 'Scout', type: 'researcher', count: 1, purpose: 'Task analysis' },
      { role: 'Worker', type: 'coder', count: 3, purpose: 'Adaptive execution' },
    ],
    development: [
      { role: 'Coordinator', type: 'coordinator', count: 1, purpose: 'Orchestrate workflow' },
      { role: 'Architect', type: 'architect', count: 1, purpose: 'System design' },
      { role: 'Coder', type: 'coder', count: 3, purpose: 'Implementation' },
      { role: 'Tester', type: 'tester', count: 2, purpose: 'Quality assurance' },
      { role: 'Reviewer', type: 'reviewer', count: 1, purpose: 'Code review' },
    ],
    research: [
      { role: 'Coordinator', type: 'coordinator', count: 1, purpose: 'Research coordination' },
      { role: 'Researcher', type: 'researcher', count: 4, purpose: 'Data gathering' },
      { role: 'Analyst', type: 'analyst', count: 2, purpose: 'Analysis and synthesis' },
    ],
    testing: [
      { role: 'Test Lead', type: 'tester', count: 1, purpose: 'Test strategy' },
      { role: 'Unit Tester', type: 'tester', count: 2, purpose: 'Unit tests' },
      { role: 'Integration Tester', type: 'tester', count: 2, purpose: 'Integration tests' },
      { role: 'QA Reviewer', type: 'reviewer', count: 1, purpose: 'Quality review' },
    ],
    optimization: [
      { role: 'Performance Lead', type: 'optimizer', count: 1, purpose: 'Performance strategy' },
      { role: 'Profiler', type: 'analyst', count: 2, purpose: 'Profiling' },
      { role: 'Optimizer', type: 'coder', count: 2, purpose: 'Optimization' },
    ],
    maintenance: [
      { role: 'Coordinator', type: 'coordinator', count: 1, purpose: 'Maintenance planning' },
      { role: 'Refactorer', type: 'coder', count: 2, purpose: 'Code cleanup' },
      { role: 'Documenter', type: 'researcher', count: 1, purpose: 'Documentation' },
    ],
    analysis: [
      { role: 'Analyst Lead', type: 'analyst', count: 1, purpose: 'Analysis coordination' },
      { role: 'Code Analyst', type: 'analyst', count: 2, purpose: 'Code analysis' },
      { role: 'Security Analyst', type: 'reviewer', count: 1, purpose: 'Security review' },
    ],
  };

  return plans[strategy] || plans.development;
}

export default monoswarmCommand;
