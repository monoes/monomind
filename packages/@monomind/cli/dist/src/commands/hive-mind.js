/**
 * CLI Hive Mind Command
 * Queen-led consensus-based multi-agent coordination
 *
 * Updated to support --claude flag for launching interactive Claude Code sessions
 * PR: Fix #955 - Implement --claude flag for hive-mind spawn command
 */
import { output } from '../output.js';
import { select } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { TOPOLOGIES, CONSENSUS_STRATEGIES } from './hive-mind-helpers.js';
import { spawnCommand } from './hive-mind-spawn.js';
import { statusCommand, taskCommand, optimizeMemoryCommand } from './hive-mind-ops.js';
import { joinCommand, leaveCommand, consensusCommand, broadcastCommand, memorySubCommand, shutdownCommand } from './hive-mind-comms.js';
const initCommand = {
    name: 'init',
    description: 'Initialize a hive mind',
    options: [
        { name: 'topology', short: 't', description: 'Hive topology', type: 'string', choices: TOPOLOGIES.map(t => t.value), default: 'hierarchical-mesh' },
        { name: 'consensus', short: 'c', description: 'Consensus strategy', type: 'string', choices: CONSENSUS_STRATEGIES.map(s => s.value), default: 'byzantine' },
        { name: 'max-agents', short: 'm', description: 'Maximum agents', type: 'number', default: 15 },
        { name: 'persist', short: 'p', description: 'Enable persistent state', type: 'boolean', default: true },
        { name: 'memory-backend', description: 'Memory backend (lancedb, sqlite, hybrid)', type: 'string', default: 'hybrid' }
    ],
    examples: [
        { command: 'monomind hive-mind init -t hierarchical-mesh', description: 'Init hierarchical mesh' },
        { command: 'monomind hive-mind init -c byzantine -m 20', description: 'Init with Byzantine consensus' }
    ],
    action: async (ctx) => {
        let topology = ctx.flags.topology;
        let consensus = ctx.flags.consensus;
        if (ctx.interactive && !ctx.flags.topology) {
            topology = await select({
                message: 'Select hive topology:',
                options: TOPOLOGIES,
                default: 'hierarchical-mesh'
            });
        }
        if (ctx.interactive && !ctx.flags.consensus) {
            consensus = await select({
                message: 'Select consensus strategy:',
                options: CONSENSUS_STRATEGIES,
                default: 'byzantine'
            });
        }
        const config = {
            topology: topology || 'hierarchical-mesh',
            consensus: consensus || 'byzantine',
            maxAgents: ctx.flags['max-agents'] || 15,
            persist: ctx.flags.persist,
            memoryBackend: ctx.flags['memory-backend'] || 'hybrid'
        };
        output.writeln();
        output.writeln(output.bold('Initializing Hive Mind'));
        const spinner = output.createSpinner({ text: 'Setting up hive infrastructure...', spinner: 'dots' });
        spinner.start();
        try {
            const result = await callMCPTool('hive-mind_init', config);
            spinner.succeed('Hive Mind initialized');
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printBox([
                `Hive ID: ${result.hiveId ?? 'default'}`,
                `Queen ID: ${result.queenId ?? 'N/A'}`,
                `Topology: ${result.topology ?? config.topology}`,
                `Consensus: ${result.consensus ?? config.consensus}`,
                `Max Agents: ${config.maxAgents}`,
                `Memory: ${config.memoryBackend}`,
                `Status: ${output.success(result.status ?? 'initialized')}`
            ].join('\n'), 'Hive Mind Configuration');
            output.writeln();
            output.printInfo('Queen agent is ready to coordinate worker agents');
            output.writeln(output.dim('  Use "monomind hive-mind spawn" to add workers'));
            output.writeln(output.dim('  Use "monomind hive-mind spawn --claude" to launch Claude Code'));
            return { success: true, data: result };
        }
        catch (error) {
            spinner.fail('Failed to initialize');
            if (error instanceof MCPClientError) {
                output.printError(`Init error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
export const hiveMindCommand = {
    name: 'hive-mind',
    aliases: ['hive'],
    description: 'Queen-led consensus-based multi-agent coordination',
    subcommands: [initCommand, spawnCommand, statusCommand, taskCommand, joinCommand, leaveCommand, consensusCommand, broadcastCommand, memorySubCommand, optimizeMemoryCommand, shutdownCommand],
    options: [],
    examples: [
        { command: 'monomind hive-mind init -t hierarchical-mesh', description: 'Initialize hive' },
        { command: 'monomind hive-mind spawn -n 5', description: 'Spawn workers' },
        { command: 'monomind hive-mind spawn --claude -o "Build a feature"', description: 'Launch Claude Code with hive mind' },
        { command: 'monomind hive-mind task -d "Build feature"', description: 'Submit task' }
    ],
    action: async () => {
        output.writeln();
        output.writeln(output.bold('Hive Mind - Consensus-Based Multi-Agent Coordination'));
        output.writeln();
        output.writeln('Usage: monomind hive-mind <subcommand> [options]');
        output.writeln();
        output.writeln('Subcommands:');
        output.printList([
            `${output.highlight('init')}            - Initialize hive mind`,
            `${output.highlight('spawn')}           - Spawn worker agents (use --claude to launch Claude Code)`,
            `${output.highlight('status')}          - Show hive status`,
            `${output.highlight('task')}            - Submit task to hive`,
            `${output.highlight('join')}            - Join an agent to the hive`,
            `${output.highlight('leave')}           - Remove an agent from the hive`,
            `${output.highlight('consensus')}       - Manage consensus proposals`,
            `${output.highlight('broadcast')}       - Broadcast message to workers`,
            `${output.highlight('memory')}          - Access shared memory`,
            `${output.highlight('optimize-memory')} - Optimize patterns and memory`,
            `${output.highlight('shutdown')}        - Shutdown the hive`
        ]);
        output.writeln();
        output.writeln('Features:');
        output.printList([
            'Queen-led hierarchical coordination',
            'Byzantine fault tolerant consensus',
            'HNSW-accelerated pattern matching',
            'Cross-session memory persistence',
            'Automatic load balancing',
            output.success('NEW: --claude flag to launch interactive Claude Code sessions')
        ]);
        output.writeln();
        output.writeln('Quick Start with Claude Code:');
        output.writeln(output.dim('  monomind hive-mind init'));
        output.writeln(output.dim('  monomind hive-mind spawn -n 5 --claude -o "Your objective here"'));
        return { success: true };
    }
};
export default hiveMindCommand;
//# sourceMappingURL=hive-mind.js.map