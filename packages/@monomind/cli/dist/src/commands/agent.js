/**
 * CLI Agent Command
 * Agent management commands for spawning, listing, and controlling agents
 */
import { output } from '../output.js';
import { spawnCommand, listCommand, statusCommand, stopCommand } from './agent-lifecycle.js';
import { metricsCommand, poolCommand, healthCommand, logsCommand } from './agent-ops.js';
export const agentCommand = {
    name: 'agent',
    description: 'Agent management commands',
    subcommands: [spawnCommand, listCommand, statusCommand, stopCommand, metricsCommand, poolCommand, healthCommand, logsCommand],
    options: [],
    examples: [
        { command: 'monomind agent spawn -t coder', description: 'Spawn a coder agent' },
        { command: 'monomind agent list', description: 'List all agents' },
        { command: 'monomind agent status agent-001', description: 'Show agent status' },
    ],
    action: async (_ctx) => {
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
            `${output.highlight('logs')}          - Show agent logs`,
        ]);
        output.writeln();
        output.writeln('Run "monomind agent <subcommand> --help" for subcommand help');
        return { success: true };
    },
};
export default agentCommand;
//# sourceMappingURL=agent.js.map