import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DAGExecutor } from '../../packages/@monobrain/cli/src/workflow/dag-executor.js';
import type { DAGTask, TaskResult } from '../../packages/@monobrain/cli/src/workflow/dag-types.js';

describe('DAGExecutor', () => {
  const mockRunner = vi.fn(async (task: DAGTask, _ctx: TaskResult[]): Promise<TaskResult> => ({
    taskId: task.id,
    agentSlug: task.agentSlug,
    output: `result-${task.id}`,
    outputRaw: `result-${task.id}`,
    latencyMs: 10,
    retryCount: 0,
    completedAt: Date.now(),
    status: 'success',
  }));

  beforeEach(() => {
    mockRunner.mockClear();
  });

  it('executes a simple linear chain', async () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder' },
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['a'] },
    ];
    const executor = new DAGExecutor(mockRunner);
    const results = await executor.execute(tasks);
    expect(results.size).toBe(2);
    expect(results.get('a')?.status).toBe('success');
    expect(results.get('b')?.status).toBe('success');
  });

  it('passes upstream context to downstream tasks', async () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder' },
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['a'] },
    ];
    const executor = new DAGExecutor(mockRunner);
    await executor.execute(tasks);
    // Second call should have received context from 'a'
    const secondCall = mockRunner.mock.calls[1];
    expect(secondCall[1]).toHaveLength(1);
    expect(secondCall[1][0].taskId).toBe('a');
  });

  it('throws on cyclic dependencies', async () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder', contextDeps: ['b'] },
      { id: 'b', description: 'B', agentSlug: 'tester', contextDeps: ['a'] },
    ];
    const executor = new DAGExecutor(mockRunner);
    await expect(executor.execute(tasks)).rejects.toThrow('Cycle');
  });

  it('handles task timeout', async () => {
    const slowRunner = vi.fn(
      async () =>
        new Promise<TaskResult>((resolve) =>
          setTimeout(
            () => resolve({} as TaskResult),
            5000
          )
        )
    );
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder', timeoutMs: 50 },
    ];
    const executor = new DAGExecutor(slowRunner);
    const results = await executor.execute(tasks);
    expect(results.get('a')?.status).toBe('timeout');
  });

  it('executes parallel tasks at same level concurrently', async () => {
    const tasks: DAGTask[] = [
      { id: 'a', description: 'A', agentSlug: 'coder' },
      { id: 'b', description: 'B', agentSlug: 'tester' },
    ];
    const executor = new DAGExecutor(mockRunner);
    const results = await executor.execute(tasks);
    expect(results.size).toBe(2);
    // Both at level 0, should be called
    expect(mockRunner).toHaveBeenCalledTimes(2);
  });
});
