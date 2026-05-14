import { buildDAG, detectCycles, topologicalSort } from './dag-builder.js';
import { resolveContext } from './context-resolver.js';
import { getMonitor } from '../production/monitoring.js';
function classifyError(err) {
    const msg = err.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests'))
        return 'RATE_LIMIT';
    if (msg.includes('timed out') || msg.includes('timeout'))
        return 'TIMEOUT';
    if (msg.includes('validation') || msg.includes('invalid') || msg.includes('schema'))
        return 'VALIDATION';
    return 'UNKNOWN';
}
export class DAGExecutor {
    runner;
    constructor(runner) {
        this.runner = runner;
    }
    async execute(tasks) {
        const dag = buildDAG(tasks);
        const cycles = detectCycles(dag);
        if (cycles.length > 0) {
            throw new Error(`Cycle detected in task DAG: ${cycles[0].join(' → ')}`);
        }
        const levels = topologicalSort(dag);
        const results = new Map();
        for (const level of levels) {
            const levelResults = await Promise.all(level.map(async (task) => {
                const context = resolveContext(task, results);
                const timeoutMs = task.timeoutMs ?? 300_000;
                let timeoutHandle;
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutHandle = setTimeout(() => reject(new Error(`Task "${task.id}" timed out after ${timeoutMs}ms`)), timeoutMs);
                });
                const result = await Promise.race([
                    this.runWithRetry(task, context),
                    timeoutPromise,
                ]).finally(() => {
                    if (timeoutHandle)
                        clearTimeout(timeoutHandle);
                }).catch((err) => {
                    const isTimeout = String(err).includes('timed out');
                    if (isTimeout) {
                        // Visible in monomind control — leaked task still running in background
                        getMonitor().counter('dag.task.timeout_leak', 1, {
                            taskId: task.id,
                            agentSlug: task.agentSlug,
                        });
                    }
                    return {
                        taskId: task.id,
                        agentSlug: task.agentSlug,
                        output: null,
                        outputRaw: '',
                        latencyMs: 0,
                        retryCount: 0,
                        completedAt: Date.now(),
                        status: isTimeout ? 'timeout' : 'error',
                        error: String(err),
                    };
                });
                return result;
            }));
            for (const result of levelResults) {
                results.set(result.taskId, result);
            }
        }
        return results;
    }
    async runWithRetry(task, context) {
        const policy = task.retryPolicy ?? {
            maxAttempts: 1,
            initialDelayMs: 0,
            backoffMultiplier: 1,
            jitterMs: 0,
            retryOn: [],
        };
        let lastError;
        let actualAttempts = 0;
        for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
            actualAttempts = attempt + 1;
            try {
                return await this.runner(task, context);
            }
            catch (err) {
                lastError = err;
                // If retryOn is non-empty, check whether this error category matches.
                // Unmatched errors consume the attempt but do not get retried further.
                if (policy.retryOn.length > 0) {
                    const category = classifyError(lastError);
                    if (!policy.retryOn.includes(category)) {
                        break;
                    }
                }
                if (attempt < policy.maxAttempts - 1) {
                    const delay = policy.initialDelayMs *
                        Math.pow(policy.backoffMultiplier, attempt) +
                        Math.random() * policy.jitterMs;
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }
        return {
            taskId: task.id,
            agentSlug: task.agentSlug,
            output: null,
            outputRaw: '',
            latencyMs: 0,
            retryCount: actualAttempts,
            completedAt: Date.now(),
            status: 'error',
            error: lastError?.message ?? 'Unknown error',
        };
    }
}
//# sourceMappingURL=dag-executor.js.map