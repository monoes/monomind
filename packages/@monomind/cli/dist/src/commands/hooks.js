/**
 * CLI Hooks Command
 * Self-learning hooks system for intelligent workflow automation
 *
 * This file is the main registration entry point.
 * Commands are extracted to sub-modules (ARCH-1):
 *   - hooks-core-commands.ts    — pre/post edit and command hooks
 *   - hooks-routing-commands.ts — route/explain/pretrain/build-agents/metrics/transfer/list
 *   - hooks-workers.ts          — intelligence and worker commands
 *   - hooks-coverage-commands.ts — coverage-aware routing
 *   - hooks-extended-commands.ts — token optimize, model routing, agent teams
 */
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { intelligenceCommand, workerCommand } from './hooks-workers.js';
import { coverageRouteCommand, coverageSuggestCommand, coverageGapsCommand, progressHookCommand, statuslineCommand, } from './hooks-coverage-commands.js';
import { tokenOptimizeCommand, modelRouteCommand, modelOutcomeCommand, modelStatsCommand, teammateIdleCommand, taskCompletedCommand, notifyCommand, } from './hooks-extended-commands.js';
import { preEditCommand, postEditCommand, preCommandCommand, postCommandCommand, } from './hooks-core-commands.js';
import { routeCommand, explainCommand, pretrainCommand, buildAgentsCommand, metricsCommand, transferCommand, listCommand, } from './hooks-routing-commands.js';
// Pre-task subcommand
const preTaskCommand = {
    name: 'pre-task',
    description: 'Record task start and get agent suggestions',
    options: [
        {
            name: 'task-id',
            short: 'i',
            description: 'Unique task identifier (auto-generated if omitted)',
            type: 'string'
        },
        {
            name: 'description',
            short: 'd',
            description: 'Task description',
            type: 'string',
            required: true
        },
        {
            name: 'auto-spawn',
            short: 'a',
            description: 'Auto-spawn suggested agents',
            type: 'boolean',
            default: false
        }
    ],
    examples: [
        { command: 'monomind hooks pre-task -i task-123 -d "Fix auth bug"', description: 'Record task start' },
        { command: 'monomind hooks pre-task -i task-456 -d "Implement feature" --auto-spawn', description: 'With auto-spawn' }
    ],
    action: async (ctx) => {
        const taskId = ctx.flags['task-id'] || `task-${Date.now().toString(36)}`;
        const description = ctx.args[0] || ctx.flags.description;
        if (!description) {
            output.printError('Description is required: --description "your task"');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Starting task: ${output.highlight(taskId)}`);
        try {
            const result = await callMCPTool('hooks_pre-task', {
                taskId,
                description,
                autoSpawn: ctx.flags['auto-spawn'] || false,
                timestamp: Date.now(),
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printBox([
                `Task ID: ${result.taskId}`,
                `Description: ${result.description}`,
                `Complexity: ${result.complexity.toUpperCase()}`,
                `Est. Duration: ${result.estimatedDuration}`
            ].join('\n'), 'Task Registered');
            if (result.suggestedAgents.length > 0) {
                output.writeln();
                output.writeln(output.bold('Suggested Agents'));
                output.printTable({
                    columns: [
                        { key: 'type', header: 'Agent Type', width: 20 },
                        { key: 'confidence', header: 'Confidence', width: 12, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(1)}%` },
                        { key: 'reason', header: 'Reason', width: 35 }
                    ],
                    data: result.suggestedAgents
                });
            }
            if (result.risks.length > 0) {
                output.writeln();
                output.writeln(output.bold(output.error('Potential Risks')));
                output.printList(result.risks.map(r => output.warning(r)));
            }
            if (result.recommendations.length > 0) {
                output.writeln();
                output.writeln(output.bold('Recommendations'));
                output.printList(result.recommendations);
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Pre-task hook failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Post-task subcommand
const postTaskCommand = {
    name: 'post-task',
    description: 'Record task completion for learning',
    options: [
        {
            name: 'task-id',
            short: 'i',
            description: 'Task identifier',
            type: 'string',
            required: true
        },
        {
            name: 'success',
            short: 's',
            description: 'Whether the task succeeded',
            type: 'boolean',
            required: false
        },
        {
            name: 'duration',
            short: 'd',
            description: 'Task duration in milliseconds',
            type: 'number'
        },
        {
            name: 'outcome',
            short: 'o',
            description: 'Outcome description',
            type: 'string'
        }
    ],
    examples: [
        { command: 'monomind hooks post-task -i task-123 --success true', description: 'Record successful task' },
        { command: 'monomind hooks post-task -i task-456 --success false -o "Build failed"', description: 'Record failed task' }
    ],
    action: async (ctx) => {
        const taskId = ctx.args[0] || ctx.flags['task-id'];
        // Default success to true for backward compatibility
        const success = ctx.flags.success !== undefined ? ctx.flags.success : true;
        if (!taskId) {
            output.printError('Task ID is required. Use --task-id or -i flag.');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Recording task completion: ${output.highlight(taskId)}`);
        try {
            const result = await callMCPTool('hooks_post-task', {
                taskId,
                success,
                duration: ctx.flags.duration,
                outcome: ctx.flags.outcome,
                timestamp: Date.now(),
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printSuccess(`Task ${taskId} recorded as ${success ? 'successful' : 'failed'}`);
            if (result.learningUpdates) {
                output.writeln();
                output.writeln(output.dim(`Agent patterns updated: ${result.learningUpdates.agentPatternsUpdated}`));
                output.writeln(output.dim(`Strategies learned: ${result.learningUpdates.taskStrategiesLearned}`));
                output.writeln(output.dim(`Complexity model: ${result.learningUpdates.complexityModelUpdated ? 'Updated' : 'No change'}`));
            }
            if (result.nextRecommendations && result.nextRecommendations.length > 0) {
                output.writeln();
                output.writeln(output.bold('Recommendations for Next Task'));
                output.printList(result.nextRecommendations);
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Post-task hook failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Session-end subcommand
const sessionEndCommand = {
    name: 'session-end',
    description: 'End current session and persist state',
    options: [
        {
            name: 'save-state',
            short: 's',
            description: 'Save session state for later restoration',
            type: 'boolean',
            default: true
        }
    ],
    examples: [
        { command: 'monomind hooks session-end', description: 'End and save session' },
        { command: 'monomind hooks session-end --save-state false', description: 'End without saving' }
    ],
    action: async (ctx) => {
        output.printInfo('Ending session...');
        try {
            const result = await callMCPTool('hooks_session-end', {
                saveState: ctx.flags['save-state'] ?? true,
                timestamp: Date.now(),
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printSuccess(`Session ${result.sessionId} ended`);
            output.writeln();
            output.writeln(output.bold('Session Summary'));
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 25 },
                    { key: 'value', header: 'Value', width: 15, align: 'right' }
                ],
                data: [
                    { metric: 'Duration', value: `${(result.duration / 1000 / 60).toFixed(1)} min` },
                    { metric: 'Tasks Executed', value: result.summary.tasksExecuted },
                    { metric: 'Tasks Succeeded', value: output.success(String(result.summary.tasksSucceeded)) },
                    { metric: 'Tasks Failed', value: output.error(String(result.summary.tasksFailed)) },
                    { metric: 'Commands Executed', value: result.summary.commandsExecuted },
                    { metric: 'Files Modified', value: result.summary.filesModified },
                    { metric: 'Agents Spawned', value: result.summary.agentsSpawned }
                ]
            });
            if (result.statePath) {
                output.writeln();
                output.writeln(output.dim(`State saved to: ${result.statePath}`));
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Session-end hook failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Session-restore subcommand
const sessionRestoreCommand = {
    name: 'session-restore',
    description: 'Restore a previous session',
    options: [
        {
            name: 'session-id',
            short: 'i',
            description: 'Session ID to restore (use "latest" for most recent)',
            type: 'string',
            default: 'latest'
        },
        {
            name: 'restore-agents',
            short: 'a',
            description: 'Restore spawned agents',
            type: 'boolean',
            default: true
        },
        {
            name: 'restore-tasks',
            short: 't',
            description: 'Restore active tasks',
            type: 'boolean',
            default: true
        }
    ],
    examples: [
        { command: 'monomind hooks session-restore', description: 'Restore latest session' },
        { command: 'monomind hooks session-restore -i session-12345', description: 'Restore specific session' }
    ],
    action: async (ctx) => {
        const sessionId = ctx.args[0] || ctx.flags['session-id'] || 'latest';
        output.printInfo(`Restoring session: ${output.highlight(sessionId)}`);
        try {
            const result = await callMCPTool('hooks_session-restore', {
                sessionId,
                restoreAgents: ctx.flags['restore-agents'] ?? true,
                restoreTasks: ctx.flags['restore-tasks'] ?? true,
                timestamp: Date.now(),
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printSuccess(`Session restored from ${result.originalSessionId}`);
            output.writeln(output.dim(`New session ID: ${result.sessionId}`));
            output.writeln();
            output.writeln(output.bold('Restored State'));
            output.printTable({
                columns: [
                    { key: 'item', header: 'Item', width: 25 },
                    { key: 'count', header: 'Count', width: 15, align: 'right' }
                ],
                data: [
                    { item: 'Tasks', count: result.restoredState.tasksRestored },
                    { item: 'Agents', count: result.restoredState.agentsRestored },
                    { item: 'Memory Entries', count: result.restoredState.memoryRestored }
                ]
            });
            if (result.warnings && result.warnings.length > 0) {
                output.writeln();
                output.writeln(output.bold(output.warning('Warnings')));
                output.printList(result.warnings.map(w => output.warning(w)));
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Session-restore hook failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Backward-compatible aliases for v2 hooks
// These ensure old settings.json files continue to work
const routeTaskCommand = {
    name: 'route-task',
    description: '(DEPRECATED: Use "route" instead) Route task to optimal agent',
    options: routeCommand.options,
    examples: [
        { command: 'monomind hooks route-task --auto-swarm true', description: 'Route with auto-swarm (v2 compat)' },
    ],
    action: async (ctx) => {
        // Silently handle v2-specific flags that don't exist in v1
        // --auto-swarm, --detect-complexity are ignored but don't fail
        if (routeCommand.action) {
            const result = await routeCommand.action(ctx);
            return result || { success: true };
        }
        return { success: true };
    }
};
const sessionStartCommand = {
    name: 'session-start',
    description: '(DEPRECATED: Use "session-restore" instead) Start/restore session',
    options: [
        ...(sessionRestoreCommand.options || []),
        // V2-compatible options that are silently ignored
        {
            name: 'auto-configure',
            description: '(v2 compat) Auto-configure session',
            type: 'boolean',
            default: false
        },
        {
            name: 'restore-context',
            description: '(v2 compat) Restore context',
            type: 'boolean',
            default: false
        }
    ],
    examples: [
        { command: 'monomind hooks session-start --auto-configure true', description: 'Start session (v2 compat)' },
    ],
    action: async (ctx) => {
        // Map to session-restore for backward compatibility
        if (sessionRestoreCommand.action) {
            const result = await sessionRestoreCommand.action(ctx);
            return result || { success: true };
        }
        return { success: true };
    }
};
// Pre-bash alias for pre-command (v2 compat)
const preBashCommand = {
    name: 'pre-bash',
    description: '(ALIAS) Same as pre-command',
    options: preCommandCommand.options,
    examples: preCommandCommand.examples,
    action: preCommandCommand.action
};
// Post-bash alias for post-command (v2 compat)
const postBashCommand = {
    name: 'post-bash',
    description: '(ALIAS) Same as post-command',
    options: postCommandCommand.options,
    examples: postCommandCommand.examples,
    action: postCommandCommand.action
};
// Main hooks command
export const hooksCommand = {
    name: 'hooks',
    description: 'Self-learning hooks system for intelligent workflow automation',
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
        buildAgentsCommand,
        metricsCommand,
        transferCommand,
        listCommand,
        intelligenceCommand,
        notifyCommand,
        workerCommand,
        progressHookCommand,
        statuslineCommand,
        // Coverage-aware routing commands
        coverageRouteCommand,
        coverageSuggestCommand,
        coverageGapsCommand,
        // Token optimization
        tokenOptimizeCommand,
        // Model routing (tiny-dancer integration)
        modelRouteCommand,
        modelOutcomeCommand,
        modelStatsCommand,
        // Backward-compatible aliases for v2
        routeTaskCommand,
        sessionStartCommand,
        preBashCommand,
        postBashCommand,
        // Agent Teams integration
        teammateIdleCommand,
        taskCompletedCommand,
    ],
    options: [],
    examples: [
        { command: 'monomind hooks pre-edit -f src/utils.ts', description: 'Get context before editing' },
        { command: 'monomind hooks route -t "Fix authentication bug"', description: 'Route task to optimal agent' },
        { command: 'monomind hooks pretrain', description: 'Bootstrap intelligence from repository' },
        { command: 'monomind hooks metrics --v1-dashboard', description: 'View v1 performance metrics' }
    ],
    action: async (ctx) => {
        output.writeln();
        output.writeln(output.bold('Self-Learning Hooks System'));
        output.writeln();
        output.writeln('Intelligent workflow automation with pattern learning and adaptive routing');
        output.writeln();
        output.writeln('Usage: monomind hooks <subcommand> [options]');
        output.writeln();
        output.writeln('Subcommands:');
        output.printList([
            `${output.highlight('pre-edit')}        - Get context before editing files`,
            `${output.highlight('post-edit')}       - Record editing outcomes for learning`,
            `${output.highlight('pre-command')}     - Assess risk before executing commands`,
            `${output.highlight('post-command')}    - Record command execution outcomes`,
            `${output.highlight('pre-task')}        - Record task start and get agent suggestions`,
            `${output.highlight('post-task')}       - Record task completion for learning`,
            `${output.highlight('session-end')}     - End current session and persist state`,
            `${output.highlight('session-restore')} - Restore a previous session`,
            `${output.highlight('route')}           - Route tasks to optimal agents`,
            `${output.highlight('explain')}         - Explain routing decisions`,
            `${output.highlight('pretrain')}        - Bootstrap intelligence from repository`,
            `${output.highlight('build-agents')}    - Generate optimized agent configs`,
            `${output.highlight('metrics')}         - View learning metrics dashboard`,
            `${output.highlight('transfer')}        - Transfer patterns from another project`,
            `${output.highlight('list')}            - List all registered hooks`,
            `${output.highlight('worker')}          - Background worker management (12 workers)`,
            `${output.highlight('progress')}        - Check implementation progress`,
            `${output.highlight('statusline')}      - Generate dynamic statusline display`,
            `${output.highlight('coverage-route')}  - Route tasks based on coverage gaps (monovector)`,
            `${output.highlight('coverage-suggest')}- Suggest coverage improvements`,
            `${output.highlight('coverage-gaps')}   - List all coverage gaps with agents`,
            `${output.highlight('token-optimize')} - Token optimization (30-50% savings)`,
            `${output.highlight('model-route')}    - Route to optimal model (haiku/sonnet/opus)`,
            `${output.highlight('model-outcome')}  - Record model routing outcome`,
            `${output.highlight('model-stats')}    - View model routing statistics`,
            '',
            output.bold('Agent Teams:'),
            `${output.highlight('teammate-idle')}  - Handle idle teammate (auto-assign tasks)`,
            `${output.highlight('task-completed')} - Handle task completion (train patterns)`
        ]);
        output.writeln();
        output.writeln('Run "monomind hooks <subcommand> --help" for subcommand help');
        output.writeln();
        output.writeln(output.bold('v1 Features:'));
        output.printList([
            '🧠 Trajectory + outcome logging',
            '🎯 Keyword routing + route-outcome measurement',
            '🔍 LanceDB integration (ANN vector search)',
            '🎯 32.3% token reduction',
            '👥 Agent Teams integration (auto task assignment)'
        ]);
        return { success: true };
    }
};
export default hooksCommand;
//# sourceMappingURL=hooks.js.map