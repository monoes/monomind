import { randomBytes } from 'node:crypto';
/**
 * Simulates spawn-and-await by creating a taskId, delegating to a runner function,
 * and applying timeout.
 */
export async function spawnAndAwait(agentSlug, task, runner, options = {}) {
    const { timeoutMs = 120_000 } = options;
    const startedAt = Date.now();
    const taskId = `managed-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    try {
        let timeoutHandle;
        const output = await Promise.race([
            runner(agentSlug, taskId, task),
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]).finally(() => clearTimeout(timeoutHandle));
        return {
            agentSlug, taskId, output, status: 'success',
            durationMs: Date.now() - startedAt,
        };
    }
    catch (err) {
        const isTimeout = String(err).includes('Timeout');
        return {
            agentSlug, taskId, output: '',
            status: isTimeout ? 'timeout' : 'error',
            durationMs: Date.now() - startedAt,
            error: String(err),
        };
    }
}
export class ManagedAgent {
    agentSlug;
    runner;
    options;
    constructor(agentSlug, runner, options = {}) {
        this.agentSlug = agentSlug;
        this.runner = runner;
        this.options = options;
    }
    async run(task) {
        return spawnAndAwait(this.agentSlug, task, this.runner, this.options);
    }
    /** Generate an MCP-style tool descriptor for this agent */
    toToolDescriptor() {
        const toolName = `agent_${this.agentSlug.replace(/-/g, '_')}`;
        return {
            name: toolName,
            description: `Delegate a task to the ${this.agentSlug} specialist agent`,
            inputSchema: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'Task description' },
                    timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000)' },
                },
                required: ['task'],
            },
        };
    }
    static create(agentSlug, runner, options) {
        return new ManagedAgent(agentSlug, runner, options);
    }
}
/** Run multiple agents in parallel */
export async function runBatch(agents, runner, options = {}) {
    return Promise.all(agents.map(({ agentSlug, task }) => spawnAndAwait(agentSlug, task, runner, options)));
}
//# sourceMappingURL=managed-agent.js.map