/**
 * Hooks Routing Commands
 * Route/explain/pretrain/build-agents/metrics/transfer/list subcommands
 * Extracted from hooks.ts (ARCH-1)
 */
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { storeCommand } from './transfer-store.js';
// Route subcommand
export const routeCommand = {
    name: 'route',
    description: 'Route task to optimal agent using learned patterns',
    options: [
        {
            name: 'task',
            short: 't',
            description: 'Task description',
            type: 'string',
            required: true
        },
        {
            name: 'context',
            short: 'c',
            description: 'Additional context',
            type: 'string'
        },
        {
            name: 'top-k',
            short: 'K',
            description: 'Number of top agent suggestions',
            type: 'number',
            default: 3
        }
    ],
    examples: [
        { command: 'monomind hooks route -t "Fix authentication bug"', description: 'Route task to optimal agent' },
        { command: 'monomind hooks route -t "Optimize database queries" -K 5', description: 'Get top 5 suggestions' }
    ],
    action: async (ctx) => {
        const task = ctx.args[0] || ctx.flags.task;
        const topK = ctx.flags['top-k'] || 3;
        if (!task) {
            output.printError('Task description is required. Use --task or -t flag.');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Routing task: ${output.highlight(task)}`);
        try {
            // Call MCP tool for routing
            const result = await callMCPTool('hooks_route', {
                task,
                topK,
                context: ctx.flags.context,
                includeReasoning: true,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.printBox([
                `Task: ${result.task}`,
                `Top Agent: ${output.highlight(result.topAgent)}`,
                `Confidence: ${(result.confidence * 100).toFixed(1)}%`,
                `Method: ${result.routing?.method ?? 'keyword'}`
            ].join('\n'), 'Routing Decision');
            if (result.recommendations.length > 0) {
                output.writeln();
                output.writeln(output.bold('Agent Recommendations'));
                output.printTable({
                    columns: [
                        { key: 'agent', header: 'Agent', width: 20 },
                        { key: 'confidence', header: 'Confidence', width: 12, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(1)}%` },
                        { key: 'reason', header: 'Reason', width: 35 },
                        { key: 'estimatedTime', header: 'Est. Time', width: 12, format: (v) => v ? String(v) : 'N/A' }
                    ],
                    data: result.recommendations.slice(0, topK)
                });
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Routing failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Explain subcommand
export const explainCommand = {
    name: 'explain',
    description: 'Explain routing decision with transparency',
    options: [
        {
            name: 'task',
            short: 't',
            description: 'Task description',
            type: 'string',
            required: true
        },
        {
            name: 'agent',
            short: 'a',
            description: 'Agent type to explain',
            type: 'string'
        },
        {
            name: 'verbose',
            short: 'v',
            description: 'Verbose explanation',
            type: 'boolean',
            default: false
        }
    ],
    examples: [
        { command: 'monomind hooks explain -t "Fix authentication bug"', description: 'Explain routing decision' },
        { command: 'monomind hooks explain -t "Optimize queries" -a coder --verbose', description: 'Verbose explanation for specific agent' }
    ],
    action: async (ctx) => {
        const task = ctx.args[0] || ctx.flags.task;
        if (!task) {
            output.printError('Task description is required. Use --task or -t flag.');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Explaining routing for: ${output.highlight(task)}`);
        try {
            // Call MCP tool for explanation
            const result = await callMCPTool('hooks_explain', {
                task,
                agent: ctx.flags.agent,
                verbose: ctx.flags.verbose || false,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.writeln(output.bold('Decision Explanation'));
            output.writeln();
            output.writeln(result.explanation);
            output.writeln();
            output.printBox([
                `Agent: ${output.highlight(result.decision.agent)}`,
                `Confidence: ${(result.decision.confidence * 100).toFixed(1)}%`
            ].join('\n'), 'Final Decision');
            if (result.decision.reasoning.length > 0) {
                output.writeln();
                output.writeln(output.bold('Reasoning Steps'));
                output.printList(result.decision.reasoning.map((r, i) => `${i + 1}. ${r}`));
            }
            if (result.factors.length > 0) {
                output.writeln();
                output.writeln(output.bold('Decision Factors'));
                output.printTable({
                    columns: [
                        { key: 'factor', header: 'Factor', width: 20 },
                        { key: 'weight', header: 'Weight', width: 10, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(0)}%` },
                        { key: 'value', header: 'Value', width: 10, align: 'right', format: (v) => Number(v).toFixed(2) },
                        { key: 'impact', header: 'Impact', width: 25 }
                    ],
                    data: result.factors
                });
            }
            if (result.patterns.length > 0 && ctx.flags.verbose) {
                output.writeln();
                output.writeln(output.bold('Matched Patterns'));
                result.patterns.forEach((p, i) => {
                    output.writeln();
                    output.writeln(`${i + 1}. ${output.highlight(p.pattern)} (${(p.matchScore * 100).toFixed(1)}% match)`);
                    if (p.examples.length > 0) {
                        output.printList(p.examples.slice(0, 3).map(e => output.dim(`  ${e}`)));
                    }
                });
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Explanation failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Pretrain subcommand
export const pretrainCommand = {
    name: 'pretrain',
    description: 'Bootstrap intelligence from repository (4-step pipeline + embeddings)',
    options: [
        {
            name: 'path',
            short: 'p',
            description: 'Repository path',
            type: 'string',
            default: '.'
        },
        {
            name: 'depth',
            short: 'd',
            description: 'Analysis depth (shallow, medium, deep)',
            type: 'string',
            default: 'medium',
            choices: ['shallow', 'medium', 'deep']
        },
        {
            name: 'skip-cache',
            description: 'Skip cached analysis',
            type: 'boolean',
            default: false
        },
        {
            name: 'with-embeddings',
            description: 'Index documents for semantic search during pretraining',
            type: 'boolean',
            default: true
        },
        {
            name: 'embedding-model',
            description: 'ONNX embedding model',
            type: 'string',
            default: 'Xenova/all-MiniLM-L6-v2',
            choices: ['Xenova/all-MiniLM-L6-v2', 'Xenova/all-mpnet-base-v2']
        },
        {
            name: 'file-types',
            description: 'File extensions to index (comma-separated)',
            type: 'string',
            default: 'ts,js,py,md,json'
        }
    ],
    examples: [
        { command: 'monomind hooks pretrain', description: 'Pretrain with embeddings indexing' },
        { command: 'monomind hooks pretrain -p ../my-project --depth deep', description: 'Deep analysis of specific project' },
        { command: 'monomind hooks pretrain --no-with-embeddings', description: 'Skip embedding indexing' },
        { command: 'monomind hooks pretrain --file-types ts,tsx,js', description: 'Index only TypeScript/JS files' }
    ],
    action: async (ctx) => {
        const repoPath = ctx.flags.path || '.';
        const depth = ctx.flags.depth || 'medium';
        const withEmbeddings = ctx.flags['with-embeddings'] !== false && ctx.flags.withEmbeddings !== false;
        const embeddingModel = (ctx.flags['embedding-model'] || ctx.flags.embeddingModel || 'Xenova/all-MiniLM-L6-v2');
        const fileTypes = (ctx.flags['file-types'] || ctx.flags.fileTypes || 'ts,js,py,md,json');
        output.writeln();
        output.writeln(output.bold('Pretraining Intelligence (4-Step Pipeline + Embeddings)'));
        output.writeln();
        const steps = [
            { name: 'RETRIEVE', desc: 'Top-k memory injection with MMR diversity' },
            { name: 'JUDGE', desc: 'LLM-as-judge trajectory evaluation' },
            { name: 'DISTILL', desc: 'Extract strategy memories from trajectories' },
            { name: 'CONSOLIDATE', desc: 'Dedup, detect contradictions, prune old patterns' }
        ];
        // Add embedding steps if enabled
        if (withEmbeddings) {
            steps.push({ name: 'EMBED', desc: `Index documents with ${embeddingModel} (ONNX)` }, { name: 'HYPERBOLIC', desc: 'Project to Poincaré ball for hierarchy preservation' });
        }
        const spinner = output.createSpinner({ text: 'Starting pretraining...', spinner: 'dots' });
        try {
            spinner.start();
            // Display progress for each step
            for (const step of steps) {
                spinner.setText(`${step.name}: ${step.desc}`);
                await new Promise(resolve => setTimeout(resolve, 800));
            }
            // Call MCP tool for pretraining
            const result = await callMCPTool('hooks_pretrain', {
                path: repoPath,
                depth,
                skipCache: ctx.flags['skip-cache'] || false,
                withEmbeddings,
                embeddingModel,
                fileTypes: fileTypes.split(',').map((t) => t.trim()),
            });
            spinner.succeed('Pretraining completed');
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            // Base stats
            const tableData = [
                { metric: 'Files Analyzed', value: result.stats.filesAnalyzed },
                { metric: 'Patterns Extracted', value: result.stats.patternsExtracted },
                { metric: 'Strategies Learned', value: result.stats.strategiesLearned },
                { metric: 'Trajectories Evaluated', value: result.stats.trajectoriesEvaluated },
                { metric: 'Contradictions Resolved', value: result.stats.contradictionsResolved },
            ];
            // Add embedding stats if available
            if (withEmbeddings && result.stats.documentsIndexed !== undefined) {
                tableData.push({ metric: 'Documents Indexed', value: result.stats.documentsIndexed }, { metric: 'Embeddings Generated', value: result.stats.embeddingsGenerated || 0 }, { metric: 'Hyperbolic Projections', value: result.stats.hyperbolicProjections || 0 });
            }
            tableData.push({ metric: 'Duration', value: `${(result.duration / 1000).toFixed(1)}s` });
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 30 },
                    { key: 'value', header: 'Value', width: 15, align: 'right' }
                ],
                data: tableData
            });
            output.writeln();
            output.printSuccess('Repository intelligence bootstrapped successfully');
            if (withEmbeddings) {
                output.writeln(output.dim('  Semantic search enabled: Use "embeddings search -q <query>" to search'));
            }
            output.writeln(output.dim('  Next step: Run "monomind hooks build-agents" to generate optimized configs'));
            return { success: true, data: result };
        }
        catch (error) {
            spinner.fail('Pretraining failed');
            if (error instanceof MCPClientError) {
                output.printError(`Pretraining error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Build agents subcommand
export const buildAgentsCommand = {
    name: 'build-agents',
    description: 'Generate optimized agent configs from pretrain data',
    options: [
        {
            name: 'output',
            short: 'o',
            description: 'Output directory for agent configs',
            type: 'string',
            default: './agents'
        },
        {
            name: 'focus',
            short: 'f',
            description: 'Focus area (v1-implementation, security, performance, all)',
            type: 'string',
            default: 'all'
        },
        {
            name: 'config-format',
            description: 'Config format (yaml, json)',
            type: 'string',
            default: 'yaml',
            choices: ['yaml', 'json']
        }
    ],
    examples: [
        { command: 'monomind hooks build-agents', description: 'Build all agent configs' },
        { command: 'monomind hooks build-agents --focus security -o ./config/agents', description: 'Build security-focused configs' }
    ],
    action: async (ctx) => {
        const output_dir = ctx.flags.output || './agents';
        const focus = ctx.flags.focus || 'all';
        const configFormat = ctx.flags.configFormat || 'yaml';
        output.printInfo(`Building agent configs (focus: ${output.highlight(focus)})`);
        const spinner = output.createSpinner({ text: 'Generating configs...', spinner: 'dots' });
        try {
            spinner.start();
            // Call MCP tool for building agents
            const result = await callMCPTool('hooks_build-agents', {
                outputDir: output_dir,
                focus,
                format: configFormat,
                includePretrained: true,
            });
            spinner.succeed(`Generated ${result.agents.length} agent configs`);
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.writeln(output.bold('Generated Agent Configs'));
            output.printTable({
                columns: [
                    { key: 'type', header: 'Agent Type', width: 20 },
                    { key: 'configFile', header: 'Config File', width: 30 },
                    { key: 'capabilities', header: 'Capabilities', width: 10, align: 'right', format: (v) => String(Array.isArray(v) ? v.length : 0) }
                ],
                data: result.agents
            });
            output.writeln();
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 30 },
                    { key: 'value', header: 'Value', width: 15, align: 'right' }
                ],
                data: [
                    { metric: 'Configs Generated', value: result.stats.configsGenerated },
                    { metric: 'Patterns Applied', value: result.stats.patternsApplied },
                    { metric: 'Optimizations Included', value: result.stats.optimizationsIncluded }
                ]
            });
            output.writeln();
            output.printSuccess(`Agent configs saved to ${output_dir}`);
            return { success: true, data: result };
        }
        catch (error) {
            spinner.fail('Agent config generation failed');
            if (error instanceof MCPClientError) {
                output.printError(`Build agents error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Metrics subcommand
export const metricsCommand = {
    name: 'metrics',
    description: 'View learning metrics dashboard',
    options: [
        {
            name: 'period',
            short: 'p',
            description: 'Time period (1h, 24h, 7d, 30d, all)',
            type: 'string',
            default: '24h'
        },
        {
            name: 'v1-dashboard',
            description: 'Show v1 performance dashboard',
            type: 'boolean',
            default: false
        },
        {
            name: 'category',
            short: 'c',
            description: 'Metric category (patterns, agents, commands, performance)',
            type: 'string'
        }
    ],
    examples: [
        { command: 'monomind hooks metrics', description: 'View 24h metrics' },
        { command: 'monomind hooks metrics --period 7d --v1-dashboard', description: 'v1 metrics for 7 days' }
    ],
    action: async (ctx) => {
        const period = ctx.flags.period || '24h';
        const v1Dashboard = ctx.flags.v1Dashboard;
        output.writeln();
        output.writeln(output.bold(`Learning Metrics Dashboard (${period})`));
        output.writeln();
        try {
            // Call MCP tool for metrics
            const result = await callMCPTool('hooks_metrics', {
                period,
                includev1: v1Dashboard,
                category: ctx.flags.category,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            // Patterns section
            output.writeln(output.bold('📊 Pattern Learning'));
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 25 },
                    { key: 'value', header: 'Value', width: 20, align: 'right' }
                ],
                data: [
                    { metric: 'Total Patterns', value: result.patterns.total },
                    { metric: 'Successful', value: output.success(String(result.patterns.successful)) },
                    { metric: 'Failed', value: output.error(String(result.patterns.failed)) },
                    { metric: 'Avg Confidence', value: `${(result.patterns.avgConfidence * 100).toFixed(1)}%` }
                ]
            });
            output.writeln();
            // Agent routing section
            output.writeln(output.bold('🤖 Agent Routing'));
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 25 },
                    { key: 'value', header: 'Value', width: 20, align: 'right' }
                ],
                data: [
                    { metric: 'Routing Accuracy', value: `${(result.agents.routingAccuracy * 100).toFixed(1)}%` },
                    { metric: 'Total Routes', value: result.agents.totalRoutes },
                    { metric: 'Top Agent', value: output.highlight(result.agents.topAgent) }
                ]
            });
            output.writeln();
            // Command execution section
            output.writeln(output.bold('⚡ Command Execution'));
            output.printTable({
                columns: [
                    { key: 'metric', header: 'Metric', width: 25 },
                    { key: 'value', header: 'Value', width: 20, align: 'right' }
                ],
                data: [
                    { metric: 'Total Executed', value: result.commands.totalExecuted },
                    { metric: 'Success Rate', value: `${(result.commands.successRate * 100).toFixed(1)}%` },
                    { metric: 'Avg Risk Score', value: result.commands.avgRiskScore.toFixed(2) }
                ]
            });
            if (v1Dashboard && result.performance) {
                const p = result.performance;
                output.writeln();
                output.writeln(output.bold('🚀 v1 Performance Gains'));
                output.printList([
                    `Memory Reduction: ${output.success(p.memoryReduction ?? 'N/A')}`,
                    `Search Improvement: ${output.success(p.searchImprovement ?? 'N/A')}`,
                    `Token Reduction: ${output.success(p.tokenReduction ?? 'N/A')}`
                ]);
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Metrics error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Transfer from project subcommand
export const transferFromProjectCommand = {
    name: 'from-project',
    aliases: ['project'],
    description: 'Transfer patterns from another project',
    options: [
        {
            name: 'source',
            short: 's',
            description: 'Source project path',
            type: 'string',
            required: true
        },
        {
            name: 'filter',
            short: 'f',
            description: 'Filter patterns by type',
            type: 'string'
        },
        {
            name: 'min-confidence',
            short: 'm',
            description: 'Minimum confidence threshold (0-1)',
            type: 'number',
            default: 0.7
        }
    ],
    examples: [
        { command: 'monomind hooks transfer from-project -s ../old-project', description: 'Transfer all patterns' },
        { command: 'monomind hooks transfer from-project -s ../prod --filter security -m 0.9', description: 'Transfer high-confidence security patterns' }
    ],
    action: async (ctx) => {
        const sourcePath = ctx.args[0] || ctx.flags.source;
        const minConfidence = ctx.flags['min-confidence'] || 0.7;
        if (!sourcePath) {
            output.printError('Source project path is required. Use --source or -s flag.');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Transferring patterns from: ${output.highlight(sourcePath)}`);
        const spinner = output.createSpinner({ text: 'Analyzing source patterns...', spinner: 'dots' });
        try {
            spinner.start();
            // Call MCP tool for transfer
            const result = await callMCPTool('hooks_transfer', {
                sourcePath,
                filter: ctx.flags.filter,
                minConfidence,
                mergeStrategy: 'keep-highest-confidence',
            });
            spinner.succeed(`Transferred ${result.transferred.total} patterns`);
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.writeln(output.bold('Transfer Summary'));
            output.printTable({
                columns: [
                    { key: 'category', header: 'Category', width: 25 },
                    { key: 'count', header: 'Count', width: 15, align: 'right' }
                ],
                data: [
                    { category: 'Total Transferred', count: output.success(String(result.transferred.total)) },
                    { category: 'Skipped (Low Confidence)', count: result.skipped.lowConfidence },
                    { category: 'Skipped (Duplicates)', count: result.skipped.duplicates },
                    { category: 'Skipped (Conflicts)', count: result.skipped.conflicts }
                ]
            });
            if (Object.keys(result.transferred.byType).length > 0) {
                output.writeln();
                output.writeln(output.bold('By Pattern Type'));
                output.printTable({
                    columns: [
                        { key: 'type', header: 'Type', width: 20 },
                        { key: 'count', header: 'Count', width: 15, align: 'right' }
                    ],
                    data: Object.entries(result.transferred.byType).map(([type, count]) => ({ type, count }))
                });
            }
            output.writeln();
            output.printList([
                `Avg Confidence: ${(result.stats.avgConfidence * 100).toFixed(1)}%`,
                `Avg Age: ${result.stats.avgAge}`
            ]);
            return { success: true, data: result };
        }
        catch (error) {
            spinner.fail('Transfer failed');
            if (error instanceof MCPClientError) {
                output.printError(`Transfer error: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Parent transfer command combining all transfer methods
export const transferCommand = {
    name: 'transfer',
    description: 'Transfer patterns via IPFS-based decentralized registry',
    subcommands: [storeCommand, transferFromProjectCommand],
    examples: [
        { command: 'monomind hooks transfer store list', description: 'List patterns from registry' },
        { command: 'monomind hooks transfer store search -q routing', description: 'Search patterns' },
        { command: 'monomind hooks transfer store download -p seraphine-genesis', description: 'Download pattern' },
        { command: 'monomind hooks transfer store publish', description: 'Publish pattern to registry' },
        { command: 'monomind hooks transfer from-project -s ../other-project', description: 'Transfer from project' },
    ],
    action: async () => {
        output.writeln();
        output.writeln(output.bold('Pattern Transfer System'));
        output.writeln(output.dim('Decentralized pattern sharing via IPFS'));
        output.writeln();
        output.writeln('Subcommands:');
        output.printList([
            `${output.highlight('store')}        - Pattern marketplace (list, search, download, publish)`,
            `${output.highlight('from-project')} - Transfer patterns from another project`,
        ]);
        output.writeln();
        output.writeln(output.bold('IPFS-Based Features:'));
        output.printList([
            'Decentralized registry via IPNS for discoverability',
            'Content-addressed storage for integrity',
            'Ed25519 signatures for verification',
            'Anonymization levels: minimal, standard, strict, paranoid',
            'Trust levels: unverified, community, verified, official',
        ]);
        output.writeln();
        output.writeln('Run "monomind hooks transfer <subcommand> --help" for details');
        return { success: true };
    }
};
// List subcommand
export const listCommand = {
    name: 'list',
    aliases: ['ls'],
    description: 'List all registered hooks',
    options: [
        {
            name: 'enabled',
            short: 'e',
            description: 'Show only enabled hooks',
            type: 'boolean',
            default: false
        },
        {
            name: 'type',
            short: 't',
            description: 'Filter by hook type',
            type: 'string'
        }
    ],
    action: async (ctx) => {
        try {
            // Call MCP tool for list
            const result = await callMCPTool('hooks_list', {
                enabled: ctx.flags.enabled || undefined,
                type: ctx.flags.type || undefined,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.writeln(output.bold('Registered Hooks'));
            output.writeln();
            if (result.hooks.length === 0) {
                output.printInfo('No hooks found matching criteria');
                return { success: true, data: result };
            }
            output.printTable({
                columns: [
                    { key: 'name', header: 'Name', width: 20 },
                    { key: 'type', header: 'Type', width: 15 },
                    { key: 'enabled', header: 'Enabled', width: 10, format: (v) => v ? output.success('Yes') : output.dim('No') },
                    { key: 'priority', header: 'Priority', width: 10, align: 'right' },
                    { key: 'executionCount', header: 'Executions', width: 12, align: 'right' },
                    { key: 'lastExecuted', header: 'Last Executed', width: 20, format: (v) => v ? new Date(String(v)).toLocaleString() : 'Never' }
                ],
                data: result.hooks
            });
            output.writeln();
            output.printInfo(`Total: ${result.total} hooks`);
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Failed to list hooks: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
//# sourceMappingURL=hooks-routing-commands.js.map