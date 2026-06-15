/**
 * CLI Hive Mind Command
 * Queen-led consensus-based multi-agent coordination
 *
 * Updated to support --claude flag for launching interactive Claude Code sessions
 * PR: Fix #955 - Implement --claude flag for hive-mind spawn command
 */
import { output } from '../output.js';
import { select, confirm, input } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { spawn as childSpawn, execSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve as resolvePath, sep } from 'path';
// Input length caps
const MAX_OBJECTIVE_LEN = 2_000;
const MAX_TASK_DESC_LEN = 4_000;
const MAX_MESSAGE_LEN = 2_000;
const MAX_KEY_LEN = 256;
const MAX_VALUE_LEN = 65_536;
const MAX_AGENT_ID_LEN = 128;
// Hive topologies
const TOPOLOGIES = [
    { value: 'hierarchical', label: 'Hierarchical', hint: 'Queen-led with worker agents' },
    { value: 'mesh', label: 'Mesh', hint: 'Peer-to-peer coordination' },
    { value: 'hierarchical-mesh', label: 'Hierarchical Mesh', hint: 'Queen + peer communication (recommended)' },
    { value: 'adaptive', label: 'Adaptive', hint: 'Dynamic topology based on task' }
];
// Consensus strategies
const CONSENSUS_STRATEGIES = [
    { value: 'byzantine', label: 'Byzantine Fault Tolerant', hint: '2/3 majority, handles malicious actors' },
    { value: 'raft', label: 'Raft', hint: 'Leader-based consensus' },
    { value: 'gossip', label: 'Gossip', hint: 'Eventually consistent, scalable' },
    { value: 'crdt', label: 'CRDT', hint: 'Conflict-free replicated data' },
    { value: 'quorum', label: 'Quorum', hint: 'Simple majority voting' }
];
/**
 * Group workers by their type for prompt generation
 */
function groupWorkersByType(workers) {
    const groups = {};
    for (const worker of workers) {
        const type = worker.type || worker.role || 'worker';
        if (!groups[type]) {
            groups[type] = [];
        }
        groups[type].push(worker);
    }
    return groups;
}
/**
 * Generate comprehensive Hive Mind prompt for Claude Code
 * Ported from v2.7.47 with enhancements for v1
 */
function generateHiveMindPrompt(swarmId, swarmName, objective, workers, workerGroups, flags) {
    const currentTime = new Date().toISOString();
    const workerTypes = Object.keys(workerGroups);
    const queenType = flags.queenType || 'strategic';
    const consensusAlgorithm = flags.consensus || 'byzantine';
    const topology = flags.topology || 'hierarchical-mesh';
    return `🧠 HIVE MIND COLLECTIVE INTELLIGENCE SYSTEM
═══════════════════════════════════════════════

You are the Queen coordinator of a Hive Mind swarm with collective intelligence capabilities.

HIVE MIND CONFIGURATION:
📌 Swarm ID: ${swarmId}
📌 Swarm Name: ${swarmName}
🎯 Objective: ${objective}
👑 Queen Type: ${queenType}
🐝 Worker Count: ${workers.length}
🔗 Topology: ${topology}
🤝 Consensus Algorithm: ${consensusAlgorithm}
⏰ Initialized: ${currentTime}

WORKER DISTRIBUTION:
${workerTypes.map(type => `• ${type}: ${workerGroups[type].length} agents`).join('\n')}

🔧 AVAILABLE MCP TOOLS FOR HIVE MIND COORDINATION:

1️⃣ **COLLECTIVE INTELLIGENCE**
   mcp__monomind__hive-mind_consensus    - Democratic decision making
   mcp__monomind__hive-mind_memory       - Share knowledge across the hive
   mcp__monomind__hive-mind_broadcast    - Broadcast to all workers
   mcp__monomind__neural_patterns        - Neural pattern recognition

2️⃣ **QUEEN COORDINATION**
   mcp__monomind__hive-mind_status       - Monitor swarm health
   mcp__monomind__task_create            - Create and delegate tasks
   mcp__monomind__coordination_orchestrate - Orchestrate task distribution
   mcp__monomind__agent_spawn            - Spawn additional workers

3️⃣ **WORKER MANAGEMENT**
   mcp__monomind__agent_list             - List all active agents
   mcp__monomind__agent_status           - Check agent status
   mcp__monomind__agent_health           - Check worker health
   mcp__monomind__hive-mind_join         - Add agent to hive
   mcp__monomind__hive-mind_leave        - Remove agent from hive

4️⃣ **TASK ORCHESTRATION**
   mcp__monomind__task_assign            - Assign tasks to workers
   mcp__monomind__task_status            - Track task progress
   mcp__monomind__task_complete          - Mark tasks complete
   mcp__monomind__workflow_create        - Create workflows

5️⃣ **MEMORY & LEARNING**
   mcp__monomind__memory_store           - Store collective knowledge
   mcp__monomind__memory_retrieve        - Access shared memory
   mcp__monomind__memory_search          - Search memory patterns
   mcp__monomind__neural_train           - Learn from experiences
   mcp__monomind__hooks_intelligence_pattern-store - Store patterns

📋 HIVE MIND EXECUTION PROTOCOL:

1. **INITIALIZATION PHASE**
   - Verify all workers are online and responsive
   - Establish communication channels
   - Load previous session state if available
   - Initialize shared memory space

2. **TASK DISTRIBUTION PHASE**
   - Analyze the objective and decompose into subtasks
   - Assign tasks based on worker specializations
   - Set up task dependencies and ordering
   - Monitor parallel execution

3. **COORDINATION PHASE**
   - Use consensus for critical decisions
   - Aggregate results from workers
   - Resolve conflicts using ${consensusAlgorithm} consensus
   - Share learnings across the hive

4. **COMPLETION PHASE**
   - Verify all subtasks are complete
   - Consolidate results
   - Store learnings in collective memory
   - Report final status

🎯 YOUR OBJECTIVE:
${objective}

⚠️ CRITICAL — TOOL PREFERENCE RULES (#1422):
• You MUST use Monomind MCP tools (mcp__monomind__*) for ALL orchestration tasks
• Do NOT use Claude native Task/Agent tools for swarm coordination — use mcp__monomind__agent_spawn, mcp__monomind__task_assign, etc.
• Native Claude tools (Read, Write, Edit, Bash, Grep, Glob) should ONLY be used for file operations and shell commands
• All agent spawning, task assignment, memory, and coordination MUST go through mcp__monomind__* tools
• If a Monomind MCP tool exists for an operation, always prefer it over any native equivalent

💡 COORDINATION TIPS:
• Use mcp__monomind__hive-mind_broadcast for swarm-wide announcements
• Check worker status regularly with mcp__monomind__hive-mind_status
• Store important decisions in shared memory for persistence
• Use consensus for any decisions affecting multiple workers
• Use mcp__monomind__task_assign to assign tasks to workers, then mcp__monomind__task_complete when done

🚀 BEGIN HIVE MIND COORDINATION NOW!
Start by checking the current hive status and then proceed with the objective.
`;
}
/**
 * Spawn Claude Code with Hive Mind coordination instructions
 * Ported from v2.7.47 spawnClaudeCodeInstances function
 */
async function spawnClaudeCodeInstance(swarmId, swarmName, objective, workers, flags) {
    output.writeln();
    output.writeln(output.bold('🚀 Launching Claude Code with Hive Mind Coordination'));
    output.writeln(output.dim('─'.repeat(60)));
    const spinner = output.createSpinner({ text: 'Preparing Hive Mind coordination prompt...', spinner: 'dots' });
    spinner.start();
    try {
        // Generate comprehensive Hive Mind prompt
        const workerGroups = groupWorkersByType(workers);
        const hiveMindPrompt = generateHiveMindPrompt(swarmId, swarmName, objective, workers, workerGroups, flags);
        spinner.succeed('Hive Mind coordination prompt ready!');
        // Display coordination summary
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
        // Ensure sessions directory exists (anchor to process.cwd() so relative paths
        // don't escape when the caller changes directory)
        const baseDir = resolvePath(process.cwd());
        const sessionsDir = resolvePath(baseDir, '.hive-mind', 'sessions');
        // Guard: sessions directory must stay inside cwd
        if (!sessionsDir.startsWith(baseDir + sep) && sessionsDir !== baseDir) {
            throw new Error('Sessions directory path traversal detected');
        }
        await mkdir(sessionsDir, { recursive: true });
        const safeSwarmId = swarmId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const promptFile = join(sessionsDir, `hive-mind-prompt-${safeSwarmId}.txt`);
        // Guard: prompt file must stay inside sessions directory
        if (!resolvePath(promptFile).startsWith(sessionsDir + sep)) {
            throw new Error('Prompt file path traversal detected');
        }
        await writeFile(promptFile, hiveMindPrompt, 'utf8');
        output.writeln();
        output.printSuccess(`Hive Mind prompt saved to: ${promptFile}`);
        // Check if claude command exists
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
            // Build arguments - flags first, then prompt
            const claudeArgs = [];
            // Check for non-interactive mode
            const isNonInteractive = flags['non-interactive'] || flags.nonInteractive;
            if (isNonInteractive) {
                claudeArgs.push('-p'); // Print mode
                claudeArgs.push('--output-format', 'stream-json');
                claudeArgs.push('--verbose');
                output.printInfo('Running in non-interactive mode');
            }
            // Add auto-permission flag only when explicitly requested
            const skipPermissions = flags['dangerously-skip-permissions'] === true && !flags['no-auto-permissions'];
            if (skipPermissions) {
                claudeArgs.push('--dangerously-skip-permissions');
                output.writeln(output.warning('WARNING: Running with --dangerously-skip-permissions: all file and shell operations will execute without prompts.'));
            }
            // '--' ends option parsing so the prompt cannot be interpreted as a flag
            claudeArgs.push('--');
            claudeArgs.push(hiveMindPrompt);
            output.writeln();
            output.printInfo('Launching Claude Code...');
            output.writeln(output.dim('Press Ctrl+C to pause the session'));
            // Spawn claude with properly ordered arguments
            const claudeProcess = childSpawn('claude', claudeArgs, {
                stdio: 'inherit',
                shell: false,
            });
            // Set up SIGINT handler for session management
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
            // Handle process exit
            claudeProcess.on('exit', (code) => {
                // Clean up signal handlers
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
            // Claude not available - show instructions
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
        // Try to save prompt as fallback — write inside cwd to avoid path issues
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
// Init subcommand
const initCommand = {
    name: 'init',
    description: 'Initialize a hive mind',
    options: [
        {
            name: 'topology',
            short: 't',
            description: 'Hive topology',
            type: 'string',
            choices: TOPOLOGIES.map(t => t.value),
            default: 'hierarchical-mesh'
        },
        {
            name: 'consensus',
            short: 'c',
            description: 'Consensus strategy',
            type: 'string',
            choices: CONSENSUS_STRATEGIES.map(s => s.value),
            default: 'byzantine'
        },
        {
            name: 'max-agents',
            short: 'm',
            description: 'Maximum agents',
            type: 'number',
            default: 15
        },
        {
            name: 'persist',
            short: 'p',
            description: 'Enable persistent state',
            type: 'boolean',
            default: true
        },
        {
            name: 'memory-backend',
            description: 'Memory backend (agentdb, sqlite, hybrid)',
            type: 'string',
            default: 'hybrid'
        }
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
// Spawn subcommand - UPDATED with --claude flag
const spawnCommand = {
    name: 'spawn',
    description: 'Spawn worker agents into the hive (use --claude to launch Claude Code)',
    options: [
        {
            name: 'count',
            short: 'n',
            description: 'Number of workers to spawn',
            type: 'number',
            default: 1
        },
        {
            name: 'role',
            short: 'r',
            description: 'Worker role (worker, specialist, scout)',
            type: 'string',
            choices: ['worker', 'specialist', 'scout'],
            default: 'worker'
        },
        {
            name: 'type',
            short: 't',
            description: 'Agent type',
            type: 'string',
            default: 'worker'
        },
        {
            name: 'prefix',
            short: 'p',
            description: 'Prefix for worker IDs',
            type: 'string',
            default: 'hive-worker'
        },
        // NEW: --claude flag for launching Claude Code
        {
            name: 'claude',
            description: 'Launch Claude Code with hive-mind coordination prompt',
            type: 'boolean',
            default: false
        },
        {
            name: 'objective',
            short: 'o',
            description: 'Objective for the hive mind (used with --claude)',
            type: 'string'
        },
        {
            name: 'dangerously-skip-permissions',
            description: 'Skip permission prompts in Claude Code (use with caution)',
            type: 'boolean',
            default: false
        },
        {
            name: 'no-auto-permissions',
            description: 'Disable automatic permission skipping',
            type: 'boolean',
            default: false
        },
        {
            name: 'dry-run',
            description: 'Show what would be done without launching Claude Code',
            type: 'boolean',
            default: false
        },
        {
            name: 'non-interactive',
            description: 'Run Claude Code in non-interactive mode',
            type: 'boolean',
            default: false
        }
    ],
    examples: [
        { command: 'monomind hive-mind spawn -n 5', description: 'Spawn 5 workers' },
        { command: 'monomind hive-mind spawn -n 3 -r specialist', description: 'Spawn 3 specialists' },
        { command: 'monomind hive-mind spawn -t coder -p my-coder', description: 'Spawn coder with custom prefix' },
        { command: 'monomind hive-mind spawn --claude -o "Build a REST API"', description: 'Launch Claude Code with objective' },
        { command: 'monomind hive-mind spawn -n 5 --claude -o "Research AI patterns"', description: 'Spawn workers and launch Claude Code' }
    ],
    action: async (ctx) => {
        // Parse count with fallback to default
        const rawCount = ctx.flags.count || 1;
        const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(rawCount, 50)) : 1;
        const role = ctx.flags.role || 'worker';
        const agentType = ctx.flags.type || 'worker';
        const prefix = ctx.flags.prefix || 'hive-worker';
        const launchClaude = ctx.flags.claude;
        let objective = (ctx.flags.objective || ctx.args.join(' ')).slice(0, MAX_OBJECTIVE_LEN);
        output.printInfo(`Spawning ${count} ${role} agent(s)...`);
        try {
            const result = await callMCPTool('hive-mind_spawn', {
                count,
                role,
                agentType,
                prefix,
            });
            // Check for errors from MCP tool
            if (!result.success) {
                output.printError(result.error || 'Failed to spawn workers');
                return { success: false, exitCode: 1 };
            }
            if (ctx.flags.format === 'json' && !launchClaude) {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            // Transform workers array to display format
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
            // NEW: Handle --claude flag
            if (launchClaude) {
                // Get objective if not provided
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
                // Get hive status for swarm info
                let swarmId = result.hiveId || 'default';
                let swarmName = 'Hive Mind Swarm';
                try {
                    const statusResult = await callMCPTool('hive-mind_status', { includeWorkers: false });
                    swarmId = statusResult.hiveId || swarmId;
                }
                catch {
                    // Use defaults if status call fails
                }
                // Convert workers to expected format
                const workers = (result.workers || []).map(w => ({
                    agentId: w.agentId,
                    role: w.role,
                    type: agentType,
                    joinedAt: w.joinedAt
                }));
                // Launch Claude Code with hive mind prompt
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
// Status subcommand
const statusCommand = {
    name: 'status',
    description: 'Show hive mind status',
    options: [
        {
            name: 'detailed',
            short: 'd',
            description: 'Show detailed metrics',
            type: 'boolean',
            default: false
        },
        {
            name: 'watch',
            short: 'w',
            description: 'Watch for changes',
            type: 'boolean',
            default: false
        }
    ],
    action: async (ctx) => {
        const detailed = ctx.flags.detailed;
        try {
            const result = await callMCPTool('hive-mind_status', {
                includeMetrics: detailed,
                includeWorkers: true,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            // Handle both simple and complex response formats - cast to flexible type
            const flexResult = result;
            const hiveId = result.hiveId ?? flexResult.id ?? 'default';
            const status = result.status ?? (flexResult.initialized ? 'running' : 'stopped');
            const queen = result.queen ?? { id: 'N/A', status: 'unknown', load: 0, tasksQueued: 0 };
            const flexQueen = queen;
            const queenId = typeof queen === 'object' ? (queen.id ?? flexQueen.agentId ?? 'N/A') : String(queen);
            const queenLoad = typeof queen === 'object' ? (queen.load ?? 0) : 0;
            const queenTasks = typeof queen === 'object' ? (queen.tasksQueued ?? 0) : 0;
            const queenStatus = typeof queen === 'object' ? (queen.status ?? 'active') : 'active';
            output.writeln();
            output.printBox([
                `Hive ID: ${hiveId}`,
                `Status: ${formatHiveStatus(String(status))}`,
                `Topology: ${result.topology ?? 'mesh'}`,
                `Consensus: ${result.consensus ?? 'byzantine'}`,
                '',
                `Queen: ${queenId}`,
                `  Status: ${formatAgentStatus(queenStatus)}`,
                `  Load: ${(queenLoad * 100).toFixed(1)}%`,
                `  Queued Tasks: ${queenTasks}`
            ].join('\n'), 'Hive Mind Status');
            // Handle workers array - could be worker objects or just IDs
            const workers = result.workers ?? [];
            const workerData = Array.isArray(workers) ? workers.map(w => {
                if (typeof w === 'string') {
                    return { id: w, type: 'worker', status: 'idle', currentTask: '-', tasksCompleted: 0 };
                }
                const flexWorker = w;
                return {
                    id: w.id ?? flexWorker.agentId ?? 'unknown',
                    type: w.type ?? flexWorker.agentType ?? 'worker',
                    status: w.status ?? 'idle',
                    currentTask: w.currentTask ?? '-',
                    tasksCompleted: w.tasksCompleted ?? 0
                };
            }) : [];
            output.writeln();
            output.writeln(output.bold('Worker Agents'));
            if (workerData.length === 0) {
                output.printInfo('No workers in hive. Use "monomind hive-mind spawn" to add workers.');
            }
            else {
                output.printTable({
                    columns: [
                        { key: 'id', header: 'ID', width: 20 },
                        { key: 'type', header: 'Type', width: 12 },
                        { key: 'status', header: 'Status', width: 10, format: formatAgentStatus },
                        { key: 'currentTask', header: 'Current Task', width: 20, format: (v) => String(v || '-') },
                        { key: 'tasksCompleted', header: 'Completed', width: 10, align: 'right' }
                    ],
                    data: workerData
                });
            }
            if (detailed) {
                const metrics = result.metrics ?? { totalTasks: 0, completedTasks: 0, failedTasks: 0, avgTaskTime: 0, consensusRounds: 0, memoryUsage: '0 MB' };
                output.writeln();
                output.writeln(output.bold('Metrics'));
                output.printTable({
                    columns: [
                        { key: 'metric', header: 'Metric', width: 20 },
                        { key: 'value', header: 'Value', width: 15, align: 'right' }
                    ],
                    data: [
                        { metric: 'Total Tasks', value: metrics.totalTasks ?? 0 },
                        { metric: 'Completed', value: metrics.completedTasks ?? 0 },
                        { metric: 'Failed', value: metrics.failedTasks ?? 0 },
                        { metric: 'Avg Task Time', value: `${(metrics.avgTaskTime ?? 0).toFixed(1)}ms` },
                        { metric: 'Consensus Rounds', value: metrics.consensusRounds ?? 0 },
                        { metric: 'Memory Usage', value: metrics.memoryUsage ?? '0 MB' }
                    ]
                });
                const health = result.health ?? { overall: 'healthy', queen: 'healthy', workers: 'healthy', consensus: 'healthy', memory: 'healthy' };
                output.writeln();
                output.writeln(output.bold('Health'));
                output.printList([
                    `Overall: ${formatHealth(health.overall ?? 'healthy')}`,
                    `Queen: ${formatHealth(health.queen ?? 'healthy')}`,
                    `Workers: ${formatHealth(health.workers ?? 'healthy')}`,
                    `Consensus: ${formatHealth(health.consensus ?? 'healthy')}`,
                    `Memory: ${formatHealth(health.memory ?? 'healthy')}`
                ]);
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Status error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Task subcommand
const taskCommand = {
    name: 'task',
    description: 'Submit tasks to the hive',
    options: [
        {
            name: 'description',
            short: 'd',
            description: 'Task description',
            type: 'string'
        },
        {
            name: 'priority',
            short: 'p',
            description: 'Task priority',
            type: 'string',
            choices: ['low', 'normal', 'high', 'critical'],
            default: 'normal'
        },
        {
            name: 'require-consensus',
            short: 'c',
            description: 'Require consensus for completion',
            type: 'boolean',
            default: false
        },
        {
            name: 'timeout',
            description: 'Task timeout in seconds',
            type: 'number',
            default: 300
        }
    ],
    examples: [
        { command: 'monomind hive-mind task -d "Implement auth module"', description: 'Submit task' },
        { command: 'monomind hive-mind task -d "Security review" -p critical -c', description: 'Critical task with consensus' }
    ],
    action: async (ctx) => {
        let description = (ctx.flags.description || ctx.args.join(' ')).slice(0, MAX_TASK_DESC_LEN);
        if (!description && ctx.interactive) {
            description = await input({
                message: 'Task description:',
                validate: (v) => v.length > 0 || 'Description is required'
            });
            description = description.slice(0, MAX_TASK_DESC_LEN);
        }
        if (!description) {
            output.printError('Task description is required');
            return { success: false, exitCode: 1 };
        }
        const priority = ctx.flags.priority;
        const requireConsensus = ctx.flags['require-consensus'];
        const timeout = ctx.flags.timeout;
        output.printInfo('Submitting task to hive...');
        try {
            const result = await callMCPTool('hive-mind_task', {
                description,
                priority,
                requireConsensus,
                timeout,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printBox([
                `Task ID: ${result.taskId}`,
                `Status: ${formatAgentStatus(result.status)}`,
                `Priority: ${formatPriority(priority)}`,
                `Assigned: ${result.assignedTo.join(', ')}`,
                `Consensus: ${result.requiresConsensus ? 'Yes' : 'No'}`,
                `Est. Time: ${result.estimatedTime}`
            ].join('\n'), 'Task Submitted');
            output.writeln();
            output.printSuccess('Task submitted to hive');
            output.writeln(output.dim(`  Track with: monomind hive-mind task-status ${result.taskId}`));
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Task submission error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Optimize memory subcommand
const optimizeMemoryCommand = {
    name: 'optimize-memory',
    description: 'Optimize hive memory and patterns',
    options: [
        {
            name: 'aggressive',
            short: 'a',
            description: 'Aggressive optimization',
            type: 'boolean',
            default: false
        },
        {
            name: 'threshold',
            description: 'Quality threshold for pattern retention',
            type: 'number',
            default: 0.7
        }
    ],
    action: async (ctx) => {
        const aggressive = ctx.flags.aggressive;
        const threshold = ctx.flags.threshold;
        output.printInfo('Optimizing hive memory...');
        const spinner = output.createSpinner({ text: 'Analyzing patterns...', spinner: 'dots' });
        spinner.start();
        try {
            const result = await callMCPTool('hive-mind_optimize-memory', {
                aggressive,
                qualityThreshold: threshold,
            });
            spinner.succeed('Memory optimized');
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 20 },
                    { key: 'before', header: 'Before', width: 15, align: 'right' },
                    { key: 'after', header: 'After', width: 15, align: 'right' }
                ],
                data: [
                    { metric: 'Patterns', before: result.before.patterns, after: result.after.patterns },
                    { metric: 'Memory', before: result.before.memory, after: result.after.memory }
                ]
            });
            output.writeln();
            output.printList([
                `Patterns removed: ${result.removed}`,
                `Patterns consolidated: ${result.consolidated}`,
                `Optimization time: ${result.timeMs}ms`
            ]);
            return { success: true, data: result };
        }
        catch (error) {
            spinner.fail('Optimization failed');
            if (error instanceof MCPClientError) {
                output.printError(`Optimization error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Join subcommand
const joinCommand = {
    name: 'join',
    description: 'Join an agent to the hive mind',
    options: [
        { name: 'agent-id', short: 'a', description: 'Agent ID to join', type: 'string' },
        { name: 'role', short: 'r', description: 'Agent role (worker, specialist, scout)', type: 'string', default: 'worker' }
    ],
    action: async (ctx) => {
        const agentId = (ctx.args[0] || ctx.flags['agent-id'] || ctx.flags.agentId || '').slice(0, MAX_AGENT_ID_LEN);
        if (!agentId) {
            output.printError('Agent ID is required. Use --agent-id or -a flag, or provide as argument.');
            return { success: false, exitCode: 1 };
        }
        try {
            const result = await callMCPTool('hive-mind_join', { agentId, role: ctx.flags.role });
            if (!result.success) {
                output.printError(result.error || 'Failed');
                return { success: false, exitCode: 1 };
            }
            output.printSuccess(`Agent ${agentId} joined hive (${result.totalWorkers} workers)`);
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(`Join error: ${error instanceof MCPClientError ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Leave subcommand
const leaveCommand = {
    name: 'leave',
    description: 'Remove an agent from the hive mind',
    options: [{ name: 'agent-id', short: 'a', description: 'Agent ID to remove', type: 'string' }],
    action: async (ctx) => {
        const agentId = (ctx.args[0] || ctx.flags['agent-id'] || ctx.flags.agentId || '').slice(0, MAX_AGENT_ID_LEN);
        if (!agentId) {
            output.printError('Agent ID required.');
            return { success: false, exitCode: 1 };
        }
        try {
            const result = await callMCPTool('hive-mind_leave', { agentId });
            if (!result.success) {
                output.printError(result.error || 'Failed');
                return { success: false, exitCode: 1 };
            }
            output.printSuccess(`Agent ${agentId} left hive (${result.remainingWorkers} remaining)`);
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(`Leave error: ${error instanceof MCPClientError ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Consensus subcommand
const consensusCommand = {
    name: 'consensus',
    description: 'Manage consensus proposals and voting',
    options: [
        { name: 'action', short: 'a', description: 'Consensus action', type: 'string', choices: ['propose', 'vote', 'status', 'list'], default: 'list' },
        { name: 'proposal-id', short: 'p', description: 'Proposal ID', type: 'string' },
        { name: 'type', short: 't', description: 'Proposal type', type: 'string' },
        { name: 'value', description: 'Proposal value', type: 'string' },
        { name: 'vote', short: 'v', description: 'Vote (yes/no)', type: 'string' },
        { name: 'voter-id', description: 'Voter agent ID', type: 'string' }
    ],
    action: async (ctx) => {
        const action = ctx.flags.action || 'list';
        try {
            const result = await callMCPTool('hive-mind_consensus', { action, proposalId: ctx.flags['proposal-id'], type: ctx.flags.type, value: ctx.flags.value, vote: ctx.flags.vote === 'yes', voterId: ctx.flags['voter-id'] });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            if (action === 'list') {
                output.writeln(output.bold('\nPending Proposals'));
                const pending = result.pending || [];
                if (pending.length === 0)
                    output.printInfo('No pending proposals');
                else
                    output.printTable({ columns: [{ key: 'proposalId', header: 'ID', width: 30 }, { key: 'type', header: 'Type', width: 12 }], data: pending });
            }
            else if (action === 'propose') {
                output.printSuccess(`Proposal created: ${result.proposalId}`);
            }
            else if (action === 'vote') {
                output.printSuccess(`Vote recorded (For: ${result.votesFor}, Against: ${result.votesAgainst})`);
            }
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(`Consensus error: ${error instanceof MCPClientError ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Broadcast subcommand
const broadcastCommand = {
    name: 'broadcast',
    description: 'Broadcast a message to all workers in the hive',
    options: [
        { name: 'message', short: 'm', description: 'Message to broadcast', type: 'string', required: true },
        { name: 'priority', short: 'p', description: 'Message priority', type: 'string', choices: ['low', 'normal', 'high', 'critical'], default: 'normal' },
        { name: 'from', short: 'f', description: 'Sender agent ID', type: 'string' }
    ],
    action: async (ctx) => {
        const message = (ctx.args.join(' ') || ctx.flags.message || '').slice(0, MAX_MESSAGE_LEN);
        if (!message) {
            output.printError('Message required. Use --message or -m flag.');
            return { success: false, exitCode: 1 };
        }
        try {
            const result = await callMCPTool('hive-mind_broadcast', { message, priority: ctx.flags.priority, fromId: typeof ctx.flags.from === 'string' ? ctx.flags.from.slice(0, MAX_AGENT_ID_LEN) : undefined });
            if (!result.success) {
                output.printError(result.error || 'Failed');
                return { success: false, exitCode: 1 };
            }
            output.printSuccess(`Message broadcast to ${result.recipients} workers (ID: ${result.messageId})`);
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(`Broadcast error: ${error instanceof MCPClientError ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Memory subcommand
const memorySubCommand = {
    name: 'memory',
    description: 'Access hive shared memory',
    options: [
        { name: 'action', short: 'a', description: 'Memory action', type: 'string', choices: ['get', 'set', 'delete', 'list'], default: 'list' },
        { name: 'key', short: 'k', description: 'Memory key', type: 'string' },
        { name: 'value', short: 'v', description: 'Value to store', type: 'string' }
    ],
    action: async (ctx) => {
        const action = ctx.flags.action || 'list';
        const key = typeof ctx.flags.key === 'string' ? ctx.flags.key.slice(0, MAX_KEY_LEN) : undefined;
        const value = typeof ctx.flags.value === 'string' ? ctx.flags.value.slice(0, MAX_VALUE_LEN) : undefined;
        if ((action === 'get' || action === 'delete') && !key) {
            output.printError('Key required for get/delete.');
            return { success: false, exitCode: 1 };
        }
        if (action === 'set' && (!key || value === undefined)) {
            output.printError('Key and value required for set.');
            return { success: false, exitCode: 1 };
        }
        try {
            const result = await callMCPTool('hive-mind_memory', { action, key, value });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            if (action === 'list') {
                const keys = result.keys || [];
                output.writeln(output.bold(`\nShared Memory (${result.count} keys)`));
                if (keys.length === 0)
                    output.printInfo('No keys in shared memory');
                else
                    output.printList(keys.map(k => output.highlight(k)));
            }
            else if (action === 'get') {
                output.writeln(output.bold(`\nKey: ${key}`));
                output.writeln(result.exists ? `Value: ${JSON.stringify(result.value, null, 2)}` : 'Key not found');
            }
            else if (action === 'set') {
                output.printSuccess(`Set ${key} in shared memory`);
            }
            else if (action === 'delete') {
                output.printSuccess(result.deleted ? `Deleted ${key}` : `Key ${key} did not exist`);
            }
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(`Memory error: ${error instanceof MCPClientError ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Shutdown subcommand
const shutdownCommand = {
    name: 'shutdown',
    description: 'Shutdown the hive mind',
    options: [
        {
            name: 'force',
            short: 'f',
            description: 'Force shutdown',
            type: 'boolean',
            default: false
        },
        {
            name: 'save-state',
            short: 's',
            description: 'Save state before shutdown',
            type: 'boolean',
            default: true
        }
    ],
    action: async (ctx) => {
        const force = ctx.flags.force;
        const saveState = ctx.flags['save-state'];
        if (!force && ctx.interactive) {
            const confirmed = await confirm({
                message: 'Shutdown the hive mind? All agents will be terminated.',
                default: false
            });
            if (!confirmed) {
                output.printInfo('Operation cancelled');
                return { success: true };
            }
        }
        output.printInfo('Shutting down hive mind...');
        const spinner = output.createSpinner({ text: 'Graceful shutdown in progress...', spinner: 'dots' });
        spinner.start();
        try {
            const result = await callMCPTool('hive-mind_shutdown', {
                force,
                saveState,
            });
            spinner.succeed('Hive mind shutdown complete');
            output.writeln();
            output.printList([
                `Agents terminated: ${result.agentsTerminated}`,
                `State saved: ${result.stateSaved ? 'Yes' : 'No'}`,
                `Shutdown time: ${result.shutdownTime}`
            ]);
            return { success: true, data: result };
        }
        catch (error) {
            spinner.fail('Shutdown failed');
            if (error instanceof MCPClientError) {
                output.printError(`Shutdown error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Main hive-mind command
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
// Helper functions
function formatAgentStatus(status) {
    const statusStr = String(status);
    switch (statusStr) {
        case 'active':
        case 'ready':
        case 'running':
            return output.success(statusStr);
        case 'idle':
        case 'waiting':
            return output.dim(statusStr);
        case 'busy':
            return output.highlight(statusStr);
        case 'error':
        case 'failed':
            return output.error(statusStr);
        default:
            return statusStr;
    }
}
function formatHiveStatus(status) {
    switch (status) {
        case 'active':
            return output.success(status);
        case 'idle':
            return output.dim(status);
        case 'degraded':
            return output.warning(status);
        case 'offline':
            return output.error(status);
        default:
            return status;
    }
}
function formatHealth(health) {
    switch (health) {
        case 'healthy':
        case 'good':
            return output.success(health);
        case 'warning':
        case 'degraded':
            return output.warning(health);
        case 'critical':
        case 'unhealthy':
            return output.error(health);
        default:
            return health;
    }
}
function formatPriority(priority) {
    switch (priority) {
        case 'critical':
            return output.error(priority.toUpperCase());
        case 'high':
            return output.warning(priority);
        case 'normal':
            return priority;
        case 'low':
            return output.dim(priority);
        default:
            return priority;
    }
}
export default hiveMindCommand;
//# sourceMappingURL=hive-mind.js.map