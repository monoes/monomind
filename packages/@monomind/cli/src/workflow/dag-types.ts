export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
  retryOn: Array<'RATE_LIMIT' | 'TIMEOUT' | 'VALIDATION' | 'UNKNOWN'>;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2.0,
  jitterMs: 500,
  retryOn: ['RATE_LIMIT', 'TIMEOUT'],
};

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
  tokenUsage?: { input: number; output: number };
  latencyMs: number;
  retryCount: number;
  completedAt: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

export type DAGLevel = DAGTask[];

export interface DAG {
  tasks: Map<string, DAGTask>;
  edges: Map<string, Set<string>>;        // taskId → dependents
  reverseEdges: Map<string, Set<string>>; // taskId → dependencies
}
