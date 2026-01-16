import type { DAGTask, TaskResult } from './dag-types.js';

export class ContextResolutionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly missingDeps: string[]
  ) {
    super(
      `Task "${taskId}" has unresolved dependencies: ${missingDeps.join(', ')}`
    );
    this.name = 'ContextResolutionError';
  }
}

/**
 * Resolves upstream context for a task by collecting results from its dependencies.
 * Throws ContextResolutionError if any dependency result is missing.
 */
export function resolveContext(
  task: DAGTask,
  results: Map<string, TaskResult>
): TaskResult[] {
  const deps = task.contextDeps ?? [];
  const missing = deps.filter((dep) => !results.has(dep));

  if (missing.length > 0) {
    throw new ContextResolutionError(task.id, missing);
  }

  return deps.map((dep) => results.get(dep)!);
}
