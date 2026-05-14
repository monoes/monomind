import type { WorkflowDefinition } from './dsl-schema.js';
export interface AgentDispatcher {
    dispatch(agent: string, task: string, context: Record<string, unknown>): Promise<unknown>;
}
export interface StepResult {
    stepId: string;
    output: unknown;
    status: 'success' | 'error';
    error?: string;
}
export interface WorkflowResult {
    workflowName: string;
    status: 'success' | 'error';
    stepResults: StepResult[];
    context: Record<string, unknown>;
}
export declare class WorkflowExecutor {
    private readonly dispatcher;
    constructor(dispatcher: AgentDispatcher);
    execute(workflow: WorkflowDefinition): Promise<WorkflowResult>;
    private executeStep;
    private executeAgent;
    private executeParallel;
    private executeSequence;
    private executeConditional;
    private executeMapReduce;
    private executeLoop;
}
//# sourceMappingURL=workflow-executor.d.ts.map