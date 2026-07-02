/**
 * Hive Mind spawn infrastructure — spawnClaudeCodeInstance and spawnCommand
 */
import { output } from '../output.js';
import { input } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { spawn as childSpawn, execSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve as resolvePath, sep } from 'path';
import { MAX_OBJECTIVE_LEN, MAX_AGENT_ID_LEN, groupWorkersByType, generateHiveMindPrompt, formatAgentStatus, } from './hive-mind-helpers.js';
export async function spawnClaudeCodeInstance(swarmId, swarmName, objective, workers, flags) {
    output.writeln();
    output.writeln(output.bold('🚀 Launching Claude Code with Hive Mind Coordination'));
    output.writeln(output.dim('─'.repeat(60)));
    const spinner = output.createSpinner({ text: 'Preparing Hive Mind coordination prompt...', spinner: 'dots' });
    spinner.start();
    try {
        const workerGroups = groupWorkersByType(workers);
        const hiveMindPrompt = generateHiveMindPrompt(swarmId, swarmName, objective, workers, workerGroups, flags);
        spinner.succeed('Hive Mind coordination prompt ready!');
        output.writeln();
        output.writeln(output.bold('🧠 Hive Mind Configuration'));
        output.writeln(output.dim('─'.repeat(60)));
        output.printList([
            `Swarm ID: ${output.highlight(swarmId)}`,
            `Objective: ${output.highlight(objective)}`,
            `Queen Type: ${output.highlight(flags.queenType || 'strategic')}`,
            `Worker Count: ${output.highlight(String(workers.length))}`,
            `Worker Types: ${output.highlight(Object.keys(workerGroups).join(', '))}`,
            `Consensus: ${output.highlight(flags.consensus || 'byzantine')}`,
            `MCP Tools: ${output.success('Full Monomind integration enabled')}`
        ]);
        // Ensure sessions directory exists, anchored to cwd to prevent traversal
        const baseDir = resolvePath(process.cwd());
        const sessionsDir = resolvePath(baseDir, '.hive-mind', 'sessions');
        if (!sessionsDir.startsWith(baseDir + sep) && sessionsDir !== baseDir) {
            throw new Error('Sessions directory path traversal detected');
        }
        await mkdir(sessionsDir, { recursive: true });
        const safeSwarmId = swarmId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const promptFile = join(sessionsDir, `hive-mind-prompt-${safeSwarmId}.txt`);
        if (!resolvePath(promptFile).startsWith(sessionsDir + sep)) {
            throw new Error('Prompt file path traversal detected');
        }
        await writeFile(promptFile, hiveMindPrompt, 'utf8');
        output.writeln();
        output.printSuccess(`Hive Mind prompt saved to: ${promptFile}`);
        let claudeAvailable = false;
        try {
            execSync('which claude', { stdio: 'ignore' });
            claudeAvailable = true;
        }
        catch {
            output.writeln();
            output.printWarning('Claude Code CLI not found in PATH');
            output.writeln(output.dim('Install it with: npm install -g @anthropic-ai/claude-code'));
            output.writeln(output.dim('Falling back to displaying instructions...'));
        }
        const dryRun = flags.dryRun || flags['dry-run'];
        if (claudeAvailable && !dryRun) {
            const claudeArgs = [];
            const isNonInteractive = flags['non-interactive'] || flags.nonInteractive;
            if (isNonInteractive) {
                claudeArgs.push('-p');
                claudeArgs.push('--output-format', 'stream-json');
                claudeArgs.push('--verbose');
                output.printInfo('Running in non-interactive mode');
            }
            const skipPermissions = flags['dangerously-skip-permissions'] === true && !flags['no-auto-permissions'];
            if (skipPermissions) {
                claudeArgs.push('--dangerously-skip-permissions');
                output.writeln(output.warning('WARNING: Running with --dangerously-skip-permissions: all file and shell operations will execute without prompts.'));
            }
            claudeArgs.push('--');
            claudeArgs.push(hiveMindPrompt);
            output.writeln();
            output.printInfo('Launching Claude Code...');
            output.writeln(output.dim('Press Ctrl+C to pause the session'));
            const claudeProcess = childSpawn('claude', claudeArgs, {
                stdio: 'inherit',
                shell: false,
            });
            let isExiting = false;
            const sigintHandler = () => {
                if (isExiting)
                    return;
                isExiting = true;
                output.writeln();
                output.writeln();
                output.printWarning('Pausing session and terminating Claude Code...');
                if (claudeProcess && !claudeProcess.killed) {
                    claudeProcess.kill('SIGTERM');
                }
                output.writeln();
                output.printSuccess('Session paused');
                output.writeln(output.dim(`Prompt file saved at: ${promptFile}`));
                output.writeln(output.dim('To resume, run claude with the saved prompt file'));
                process.exit(0);
            };
            process.on('SIGINT', sigintHandler);
            process.on('SIGTERM', sigintHandler);
            claudeProcess.on('exit', (code) => {
                process.removeListener('SIGINT', sigintHandler);
                process.removeListener('SIGTERM', sigintHandler);
                if (code === 0) {
                    output.writeln();
                    output.printSuccess('Claude Code completed successfully');
                }
                else if (code !== null) {
                    output.writeln();
                    output.printError(`Claude Code exited with code ${code}`);
                }
            });
            output.writeln();
            output.printSuccess('Claude Code launched with Hive Mind coordination');
            output.printInfo('The Queen coordinator will orchestrate all worker agents');
            output.writeln(output.dim(`Prompt file saved at: ${promptFile}`));
            return { success: true, promptFile };
        }
        else if (dryRun) {
            output.writeln();
            output.printInfo('Dry run - would execute Claude Code with prompt:');
            output.writeln(output.dim(`Prompt length: ${hiveMindPrompt.length} characters`));
            output.writeln();
            output.writeln(output.dim('First 500 characters of prompt:'));
            output.writeln(output.highlight(hiveMindPrompt.substring(0, 500) + '...'));
            output.writeln();
            output.writeln(output.dim(`Full prompt saved to: ${promptFile}`));
            return { success: true, promptFile };
        }
        else {
            output.writeln();
            output.writeln(output.bold('📋 Manual Execution Instructions:'));
            output.writeln(output.dim('─'.repeat(50)));
            output.printList([
                'Install Claude Code: npm install -g @anthropic-ai/claude-code',
                `Run with saved prompt: claude < ${promptFile}`,
                `Or copy manually: cat ${promptFile} | claude`,
                `With auto-permissions: claude --dangerously-skip-permissions < ${promptFile}`
            ]);
            return { success: true, promptFile };
        }
    }
    catch (error) {
        spinner.fail('Failed to prepare Claude Code coordination');
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.printError(`Error: ${errorMessage}`);
        try {
            const safeSwarmIdFallback = swarmId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const fallbackDir = resolvePath(process.cwd());
            const promptFile = join(fallbackDir, `hive-mind-prompt-${safeSwarmIdFallback}-fallback.txt`);
            if (!resolvePath(promptFile).startsWith(fallbackDir + sep)) {
                throw new Error('Fallback path traversal');
            }
            const workerGroups = groupWorkersByType(workers);
            const hiveMindPrompt = generateHiveMindPrompt(swarmId, swarmName, objective, workers, workerGroups, flags);
            await writeFile(promptFile, hiveMindPrompt, 'utf8');
            output.writeln();
            output.printSuccess(`Prompt saved to: ${promptFile}`);
            output.writeln(output.dim('You can run Claude Code manually with the saved prompt'));
            return { success: false, promptFile, error: errorMessage };
        }
        catch {
            return { success: false, error: errorMessage };
        }
    }
}
export const spawnCommand = {
    name: 'spawn',
    description: 'Spawn worker agents into the hive (use --claude to launch Claude Code)',
    options: [
        { name: 'count', short: 'n', description: 'Number of workers to spawn', type: 'number', default: 1 },
        { name: 'role', short: 'r', description: 'Worker role (worker, specialist, scout)', type: 'string', choices: ['worker', 'specialist', 'scout'], default: 'worker' },
        { name: 'type', short: 't', description: 'Agent type', type: 'string', default: 'worker' },
        { name: 'prefix', short: 'p', description: 'Prefix for worker IDs', type: 'string', default: 'hive-worker' },
        { name: 'claude', description: 'Launch Claude Code with hive-mind coordination prompt', type: 'boolean', default: false },
        { name: 'objective', short: 'o', description: 'Objective for the hive mind (used with --claude)', type: 'string' },
        { name: 'dangerously-skip-permissions', description: 'Skip permission prompts in Claude Code (use with caution)', type: 'boolean', default: false },
        { name: 'no-auto-permissions', description: 'Disable automatic permission skipping', type: 'boolean', default: false },
        { name: 'dry-run', description: 'Show what would be done without launching Claude Code', type: 'boolean', default: false },
        { name: 'non-interactive', description: 'Run Claude Code in non-interactive mode', type: 'boolean', default: false }
    ],
    examples: [
        { command: 'monomind hive-mind spawn -n 5', description: 'Spawn 5 workers' },
        { command: 'monomind hive-mind spawn -n 3 -r specialist', description: 'Spawn 3 specialists' },
        { command: 'monomind hive-mind spawn -t coder -p my-coder', description: 'Spawn coder with custom prefix' },
        { command: 'monomind hive-mind spawn --claude -o "Build a REST API"', description: 'Launch Claude Code with objective' },
        { command: 'monomind hive-mind spawn -n 5 --claude -o "Research AI patterns"', description: 'Spawn workers and launch Claude Code' }
    ],
    action: async (ctx) => {
        const rawCount = ctx.flags.count || 1;
        const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(rawCount, 50)) : 1;
        const role = ctx.flags.role || 'worker';
        const agentType = ctx.flags.type || 'worker';
        const prefix = ctx.flags.prefix || 'hive-worker';
        const launchClaude = ctx.flags.claude;
        let objective = (ctx.flags.objective || ctx.args.join(' ')).slice(0, MAX_OBJECTIVE_LEN);
        output.printInfo(`Spawning ${count} ${role} agent(s)...`);
        try {
            const result = await callMCPTool('hive-mind_spawn', { count, role, agentType, prefix });
            if (!result.success) {
                output.printError(result.error || 'Failed to spawn workers');
                return { success: false, exitCode: 1 };
            }
            if (ctx.flags.format === 'json' && !launchClaude) {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            const displayData = (result.workers || []).map(w => ({
                id: w.agentId,
                role: w.role,
                status: 'idle',
                joinedAt: new Date(w.joinedAt).toLocaleTimeString()
            }));
            output.printTable({
                columns: [
                    { key: 'id', header: 'Agent ID', width: 30 },
                    { key: 'role', header: 'Role', width: 12 },
                    { key: 'status', header: 'Status', width: 10, format: formatAgentStatus },
                    { key: 'joinedAt', header: 'Joined', width: 12 }
                ],
                data: displayData
            });
            output.writeln();
            output.printSuccess(`Spawned ${result.spawned} agent(s)`);
            output.writeln(output.dim(`  Total workers in hive: ${result.totalWorkers}`));
            if (launchClaude) {
                if (!objective && ctx.interactive) {
                    objective = await input({
                        message: 'Enter the objective for the hive mind:',
                        validate: (v) => v.length > 0 || 'Objective is required when using --claude'
                    });
                }
                if (!objective) {
                    output.writeln();
                    output.printWarning('No objective provided. Using default objective.');
                    objective = 'Coordinate the hive mind workers to complete tasks efficiently.';
                }
                let swarmId = result.hiveId || 'default';
                const swarmName = 'Hive Mind Swarm';
                try {
                    const statusResult = await callMCPTool('hive-mind_status', { includeWorkers: false });
                    swarmId = statusResult.hiveId || swarmId;
                }
                catch {
                    // Use defaults if status call fails
                }
                const workers = (result.workers || []).map(w => ({
                    agentId: w.agentId,
                    role: w.role,
                    type: agentType,
                    joinedAt: w.joinedAt
                }));
                const claudeResult = await spawnClaudeCodeInstance(swarmId, swarmName, objective, workers, ctx.flags);
                if (!claudeResult.success) {
                    return { success: false, exitCode: 1, data: { spawn: result, claude: claudeResult } };
                }
                return { success: true, data: { spawn: result, claude: claudeResult } };
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Spawn error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Re-export MAX_AGENT_ID_LEN so hive-mind-comms can import from this module if needed
export { MAX_AGENT_ID_LEN };
//# sourceMappingURL=hive-mind-spawn.js.map