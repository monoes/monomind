import type { DAGTask, TaskResult } from './dag-types.js';
export type TaskRunner = (task: DAGTask, upstreamContext: TaskResult[]) => Promise<TaskResult>;
export declare class DAGExecutor {
    private readonly runner;
    constructor(runner: TaskRunner);
    execute(tasks: DAGTask[]): Promise<Map<string, TaskResult>>;
    private runWithRetry;
}
//# sourceMappingURL=dag-executor.d.ts.map