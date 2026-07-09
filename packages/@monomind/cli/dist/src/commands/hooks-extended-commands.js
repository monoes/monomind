/**
 * Hooks Extended Commands
 * Token optimization, model routing, Agent Teams integration, and notify commands.
 * Extracted from hooks.ts to reduce file size.
 */
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
// Model Router command - intelligent model selection (haiku/sonnet/opus)
export const modelRouteCommand = {
    name: 'model-route',
    description: 'Route task to optimal Claude model (haiku/sonnet/opus) based on complexity',
    options: [
        { name: 'task', short: 't', type: 'string', description: 'Task description to route', required: true },
        { name: 'context', short: 'c', type: 'string', description: 'Additional context' },
        { name: 'prefer-cost', type: 'boolean', description: 'Prefer lower cost models' },
        { name: 'prefer-quality', type: 'boolean', description: 'Prefer higher quality models' },
    ],
    examples: [
        { command: 'monomind hooks model-route -t "fix typo"', description: 'Route simple task (likely haiku)' },
        { command: 'monomind hooks model-route -t "architect auth system"', description: 'Route complex task (likely opus)' },
    ],
    action: async (ctx) => {
        const task = ctx.args[0] || ctx.flags.task;
        if (!task) {
            output.printError('Task description required. Use --task or -t flag.');
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Analyzing task complexity: ${output.highlight(task.slice(0, 50))}...`);
        try {
            const result = await callMCPTool('hooks_model-route', {
                task,
                context: ctx.flags.context,
                preferCost: ctx.flags['prefer-cost'],
                preferQuality: ctx.flags['prefer-quality'],
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            output.writeln();
            // Model icon based on selection
            const modelIcons = {
                haiku: '🌸',
                sonnet: '📜',
                opus: '🎭',
            };
            const model = result.model || 'sonnet';
            const icon = modelIcons[model] || '🤖';
            // Calculate cost savings compared to opus
            const costMultipliers = { haiku: 0.04, sonnet: 0.2, opus: 1.0 };
            const costSavings = model !== 'opus'
                ? `${((1 - costMultipliers[model]) * 100).toFixed(0)}% vs opus`
                : undefined;
            // Determine complexity level
            const complexityScore = typeof result.complexity === 'number' ? result.complexity : 0.5;
            const complexityLevel = complexityScore > 0.7 ? 'high' : complexityScore > 0.4 ? 'medium' : 'low';
            output.printBox([
                `Selected Model: ${icon} ${output.bold(model.toUpperCase())}`,
                `Confidence: ${(result.confidence * 100).toFixed(1)}%`,
                `Complexity: ${complexityLevel} (${(complexityScore * 100).toFixed(0)}%)`,
                costSavings ? `Cost Savings: ${costSavings}` : '',
            ].filter(Boolean).join('\n'), 'Model Routing Result');
            output.writeln();
            output.writeln(output.bold('Reasoning'));
            output.writeln(output.dim(result.reasoning || 'Based on task complexity analysis'));
            if (result.implementation) {
                output.writeln();
                output.writeln(output.dim(`Implementation: ${result.implementation}`));
            }
            return { success: true, data: result };
        }
        catch (error) {
            if (error instanceof MCPClientError) {
                output.printError(`Model routing failed: ${error.message}`);
            }
            else {
                output.printError(`Unexpected error: ${String(error)}`);
            }
            return { success: false, exitCode: 1 };
        }
    }
};
// Model Outcome command - record routing outcomes for learning
export const modelOutcomeCommand = {
    name: 'model-outcome',
    description: 'Record model routing outcome for learning',
    options: [
        { name: 'task', short: 't', type: 'string', description: 'Task that was executed', required: true },
        { name: 'model', short: 'm', type: 'string', description: 'Model that was used (haiku/sonnet/opus)', required: true },
        { name: 'outcome', short: 'o', type: 'string', description: 'Outcome (success/failure/escalated)', required: true },
        { name: 'quality', short: 'q', type: 'number', description: 'Quality score 0-1' },
    ],
    examples: [
        { command: 'monomind hooks model-outcome -t "fix typo" -m haiku -o success', description: 'Record successful haiku task' },
        { command: 'monomind hooks model-outcome -t "auth system" -m sonnet -o escalated', description: 'Record escalation to opus' },
    ],
    action: async (ctx) => {
        const task = ctx.flags.task;
        const model = ctx.flags.model;
        const outcome = ctx.flags.outcome;
        if (!task || !model || !outcome) {
            output.printError('Task, model, and outcome are required.');
            return { success: false, exitCode: 1 };
        }
        try {
            const result = await callMCPTool('hooks_model-outcome', {
                task,
                model,
                outcome,
                quality: ctx.flags.quality,
            });
            output.printSuccess(`Outcome recorded for ${model}: ${outcome}`);
            if (result.learningUpdate) {
                output.writeln(output.dim(result.learningUpdate));
            }
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(`Failed to record outcome: ${String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Model Stats command - view routing statistics
export const modelStatsCommand = {
    name: 'model-stats',
    description: 'View model routing statistics and learning metrics',
    options: [
        { name: 'detailed', short: 'd', type: 'boolean', description: 'Show detailed breakdown' },
    ],
    examples: [
        { command: 'monomind hooks model-stats', description: 'View routing stats' },
        { command: 'monomind hooks model-stats --detailed', description: 'Show detailed breakdown' },
    ],
    action: async (ctx) => {
        try {
            const result = await callMCPTool('hooks_model-stats', {
                detailed: ctx.flags.detailed,
            });
            if (ctx.flags.format === 'json') {
                output.printJson(result);
                return { success: true, data: result };
            }
            if (!result.available) {
                output.printWarning(result.message || 'Model router not available');
                return { success: true, data: result };
            }
            // Calculate cost savings based on model distribution
            const dist = result.modelDistribution || { haiku: 0, sonnet: 0, opus: 0 };
            const totalTasks = result.totalDecisions || 0;
            const costMultipliers = { haiku: 0.04, sonnet: 0.2, opus: 1.0 };
            let totalCost = 0;
            let maxCost = totalTasks; // If all were opus
            for (const [model, count] of Object.entries(dist)) {
                if (model !== 'inherit') {
                    totalCost += count * (costMultipliers[model] || 1);
                }
            }
            const costSavings = maxCost > 0 ? ((1 - totalCost / maxCost) * 100).toFixed(1) : '0';
            output.writeln();
            output.printBox([
                `Total Tasks Routed: ${totalTasks}`,
                `Avg Complexity: ${((result.avgComplexity || 0) * 100).toFixed(1)}%`,
                `Avg Confidence: ${((result.avgConfidence || 0) * 100).toFixed(1)}%`,
                `Cost Savings: ${costSavings}% vs all-opus`,
                `Circuit Breaker Trips: ${result.circuitBreakerTrips || 0}`,
            ].join('\n'), 'Model Routing Statistics');
            if (dist && Object.keys(dist).length > 0) {
                output.writeln();
                output.writeln(output.bold('Model Distribution'));
                output.printTable({
                    columns: [
                        { key: 'model', header: 'Model', width: 10 },
                        { key: 'count', header: 'Tasks', width: 8, align: 'right' },
                        { key: 'percentage', header: '%', width: 8, align: 'right' },
                        { key: 'costMultiplier', header: 'Cost', width: 8, align: 'right' },
                    ],
                    data: Object.entries(dist)
                        .filter(([model]) => model !== 'inherit')
                        .map(([model, count]) => ({
                        model: model.toUpperCase(),
                        count,
                        percentage: totalTasks > 0 ? `${((count / totalTasks) * 100).toFixed(1)}%` : '0%',
                        costMultiplier: `${costMultipliers[model] || 1}x`,
                    })),
                });
            }
            return { success: true, data: result };
        }
        catch (error) {
            output.printError(`Failed to get stats: ${String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Notify subcommand
export const notifyCommand = {
    name: 'notify',
    description: 'Send a notification message (logged to session)',
    options: [
        { name: 'message', short: 'm', type: 'string', description: 'Notification message', required: true },
        { name: 'level', short: 'l', type: 'string', description: 'Level: info, warn, error', default: 'info' },
        { name: 'channel', short: 'c', type: 'string', description: 'Notification channel', default: 'console' },
    ],
    examples: [
        { command: 'monomind hooks notify -m "Build complete"', description: 'Send info notification' },
        { command: 'monomind hooks notify -m "Test failed" -l error', description: 'Send error notification' },
    ],
    action: async (ctx) => {
        const message = ctx.args[0] || ctx.flags.message;
        const level = ctx.flags.level || 'info';
        if (!message) {
            output.printError('Message is required: --message "your message"');
            return { success: false, exitCode: 1 };
        }
        const timestamp = new Date().toISOString();
        if (level === 'error') {
            output.printError(`[${timestamp}] ${message}`);
        }
        else if (level === 'warn') {
            output.writeln(output.warning(`[${timestamp}] ${message}`));
        }
        else {
            output.printInfo(`[${timestamp}] ${message}`);
        }
        // Store notification in memory if available
        try {
            const { storeEntry } = await import('../memory/memory-initializer.js');
            await storeEntry({ key: `notify-${Date.now()}`, value: `[${level}] ${message}`, namespace: 'notifications' });
        }
        catch { /* memory not available */ }
        return { success: true, data: { timestamp, level, message } };
    }
};
//# sourceMappingURL=hooks-extended-commands.js.map