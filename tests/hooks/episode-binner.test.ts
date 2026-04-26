import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EpisodeBinnerWorker } from '../../packages/@monomind/hooks/src/workers/episode-binner.js';

// Mock the registry so registerHook captures the handlers
const registeredHooks: Array<{ event: string; handler: Function }> = [];
vi.mock('../../packages/@monomind/hooks/src/registry/index.js', () => ({
  registerHook: vi.fn((event: string, handler: Function) => {
    registeredHooks.push({ event, handler });
    return `hook-${registeredHooks.length}`;
  }),
}));

describe('EpisodeBinnerWorker', () => {
  let mockStore: { addRun: ReturnType<typeof vi.fn>; closeEpisode: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    registeredHooks.length = 0;
    mockStore = {
      addRun: vi.fn().mockResolvedValue(null),
      closeEpisode: vi.fn().mockResolvedValue(null),
    };
  });

  it('calls store.addRun on PostTask event', async () => {
    const worker = new EpisodeBinnerWorker(mockStore as any);
    worker.register();

    const postTaskHook = registeredHooks.find((h) => h.event === 'post-task');
    expect(postTaskHook).toBeDefined();

    const ctx = {
      event: 'post-task',
      timestamp: new Date(),
      task: { id: 'task-1', description: 'fix bug', agent: 'coder', status: 'completed' },
      session: { id: 'sess-1', startedAt: new Date() },
    };

    await postTaskHook!.handler(ctx);

    expect(mockStore.addRun).toHaveBeenCalledWith(
      'task-1',
      'coder',
      'completed',
      'fix bug',
      'sess-1',
    );
  });

  it('calls store.closeEpisode on SessionEnd event', async () => {
    const worker = new EpisodeBinnerWorker(mockStore as any);
    worker.register();

    const sessionEndHook = registeredHooks.find((h) => h.event === 'session-end');
    expect(sessionEndHook).toBeDefined();

    await sessionEndHook!.handler({
      event: 'session-end',
      timestamp: new Date(),
    });

    expect(mockStore.closeEpisode).toHaveBeenCalled();
  });
});
