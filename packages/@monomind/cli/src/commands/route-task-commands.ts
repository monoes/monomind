/**
 * Route subcommands that pick agents: task, semantic, list-agents.
 * Split from route.ts.
 *
 * @module @monomind/cli/commands/route-task-commands
 */

import type { TaskRanking } from '../decision/picks.js';
import { output } from '../output.js';
import { spawnableName } from '../routing/agent-pick.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { pickAction } from './pick.js';
import { agentName, findAgent, registryAgents } from './route-shared.js';

/** `route task` is `monomind pick --agents` (#430): the same ranking, printed
 *  the same way. `agentId` names the top agent only when pick is confident. */
async function routeViaPick(
  task: string,
  json: boolean,
  ctx: CommandContext,
): Promise<CommandResult> {
  const res = await pickAction({ ...ctx, flags: { ...ctx.flags, task, agents: true, json } });
  const ranking = res.data as TaskRanking | undefined;
  const top = ranking?.agents.confident ? ranking.agents.ranked[0] : undefined;
  return { ...res, data: { ...ranking, agentId: top ? spawnableName(top) : null } };
}

// ============================================================================
// Route Subcommand
// ============================================================================

export const routeTaskCommand: Command = {
  name: 'task',
  description:
    'Route a task to the best registry agent (same answer and output as `monomind pick --agents`)',
  options: [
    {
      name: 'keyword',
      short: 'k',
      description: 'Accepted for compatibility; routing always uses the central picker',
      type: 'boolean',
      default: true,
    },
    {
      name: 'agent',
      short: 'a',
      description: 'Force a specific agent by name or slug (bypasses routing)',
      type: 'string',
    },
    {
      name: 'json',
      short: 'j',
      description: 'Output in JSON format',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'monomind route task "implement authentication"',
      description: 'Route task to best agent',
    },
    {
      command: 'monomind route task "write unit tests"',
      description: 'Route test task to tester agent',
    },
    {
      command: 'monomind route task "review code" --agent reviewer',
      description: 'Force specific agent',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawTask = ctx.args[0];
    const forceAgent = ctx.flags.agent as string | undefined;
    const jsonOutput = ctx.flags.json as boolean;

    if (!rawTask) {
      output.printError('Task description is required');
      output.writeln(output.dim('Usage: monomind route task "task description"'));
      return { success: false, exitCode: 1 };
    }
    if (rawTask.length > 4096) {
      output.printError('Task description too long (max 4096 characters)');
      return { success: false, exitCode: 1 };
    }
    const taskDescription = rawTask;

    const spinner = output.createSpinner({ text: 'Analyzing task...', spinner: 'dots' });

    try {
      if (forceAgent) {
        spinner.start();
        // Use specified agent directly
        const agent = findAgent(forceAgent);

        if (!agent) {
          spinner.fail(`Agent "${forceAgent}" not found`);
          output.writeln();
          output.writeln('Available agents:');
          output.printList(registryAgents().map((a) => output.highlight(agentName(a))));
          return { success: false, exitCode: 1 };
        }
        const name = agentName(agent);

        spinner.succeed(`Routed to ${name}`);

        if (jsonOutput) {
          output.printJson({
            task: taskDescription,
            agentId: name,
            agentName: name,
            confidence: 1.0,
            method: 'forced',
          });
        } else {
          output.writeln();
          output.printBox(
            [
              `Task: ${taskDescription}`,
              `Agent: ${output.highlight(name)}`,
              `Confidence: ${output.success('100%')} (forced)`,
              `Description: ${agent.description ?? ''}`,
            ].join('\n'),
            'Routing Result',
          );
        }

        return { success: true, data: { agentId: name, agentName: name } };
      }

      return await routeViaPick(taskDescription, jsonOutput, ctx);
    } catch (error) {
      spinner.fail('Routing failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================================================
// List Agents Subcommand
// ============================================================================

export const listAgentsCommand: Command = {
  name: 'list-agents',
  aliases: ['agents', 'ls'],
  description: 'List all available agent types for routing',
  options: [
    {
      name: 'json',
      short: 'j',
      description: 'Output in JSON format',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'monomind route list-agents', description: 'List all agents' },
    { command: 'monomind route agents --json', description: 'List agents as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const jsonOutput = ctx.flags.json as boolean;

    try {
      const agents = registryAgents().map((a) => ({
        id: a.id,
        name: agentName(a),
        category: a.category ?? '',
        description: a.description ?? '',
      }));
      if (jsonOutput) {
        output.printJson(agents);
      } else {
        output.writeln();
        output.writeln(output.bold('Available Agents'));
        output.writeln(
          output.dim('Name = spawnable Task subagent_type (from .monomind/registry.json)'),
        );
        output.writeln();

        output.printTable({
          columns: [
            { key: 'name', header: 'Name', width: 32 },
            { key: 'category', header: 'Category', width: 14 },
            { key: 'description', header: 'Description', width: 45 },
          ],
          data: agents.map((a) => ({
            name: output.highlight(a.name),
            category: a.category,
            description: a.description.replace(/\s+/g, ' ').slice(0, 90),
          })),
        });

        output.writeln();
        output.writeln(output.dim(`Total: ${agents.length} agents`));
      }

      return { success: true, data: agents };
    } catch (error) {
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================================================
// Semantic Route Subcommand (RouteLayer — cosine similarity)
// ============================================================================

export const semanticRouteCommand: Command = {
  name: 'semantic',
  aliases: ['sem'],
  description:
    'Deprecated: use `route task` / `monomind pick`. Central picker, then cosine similarity (RouteLayer) and Haiku',
  options: [
    {
      name: 'task',
      short: 't',
      description: 'Task description to route',
      type: 'string',
      required: true,
    },
    {
      name: 'debug',
      short: 'd',
      description: 'Include all route scores in the output',
      type: 'boolean',
      default: false,
    },
    {
      name: 'json',
      short: 'j',
      description: 'Output in JSON format',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'monomind route semantic -t "audit the API for injection risks"',
      description: 'Semantic routing',
    },
    {
      command: 'monomind route semantic -t "write unit tests" --debug',
      description: 'Show all route scores',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawSemanticTask = ctx.flags.task as string;
    const debug = ctx.flags.debug as boolean;
    const jsonOutput = ctx.flags.json as boolean;

    if (!rawSemanticTask) {
      output.printError('Task description is required. Use --task or -t flag.');
      return { success: false, exitCode: 1 };
    }
    if (rawSemanticTask.length > 4096) {
      output.printError('Task description too long (max 4096 characters)');
      return { success: false, exitCode: 1 };
    }
    const taskDescription = rawSemanticTask;

    const spinner = output.createSpinner({ text: 'Computing semantic route...', spinner: 'dots' });
    spinner.start();

    try {
      // Builds a RouteLayer with a real local embedding model + headless
      // Claude Code (Haiku) fallback when available; degrades gracefully.
      const { createConfiguredRouteLayer } = await import('../routing/route-layer-factory.js');
      const layer = await createConfiguredRouteLayer({ debug });
      const result = await layer.route(taskDescription);

      spinner.succeed(`Routed to ${result.agentSlug}`);

      if (jsonOutput) {
        output.printJson(result);
      } else {
        output.writeln();
        const confidencePct = (result.confidence * 100).toFixed(1);
        const methodColor =
          result.method === 'semantic' || result.method === 'jev'
            ? (s: string) => output.success(s)
            : (s: string) => output.warning(s);

        output.printBox(
          [
            `Task: ${taskDescription}`,
            ``,
            `Agent: ${output.highlight(result.agentSlug)}`,
            `Route: ${result.routeName}`,
            `Confidence: ${methodColor(`${confidencePct}%`)}`,
            `Method: ${methodColor(result.method)}`,
          ].join('\n'),
          'Semantic Routing Result',
        );

        if (debug && result.allScores && result.allScores.length > 0) {
          output.writeln();
          output.writeln(output.bold('All Route Scores (top 10):'));
          const top10 = result.allScores.slice(0, 10);
          output.printTable({
            columns: [
              { key: 'route', header: 'Route', width: 30 },
              { key: 'agent', header: 'Agent Slug', width: 35 },
              { key: 'score', header: 'Score', width: 10, align: 'right' },
            ],
            data: top10.map((s: { routeName: string; agentSlug: string; score: number }) => ({
              route: s.routeName,
              agent: s.agentSlug,
              score: s.score.toFixed(4),
            })),
          });
        }
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Semantic routing failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};
