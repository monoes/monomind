/**
 * CLI Hooks Command
 * Hooks that log edits, outcomes and trajectories to local pattern files and
 * route prompts to agents. No model is trained.
 *
 * This file is the main registration entry point.
 * Commands are extracted to sub-modules (ARCH-1):
 *   - hooks-core-commands.ts    — pre/post edit and command hooks
 *   - hooks-routing-commands.ts — route/explain/pretrain/metrics/transfer/list
 *   - hooks-workers.ts          — intelligence and worker commands
 *   - hooks-coverage-commands.ts — coverage-aware routing
 *   - hooks-extended-commands.ts — token optimize, model routing, agent teams
 *   - hooks-task-commands.ts    — pre-task/post-task
 *   - hooks-session-commands.ts — session-end/session-restore
 *   - hooks-compat-commands.ts  — backward-compatible v2 aliases
 */

import { WORKER_COUNT } from '../init/generated-counts.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import {
  postBashCommand,
  preBashCommand,
  routeTaskCommand,
  sessionStartCommand,
} from './hooks-compat-commands.js';
import {
  postCommandCommand,
  postEditCommand,
  preCommandCommand,
  preEditCommand,
} from './hooks-core-commands.js';
import {
  coverageGapsCommand,
  coverageRouteCommand,
  coverageSuggestCommand,
  statuslineCommand,
} from './hooks-coverage-commands.js';
import {
  modelOutcomeCommand,
  modelRouteCommand,
  modelStatsCommand,
  notifyCommand,
} from './hooks-extended-commands.js';
import {
  explainCommand,
  listCommand,
  metricsCommand,
  pretrainCommand,
  routeCommand,
  transferCommand,
} from './hooks-routing-commands.js';
import { sessionEndCommand, sessionRestoreCommand } from './hooks-session-commands.js';
import { postTaskCommand, preTaskCommand } from './hooks-task-commands.js';
import { intelligenceCommand, workerCommand } from './hooks-workers.js';

// Main hooks command
export const hooksCommand: Command = {
  name: 'hooks',
  description:
    'Lifecycle hooks: log edits, outcomes and trajectories to local pattern files and route tasks to agents (no model is trained)',
  subcommands: [
    preEditCommand,
    postEditCommand,
    preCommandCommand,
    postCommandCommand,
    preTaskCommand,
    postTaskCommand,
    sessionEndCommand,
    sessionRestoreCommand,
    routeCommand,
    explainCommand,
    pretrainCommand,
    metricsCommand,
    transferCommand,
    listCommand,
    intelligenceCommand,
    notifyCommand,
    workerCommand,
    statuslineCommand,
    // Coverage-aware routing commands
    coverageRouteCommand,
    coverageSuggestCommand,
    coverageGapsCommand,
    // Model routing (keyword complexity heuristic)
    modelRouteCommand,
    modelOutcomeCommand,
    modelStatsCommand,
    // Backward-compatible aliases for v2
    routeTaskCommand,
    sessionStartCommand,
    preBashCommand,
    postBashCommand,
  ],
  options: [],
  examples: [
    {
      command: 'monomind hooks pre-edit -f src/utils.ts',
      description: 'Get context before editing',
    },
    {
      command: 'monomind hooks route -t "Fix authentication bug"',
      description: 'Route task to optimal agent',
    },
    {
      command: 'monomind hooks pretrain',
      description: 'Scan the repository into the memory store and pattern log',
    },
    {
      command: 'monomind hooks metrics --v1-dashboard',
      description: 'View v1 performance metrics',
    },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Hooks System'));
    output.writeln();
    output.writeln(
      'Logs edits, outcomes and trajectories to local JSON pattern files and routes tasks to agents. No model is trained.',
    );
    output.writeln();
    output.writeln('Usage: monomind hooks <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('pre-edit')}        - Get context before editing files`,
      `${output.highlight('post-edit')}       - Record an edit outcome in the local feedback log`,
      `${output.highlight('pre-command')}     - Assess risk before executing commands`,
      `${output.highlight('post-command')}    - Record command execution outcomes`,
      `${output.highlight('pre-task')}        - Record task start and get agent suggestions`,
      `${output.highlight('post-task')}       - Record task outcome against its routed agent`,
      `${output.highlight('session-end')}     - End current session and persist state`,
      `${output.highlight('session-restore')} - Restore a previous session`,
      `${output.highlight('route')}           - Route tasks to optimal agents`,
      `${output.highlight('explain')}         - Explain routing decisions`,
      `${output.highlight('pretrain')}        - Scan the repo into the memory store and pattern log (no training)`,
      `${output.highlight('metrics')}         - View recorded routing/outcome metrics`,
      `${output.highlight('transfer')}        - Transfer patterns from another project`,
      `${output.highlight('list')}            - List all registered hooks`,
      `${output.highlight('worker')}          - Background worker management (${WORKER_COUNT} workers)`,
      `${output.highlight('statusline')}      - Generate dynamic statusline display`,
      `${output.highlight('coverage-route')}  - Route tasks based on coverage gaps (monovector)`,
      `${output.highlight('coverage-suggest')}- Suggest coverage improvements`,
      `${output.highlight('coverage-gaps')}   - List all coverage gaps with agents`,
      `${output.highlight('model-route')}    - Route to optimal model (haiku/sonnet/opus)`,
      `${output.highlight('model-outcome')}  - Record model routing outcome`,
      `${output.highlight('model-stats')}    - View model routing statistics`,
    ]);
    output.writeln();
    output.writeln('Run "monomind hooks <subcommand> --help" for subcommand help');
    output.writeln();
    output.writeln(output.bold('Features:'));
    output.printList([
      '🧠 Routing-outcome and edit logging (JSONL/JSON files under .monomind/)',
      '🎯 Keyword routing + route-outcome measurement',
      '🔍 Similar-pattern search through the memory store (SQLite, ANN), not the hooks themselves',
    ]);

    return { success: true };
  },
};

export default hooksCommand;
