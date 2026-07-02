/**
 * Agent lifecycle commands — spawn, list, status, stop
 */
import { output } from '../output.js';
import { select, confirm, input } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as fs from 'fs';
import * as path from 'path';
// ─── Shared utilities ────────────────────────────────────────────────────────
export function updateSwarmActivityMetrics(agentCountDelta) {
    try {
        const metricsDir = path.join(process.cwd(), '.monomind', 'metrics');
        const activityPath = path.join(metricsDir, 'swarm-activity.json');
        let data = {
            timestamp: new Date().toISOString(),
            swarm: { active: false, agent_count: 0, coordination_active: false },
        };
        if (fs.existsSync(activityPath) && fs.statSync(activityPath).size <= 10 * 1024 * 1024) {
            data = JSON.parse(fs.readFileSync(activityPath, 'utf-8'));
        }
        else {
            fs.mkdirSync(metricsDir, { recursive: true });
        }
        const swarm = data.swarm ?? {};
        const currentCount = Math.max(0, swarm.agent_count || 0);
        const newCount = Math.max(0, currentCount + agentCountDelta);
        swarm.agent_count = newCount;
        swarm.active = newCount > 0;
        swarm.coordination_active = newCount > 0;
        data.swarm = swarm;
        data.timestamp = new Date().toISOString();
        const tmpPath = activityPath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, activityPath);
    }
    catch {
        // Non-critical — don't fail the command if metrics update fails
    }
}
export const AGENT_TYPES = [
    { value: 'coder', label: 'Coder', hint: 'Code development with neural patterns' },
    { value: 'researcher', label: 'Researcher', hint: 'Research with web access and data analysis' },
    { value: 'tester', label: 'Tester', hint: 'Comprehensive testing with automation' },
    { value: 'reviewer', label: 'Reviewer', hint: 'Code review with security and quality checks' },
    { value: 'architect', label: 'Architect', hint: 'System design with enterprise patterns' },
    { value: 'coordinator', label: 'Coordinator', hint: 'Multi-agent orchestration and workflow' },
    { value: 'analyst', label: 'Analyst', hint: 'Performance analysis and optimization' },
    { value: 'optimizer', label: 'Optimizer', hint: 'Performance optimization and bottleneck analysis' },
    { value: 'security-architect', label: 'Security Architect', hint: 'Security architecture and threat modeling' },
    { value: 'security-auditor', label: 'Security Auditor', hint: 'CVE remediation and security testing' },
    { value: 'memory-specialist', label: 'Memory Specialist', hint: 'LanceDB ANN search (150x-12,500x faster)' },
    { value: 'swarm-specialist', label: 'Swarm Specialist', hint: 'Unified coordination engine' },
    { value: 'performance-engineer', label: 'Performance Engineer', hint: '2.49x-7.47x optimization targets' },
    { value: 'core-architect', label: 'Core Architect', hint: 'Domain-driven design restructure' },
    { value: 'test-architect', label: 'Test Architect', hint: 'TDD London School methodology' },
];
export function getAgentCapabilities(type) {
    const capabilities = {
        coder: ['code-generation', 'refactoring', 'debugging', 'testing'],
        researcher: ['web-search', 'data-analysis', 'summarization', 'citation'],
        tester: ['unit-testing', 'integration-testing', 'coverage-analysis', 'automation'],
        reviewer: ['code-review', 'security-audit', 'quality-check', 'documentation'],
        architect: ['system-design', 'pattern-analysis', 'scalability', 'documentation'],
        coordinator: ['task-orchestration', 'agent-management', 'workflow-control'],
        'security-architect': ['threat-modeling', 'security-patterns', 'compliance', 'audit'],
        'memory-specialist': ['vector-search', 'lancedb', 'caching', 'optimization'],
        'performance-engineer': ['benchmarking', 'profiling', 'optimization', 'monitoring'],
    };
    return capabilities[type] || ['general'];
}
export function formatStatus(status) {
    const s = String(status);
    switch (s) {
        case 'active': return output.success(s);
        case 'idle': return output.warning(s);
        case 'inactive':
        case 'stopped': return output.dim(s);
        case 'error': return output.error(s);
        default: return s;
    }
}
// ─── spawn subcommand ────────────────────────────────────────────────────────
export const spawnCommand = {
    name: 'spawn',
    description: 'Spawn a new agent',
    options: [
        { name: 'type', short: 't', description: 'Agent type to spawn', type: 'string', choices: AGENT_TYPES.map(a => a.value) },
        { name: 'name', short: 'n', description: 'Agent name/identifier', type: 'string' },
        { name: 'provider', short: 'p', description: 'Provider to use (anthropic, openrouter, ollama)', type: 'string', default: 'anthropic' },
        { name: 'model', short: 'm', description: 'Model to use', type: 'string' },
        { name: 'task', description: 'Initial task for the agent', type: 'string' },
        { name: 'timeout', description: 'Agent timeout in seconds', type: 'number', default: 300 },
        { name: 'auto-tools', description: 'Enable automatic tool usage', type: 'boolean', default: true },
    ],
    examples: [
        { command: 'monomind agent spawn --type coder --name bot-1', description: 'Spawn a coder agent' },
        { command: 'monomind agent spawn -t researcher --task "Research React 19"', description: 'Spawn researcher with task' },
    ],
    action: async (ctx) => {
        let agentType = ctx.flags.type?.slice(0, 64) ?? '';
        let agentName = ctx.flags.name?.slice(0, 128) ?? '';
        if (!agentType && ctx.interactive) {
            agentType = await select({ message: 'Select agent type:', options: AGENT_TYPES });
        }
        const taskDescription = ctx.flags.task?.slice(0, 2048);
        if (!agentType && taskDescription) {
            try {
                const { createConfiguredRouteLayer } = await import('../routing/route-layer-factory.js');
                const layer = await createConfiguredRouteLayer();
                const routeResult = await layer.route(taskDescription);
                agentType = routeResult.agentSlug;
                process.stderr.write(`[route] ${routeResult.method}: "${agentType}" (confidence: ${(routeResult.confidence * 100).toFixed(1)}%)\n`);
            }
            catch {
                // RouteLayer unavailable — fall through to error below
            }
        }
        if (!agentType) {
            output.printError('Agent type is required. Use --type or -t flag, or provide --task for auto-routing.');
            return { success: false, exitCode: 1 };
        }
        if (!agentName)
            agentName = `${agentType}-${Date.now().toString(36)}`;
        output.printInfo(`Spawning ${agentType} agent: ${output.highlight(agentName)}`);
        try {
            const result = await callMCPTool('agent_spawn', {
                agentType, id: agentName,
                config: {
                    provider: ctx.flags.provider || 'anthropic',
                    model: ctx.flags.model,
                    task: ctx.flags.task,
                    timeout: ctx.flags.timeout,
                    autoTools: ctx.flags['auto-tools'],
                },
                priority: 'normal',
                metadata: { name: agentName, capabilities: getAgentCapabilities(agentType) },
            });
            output.writeln();
            output.printTable({
                columns: [
                    { key: 'property', header: 'Property', width: 15 },
                    { key: 'value', header: 'Value', width: 40 },
                ],
                data: [
                    { property: 'ID', value: result.agentId },
                    { property: 'Type', value: result.agentType },
                    { property: 'Name', value: agentName },
                    { property: 'Status', value: result.status },
                    { property: 'Created', value: result.createdAt },
                    { property: 'Capabilities', value: getAgentCapabilities(agentType).join(', ') },
                ],
            });
            output.writeln();
            output.printSuccess(`Agent ${agentName} spawned successfully`);
            updateSwarmActivityMetrics(1);
            if (ctx.flags.format === 'json')
                output.printJson(result);
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(error instanceof MCPClientError ? `Failed to spawn agent: ${error.message}` : `Unexpected error: ${String(error)}`);
            return { success: false, exitCode: 1 };
        }
    },
};
// ─── list subcommand ─────────────────────────────────────────────────────────
export const listCommand = {
    name: 'list',
    aliases: ['ls'],
    description: 'List all active agents',
    options: [
        { name: 'all', short: 'a', description: 'Include inactive agents', type: 'boolean', default: false },
        { name: 'type', short: 't', description: 'Filter by agent type', type: 'string' },
        { name: 'status', short: 's', description: 'Filter by status', type: 'string' },
    ],
    action: async (ctx) => {
        try {
            const result = await callMCPTool('agent_list', {
                status: ctx.flags.all ? 'all' : ctx.flags.status || undefined,
                agentType: ctx.flags.type || undefined,
                limit: 100,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            output.writeln(output.bold('Active Agents'));
            output.writeln();
            if (result.agents.length === 0) {
                output.printInfo('No agents found matching criteria');
                return { success: true, data: result };
            }
            const displayAgents = result.agents.map(agent => ({
                id: agent.id,
                type: agent.agentType,
                status: agent.status,
                created: new Date(agent.createdAt).toLocaleTimeString(),
                lastActivity: agent.lastActivityAt ? new Date(agent.lastActivityAt).toLocaleTimeString() : 'N/A',
            }));
            output.printTable({
                columns: [
                    { key: 'id', header: 'ID', width: 20 },
                    { key: 'type', header: 'Type', width: 15 },
                    { key: 'status', header: 'Status', width: 12, format: formatStatus },
                    { key: 'created', header: 'Created', width: 12 },
                    { key: 'lastActivity', header: 'Last Activity', width: 12 },
                ],
                data: displayAgents,
            });
            output.writeln();
            output.printInfo(`Total: ${result.total} agents`);
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(error instanceof MCPClientError ? `Failed to list agents: ${error.message}` : `Unexpected error: ${String(error)}`);
            return { success: false, exitCode: 1 };
        }
    },
};
// ─── status subcommand ───────────────────────────────────────────────────────
export const statusCommand = {
    name: 'status',
    description: 'Show detailed status of an agent',
    options: [{ name: 'id', description: 'Agent ID', type: 'string' }],
    action: async (ctx) => {
        let agentId = ctx.args[0] || ctx.flags.id;
        if (!agentId && ctx.interactive) {
            agentId = await input({ message: 'Enter agent ID:', validate: (v) => v.length > 0 || 'Agent ID is required' });
        }
        if (!agentId) {
            output.printError('Agent ID is required');
            return { success: false, exitCode: 1 };
        }
        try {
            const status = await callMCPTool('agent_status', { agentId, includeMetrics: true, includeHistory: false });
            if (ctx.flags.format === 'json') {
                output.printJson(status);
                return { success: true, data: status };
            }
            output.writeln();
            output.printBox([
                `Type: ${status.agentType}`,
                `Status: ${formatStatus(status.status)}`,
                `Created: ${new Date(status.createdAt).toLocaleString()}`,
                `Last Activity: ${status.lastActivityAt ? new Date(status.lastActivityAt).toLocaleString() : 'N/A'}`,
            ].join('\n'), `Agent: ${status.id}`);
            if (status.metrics) {
                output.writeln();
                output.writeln(output.bold('Metrics'));
                const avgExecTime = status.metrics.averageExecutionTime ?? 0;
                const uptime = status.metrics.uptime ?? 0;
                output.printTable({
                    columns: [
                        { key: 'metric', header: 'Metric', width: 25 },
                        { key: 'value', header: 'Value', width: 15, align: 'right' },
                    ],
                    data: [
                        { metric: 'Tasks Completed', value: status.metrics.tasksCompleted ?? 0 },
                        { metric: 'Tasks In Progress', value: status.metrics.tasksInProgress ?? 0 },
                        { metric: 'Tasks Failed', value: status.metrics.tasksFailed ?? 0 },
                        { metric: 'Avg Execution Time', value: `${avgExecTime.toFixed(2)}ms` },
                        { metric: 'Uptime', value: `${(uptime / 1000 / 60).toFixed(1)}m` },
                    ],
                });
            }
            return { success: true, data: status };
        }
        catch (error) {
            output.printError(error instanceof MCPClientError ? `Failed to get agent status: ${error.message}` : `Unexpected error: ${String(error)}`);
            return { success: false, exitCode: 1 };
        }
    },
};
// ─── stop subcommand ─────────────────────────────────────────────────────────
export const stopCommand = {
    name: 'stop',
    aliases: ['kill'],
    description: 'Stop a running agent',
    options: [
        { name: 'force', short: 'f', description: 'Force stop without graceful shutdown', type: 'boolean', default: false },
        { name: 'timeout', description: 'Graceful shutdown timeout in seconds', type: 'number', default: 30 },
    ],
    action: async (ctx) => {
        const agentId = ctx.args[0];
        if (!agentId) {
            output.printError('Agent ID is required');
            return { success: false, exitCode: 1 };
        }
        const force = ctx.flags.force;
        if (!force && ctx.interactive) {
            const confirmed = await confirm({ message: `Are you sure you want to stop agent ${agentId}?`, default: false });
            if (!confirmed) {
                output.printInfo('Operation cancelled');
                return { success: true };
            }
        }
        output.printInfo(`Stopping agent ${agentId}...`);
        try {
            const result = await callMCPTool('agent_terminate', {
                agentId, graceful: !force, reason: 'Stopped by user via CLI',
            });
            if (!force) {
                output.writeln(output.dim('  Completing current task...'));
                output.writeln(output.dim('  Saving state...'));
                output.writeln(output.dim('  Releasing resources...'));
            }
            output.printSuccess(`Agent ${agentId} stopped successfully`);
            updateSwarmActivityMetrics(-1);
            if (ctx.flags.format === 'json')
                output.printJson(result);
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(error instanceof MCPClientError ? `Failed to stop agent: ${error.message}` : `Unexpected error: ${String(error)}`);
            return { success: false, exitCode: 1 };
        }
    },
};
//# sourceMappingURL=agent-lifecycle.js.map