import type { DAGTask, TaskResult } from './dag-types.js';
export declare class ContextResolutionError extends Error {
    readonly taskId: string;
    readonly missingDeps: string[];
    constructor(taskId: string, missingDeps: string[]);
}
/**
 * Resolves upstream context for a task by collecting results from its dependencies.
 * Throws ContextResolutionError if any dependency result is missing.
 */
export declare function resolveContext(task: DAGTask, results: Map<string, TaskResult>): TaskResult[];
//# sourceMappingURL=context-resolver.d.ts.map