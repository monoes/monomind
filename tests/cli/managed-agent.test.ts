import { describe, it, expect } from 'vitest';

import { ManagedAgent, spawnAndAwait, runBatch } from '../../packages/@monobrain/cli/src/agents/managed-agent.js';

describe('ManagedAgent', () => {
  const successRunner = async (_slug: string, _id: string, task: string) => `Done: ${task}`;
  const errorRunner = async () => { throw new Error('Agent failed'); };
  const slowRunner = async () => new Promise<string>(resolve => setTimeout(() => resolve('late'), 5000));

  it('spawnAndAwait returns success with output', async () => {
    const result = await spawnAndAwait('coder', 'write tests', successRunner);
    expect(result.status).toBe('success');
    expect(result.output).toBe('Done: write tests');
    expect(result.agentSlug).toBe('coder');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('spawnAndAwait returns error on runner failure', async () => {
    const result = await spawnAndAwait('coder', 'bad task', errorRunner);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Agent failed');
  });

  it('spawnAndAwait returns timeout when runner exceeds timeoutMs', async () => {
    const result = await spawnAndAwait('coder', 'slow task', slowRunner, { timeoutMs: 50 });
    expect(result.status).toBe('timeout');
    expect(result.durationMs).toBeGreaterThanOrEqual(50);
  });

  it('ManagedAgent.run delegates to spawnAndAwait', async () => {
    const agent = ManagedAgent.create('tester', successRunner);
    const result = await agent.run('check coverage');
    expect(result.status).toBe('success');
    expect(result.output).toContain('check coverage');
  });

  it('toToolDescriptor generates correct tool name', () => {
    const agent = ManagedAgent.create('engineering-security-engineer', successRunner);
    const desc = agent.toToolDescriptor();
    expect(desc.name).toBe('agent_engineering_security_engineer');
    expect(desc.inputSchema.required).toContain('task');
  });

  it('runBatch runs all agents in parallel', async () => {
    const results = await runBatch(
      [
        { agentSlug: 'coder', task: 'task A' },
        { agentSlug: 'tester', task: 'task B' },
      ],
      successRunner
    );
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('success');
  });

  it('runBatch handles mixed success and failure', async () => {
    let callCount = 0;
    const mixedRunner = async () => {
      callCount++;
      if (callCount === 1) throw new Error('fail');
      return 'ok';
    };
    const results = await runBatch(
      [{ agentSlug: 'a', task: 'x' }, { agentSlug: 'b', task: 'y' }],
      mixedRunner
    );
    expect(results.some(r => r.status === 'error')).toBe(true);
    expect(results.some(r => r.status === 'success')).toBe(true);
  });

  it('generates unique taskIds', async () => {
    const r1 = await spawnAndAwait('coder', 'task1', successRunner);
    const r2 = await spawnAndAwait('coder', 'task2', successRunner);
    expect(r1.taskId).not.toBe(r2.taskId);
  });
});
