export interface RetryPolicy {
    maxAttempts: number;
    initialDelayMs: number;
    backoffMultiplier: number;
    jitterMs: number;
    retryOn: Array<'RATE_LIMIT' | 'TIMEOUT' | 'VALIDATION' | 'UNKNOWN'>;
}
export declare const DEFAULT_RETRY_POLICY: RetryPolicy;
export interface DAGTask {
    id: string;
    description: string;
    agentSlug: string;
    contextDeps?: string[];
    outputSchema?: string;
    timeoutMs?: number;
    retryPolicy?: RetryPolicy;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    config?: Record<string, unknown>;
}
export interface TaskResult {
    taskId: string;
    agentSlug: string;
    output: unknown;
    outputRaw: string;
    tokenUsage?: {
        input: number;
        output: number;
    };
    latencyMs: number;
    retryCount: number;
    completedAt: number;
    status: 'success' | 'error' | 'timeout';
    error?: string;
}
export type DAGLevel = DAGTask[];
export interface DAG {
    tasks: Map<string, DAGTask>;
    edges: Map<string, Set<string>>;
    reverseEdges: Map<string, Set<string>>;
}
//# sourceMappingURL=dag-types.d.ts.map