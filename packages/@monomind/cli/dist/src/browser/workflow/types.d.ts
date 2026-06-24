export interface WorkflowDef {
    id: string;
    name: string;
    nodes: NodeDef[];
    connections: ConnectionDef[];
}
export interface NodeDef {
    id: string;
    type: string;
    name?: string;
    config: Record<string, unknown>;
    onError?: 'skip' | 'stop';
}
export interface ConnectionDef {
    from: string;
    to: string;
    handle?: string;
}
export interface Item {
    data: Record<string, unknown>;
    binary?: string;
}
export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';
export interface RunRecord {
    id: string;
    workflowId: string;
    workflowName: string;
    status: RunStatus;
    startedAt: number;
    completedAt?: number;
    itemsProcessed: number;
    itemsTotal: number;
    error?: string;
}
export interface StepEvent {
    runId: string;
    workflowId: string;
    workflowName: string;
    nodeId: string;
    nodeName: string;
    eventType: 'run_started' | 'step_started' | 'step_completed' | 'step_failed' | 'run_completed' | 'run_stopped';
    itemIndex?: number;
    itemTotal?: number;
    durationMs?: number;
    error?: string;
    timestamp: number;
}
//# sourceMappingURL=types.d.ts.map