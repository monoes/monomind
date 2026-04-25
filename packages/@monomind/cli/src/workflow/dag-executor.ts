import type { DAGTask, TaskResult, DAGLevel } from './dag-types.js';
import { buildDAG, detectCycles, topologicalSort } from './dag-builder.js';
import { resolveContext } from './context-resolver.js';

export type TaskRunner = (
  task: DAGTask,
  upstreamContext: TaskResult[]
) => Promise<TaskResult>;

export class DAGExecutor {
  constructor(private readonly runner: TaskRunner) {}

  async execute(tasks: DAGTask[]): Promise<Map<string, TaskResult>> {
    const dag = buildDAG(tasks);
    const cycles = detectCycles(dag);

    if (cycles.length > 0) {
      throw new Error(
        `Cycle detected in task DAG: ${cycles[0].join(' → ')}`
      );
    }

    const levels: DAGLevel[] = topologicalSort(dag);
    const results = new Map<string, TaskResult>();

    for (const level of levels) {
      const levelResults = await Promise.all(
        level.map(async (task) => {
          const context = resolveContext(task, results);
          const timeoutMs = task.timeoutMs ?? 300_000;

          const result = await Promise.race([
            this.runWithRetry(task, context),
            new Promise<TaskResult>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Task "${task.id}" timed out after ${timeoutMs}ms`
                    )
                  ),
                timeoutMs
              )
            ),
          ]).catch(
            (err): TaskResult => ({
              taskId: task.id,
              agentSlug: task.agentSlug,
              output: null,
              outputRaw: '',
              latencyMs: 0,
              retryCount: 0,
              completedAt: Date.now(),
              status: String(err).includes('timed out') ? 'timeout' : 'error',
              error: String(err),
            })
          );

          return result;
        })
      );

      for (const result of levelResults) {
        results.set(result.taskId, result);
      }
    }

    return results;
  }

  private async runWithRetry(
    task: DAGTask,
    context: TaskResult[]
  ): Promise<TaskResult> {
    const policy = task.retryPolicy ?? {
      maxAttempts: 1,
      initialDelayMs: 0,
      backoffMultiplier: 1,
      jitterMs: 0,
      retryOn: [],
    };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      try {
        return await this.runner(task, context);
      } catch (err) {
        lastError = err as Error;
        if (attempt < policy.maxAttempts - 1) {
          const delay =
            policy.initialDelayMs *
              Math.pow(policy.backoffMultiplier, attempt) +
            Math.random() * policy.jitterMs;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    return {
      taskId: task.id,
      agentSlug: task.agentSlug,
      output: null,
      outputRaw: '',
      latencyMs: 0,
      retryCount: policy.maxAttempts,
      completedAt: Date.now(),
      status: 'error',
      error: lastError?.message ?? 'Unknown error',
    };
  }
}
