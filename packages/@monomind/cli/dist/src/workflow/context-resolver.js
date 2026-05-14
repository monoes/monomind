export class ContextResolutionError extends Error {
    taskId;
    missingDeps;
    constructor(taskId, missingDeps) {
        super(`Task "${taskId}" has unresolved dependencies: ${missingDeps.join(', ')}`);
        this.taskId = taskId;
        this.missingDeps = missingDeps;
        this.name = 'ContextResolutionError';
    }
}
/**
 * Resolves upstream context for a task by collecting results from its dependencies.
 * Throws ContextResolutionError if any dependency result is missing.
 */
export function resolveContext(task, results) {
    const deps = task.contextDeps ?? [];
    const missing = deps.filter((dep) => !results.has(dep));
    if (missing.length > 0) {
        throw new ContextResolutionError(task.id, missing);
    }
    return deps.map((dep) => results.get(dep));
}
//# sourceMappingURL=context-resolver.js.map