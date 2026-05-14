export interface AgentRunResult {
    agentSlug: string;
    taskId: string;
    output: string;
    status: 'success' | 'error' | 'timeout';
    durationMs: number;
    tokens?: {
        inputTokens: number;
        outputTokens: number;
    };
    error?: string;
}
export interface ManagedAgentOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
}
/**
 * Simulates spawn-and-await by creating a taskId, delegating to a runner function,
 * and applying timeout.
 */
export declare function spawnAndAwait(agentSlug: string, task: string, runner: (agentSlug: string, taskId: string, task: string) => Promise<string>, options?: ManagedAgentOptions): Promise<AgentRunResult>;
export declare class ManagedAgent {
    private readonly agentSlug;
    private readonly runner;
    private readonly options;
    constructor(agentSlug: string, runner: (agentSlug: string, taskId: string, task: string) => Promise<string>, options?: ManagedAgentOptions);
    run(task: string): Promise<AgentRunResult>;
    /** Generate an MCP-style tool descriptor for this agent */
    toToolDescriptor(): {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    };
    static create(agentSlug: string, runner: (slug: string, id: string, task: string) => Promise<string>, options?: ManagedAgentOptions): ManagedAgent;
}
/** Run multiple agents in parallel */
export declare function runBatch(agents: Array<{
    agentSlug: string;
    task: string;
}>, runner: (agentSlug: string, taskId: string, task: string) => Promise<string>, options?: ManagedAgentOptions): Promise<AgentRunResult[]>;
//# sourceMappingURL=managed-agent.d.ts.map