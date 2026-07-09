/**
 * Hive Mind operational subcommands — status
 */
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { formatAgentStatus, formatHiveStatus, formatHealth, } from './hive-mind-helpers.js';
export const statusCommand = {
    name: 'status',
    description: 'Show hive mind status',
    options: [
        { name: 'detailed', short: 'd', description: 'Show detailed metrics', type: 'boolean', default: false },
        { name: 'watch', short: 'w', description: 'Watch for changes', type: 'boolean', default: false }
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
//# sourceMappingURL=hive-mind-ops.js.map