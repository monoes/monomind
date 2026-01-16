import { describe, it, expect, beforeEach, vi } from 'vitest';

import { TraceCollector } from '../../packages/@monobrain/hooks/src/observability/trace-collector.js';

// Mock registerHook to capture registrations without executing real logic
const mockRegister = vi.fn((..._args: unknown[]) => `hook-${mockRegister.mock.calls.length}`);

vi.mock('../../packages/@monobrain/hooks/src/registry/index.js', () => ({
  registerHook: (...args: unknown[]) => mockRegister(...args),
}));

function makeMockStore() {
  return {
    startTrace: vi.fn(),
    endTrace: vi.fn(),
    startSpan: vi.fn().mockReturnValue({ spanId: 's1', toolCalls: [], status: 'running' }),
    endSpan: vi.fn(),
    recordToolCall: vi.fn(),
    close: vi.fn(),
  };
}

describe('TraceCollector', () => {
  beforeEach(() => {
    mockRegister.mockClear();
  });

  it('registers hooks for all expected events', () => {
    const store = makeMockStore();
    const collector = new TraceCollector(store as any);
    collector.register();

    expect(mockRegister).toHaveBeenCalledTimes(6);
    const hookNames = mockRegister.mock.calls.map(
      (args: unknown[]) => (args[3] as { name: string } | undefined)?.name,
    );
    expect(hookNames).toContain('trace-collector:pre-task');
    expect(hookNames).toContain('trace-collector:post-task');
    expect(hookNames).toContain('trace-collector:agent-spawn');
    expect(hookNames).toContain('trace-collector:agent-terminate');
    expect(hookNames).toContain('trace-collector:pre-tool-use');
    expect(hookNames).toContain('trace-collector:post-tool-use');
  });

  it('creates traceId on PreTask handler', async () => {
    const store = makeMockStore();
    const collector = new TraceCollector(store as any);
    collector.register();

    // Find the pre-task handler (first arg is event, second is handler)
    const preTaskCall = mockRegister.mock.calls.find(
      (args: unknown[]) => args[0] === 'pre-task',
    );
    expect(preTaskCall).toBeDefined();

    const handler = preTaskCall![1] as (ctx: Record<string, unknown>) => Promise<{ success: boolean }>;
    const ctx: Record<string, unknown> = {
      event: 'pre-task',
      timestamp: new Date(),
      task: { id: 'task-1', description: 'test task' },
      session: { id: 'sess-1', startedAt: new Date() },
    };
    const result = await handler(ctx);

    expect(result.success).toBe(true);
    expect(ctx.traceId).toBeDefined();
    expect(typeof ctx.traceId).toBe('string');
    expect((ctx.traceId as string).startsWith('trc_')).toBe(true);
    expect(store.startTrace).toHaveBeenCalledOnce();
  });

  it('creates spanId on AgentSpawn handler', async () => {
    const store = makeMockStore();
    const collector = new TraceCollector(store as any);
    collector.register();

    // First fire pre-task to populate the taskTraceMap
    const preTaskCall = mockRegister.mock.calls.find(
      (args: unknown[]) => args[0] === 'pre-task',
    );
    const preTaskHandler = preTaskCall![1] as (ctx: Record<string, unknown>) => Promise<{ success: boolean }>;
    const taskCtx: Record<string, unknown> = {
      event: 'pre-task',
      timestamp: new Date(),
      task: { id: 'task-2', description: 'spawn test' },
      session: { id: 'sess-2', startedAt: new Date() },
    };
    await preTaskHandler(taskCtx);
    const traceId = taskCtx.traceId as string;

    // Then fire agent-spawn
    const agentSpawnCall = mockRegister.mock.calls.find(
      (args: unknown[]) => args[0] === 'agent-spawn',
    );
    const spawnHandler = agentSpawnCall![1] as (ctx: Record<string, unknown>) => Promise<{ success: boolean }>;
    const spawnCtx: Record<string, unknown> = {
      event: 'agent-spawn',
      timestamp: new Date(),
      traceId,
      agent: { id: 'agent-1', type: 'coder' },
    };
    const result = await spawnHandler(spawnCtx);

    expect(result.success).toBe(true);
    expect(spawnCtx.spanId).toBeDefined();
    expect(typeof spawnCtx.spanId).toBe('string');
    expect((spawnCtx.spanId as string).startsWith('spn_')).toBe(true);
    expect(store.startSpan).toHaveBeenCalledOnce();
  });
});
