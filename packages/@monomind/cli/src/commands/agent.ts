/**
 * CLI Agent Command
 * Agent management commands for spawning, listing, and controlling agents
 */

import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { execCommand, scanCommand, testCommand } from './agent-exec.js';
import { listCommand, spawnCommand, statusCommand, stopCommand } from './agent-lifecycle.js';
import { healthCommand, metricsCommand, poolCommand } from './agent-ops.js';

export const agentCommand: Command = {
  name: 'agent',
  description: 'Agent management commands',
  subcommands: [
    spawnCommand,
    listCommand,
    statusCommand,
    stopCommand,
    metricsCommand,
    poolCommand,
    healthCommand,
    execCommand,
    scanCommand,
    testCommand,
  ],
  options: [],
  examples: [
    { command: 'monomind agent spawn -t coder', description: 'Spawn a coder agent' },
    { command: 'monomind agent list', description: 'List all agents' },
    { command: 'monomind agent status agent-001', description: 'Show agent status' },
    { command: 'monomind agent scan --json', description: 'Detect installed agent runtimes' },
    {
      command: 'monomind agent exec --runtime codex --prompt "hi"',
      description: 'One agent turn via the Agent Exec Protocol',
    },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Agent Management Commands'));
    output.writeln();
    output.writeln('Usage: monomind agent <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('spawn')}         - Spawn a new agent`,
      `${output.highlight('list')}          - List all active agents`,
      `${output.highlight('status')}        - Show detailed agent status`,
      `${output.highlight('stop')}          - Stop a running agent`,
      `${output.highlight('metrics')}       - Show agent metrics`,
      `${output.highlight('pool')}          - Manage agent pool`,
      `${output.highlight('health')}        - Show agent health`,
      `${output.highlight('exec')}          - Run one agent turn via a local runner (NDJSON protocol)`,
      `${output.highlight('scan')}          - Detect installed agent runtimes`,
      `${output.highlight('test')}          - Smoke-test a runtime`,
    ]);
    output.writeln();
    output.writeln('Run "monomind agent <subcommand> --help" for subcommand help');
    return { success: true };
  },
};

export default agentCommand;
