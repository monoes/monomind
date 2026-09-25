import { describe, expect, it } from 'vitest';
import type { BuildResult } from '../../src/pipeline/orchestrator.js';
import { createRebuildQueue, type RebuildEvent } from '../../src/watch/rebuild-queue.js';

const built: BuildResult = {
  status: 'built',
  nodes: { before: 1, after: 2 },
  edges: { before: 0, after: 0 },
};

describe('createRebuildQueue (#338)', () => {
  it('folds changes that arrive mid-build into one follow-up build instead of racing it', async () => {
    const calls: string[][] = [];
    let release: () => void = () => {};
    const events: RebuildEvent[] = [];
    const queue = createRebuildQueue({
      build: async (files) => {
        calls.push(files);
        if (calls.length === 1) await new Promise<void>((r) => (release = r));
        return built;
      },
      onEvent: (e) => events.push(e),
    });

    queue.enqueue(['/r/a.ts']);
    queue.enqueue(['/r/b.ts']);
    queue.enqueue(['/r/c.ts', '/r/b.ts']);
    expect(calls).toEqual([['/r/a.ts']]);

    release();
    await new Promise((r) => setTimeout(r, 20));

    expect(calls).toEqual([['/r/a.ts'], ['/r/b.ts', '/r/c.ts']]);
    expect(events.filter((e) => e.kind === 'built')).toHaveLength(2);
    queue.stop();
  });

  it('keeps a failed batch from blocking later ones and reports the failure', async () => {
    const events: RebuildEvent[] = [];
    let n = 0;
    const queue = createRebuildQueue({
      build: async () => {
        n += 1;
        if (n === 1) throw new Error('boom');
        return built;
      },
      onEvent: (e) => events.push(e),
    });

    queue.enqueue(['/r/a.ts']);
    await new Promise((r) => setTimeout(r, 10));
    queue.enqueue(['/r/b.ts']);
    await new Promise((r) => setTimeout(r, 10));

    expect(events.map((e) => e.kind)).toEqual(['start', 'failed', 'start', 'built']);
    queue.stop();
  });

  it('retries a lock-skipped batch with changes that arrived meanwhile, logging the deferral once', async () => {
    const calls: string[][] = [];
    const events: RebuildEvent[] = [];
    const queue = createRebuildQueue({
      retryDelayMs: 10,
      build: async (files) => {
        calls.push(files);
        return calls.length <= 3
          ? { status: 'skipped', reason: 'locked', message: 'Another build is in progress — skipping' }
          : built;
      },
      onEvent: (e) => events.push(e),
    });

    queue.enqueue(['/r/a.ts']);
    await new Promise((r) => setTimeout(r, 5));
    queue.enqueue(['/r/b.ts']);
    await new Promise((r) => setTimeout(r, 100));

    expect(calls.at(-1)).toEqual(['/r/a.ts', '/r/b.ts']);
    expect(events.map((e) => e.kind)).toEqual(['start', 'deferred', 'built']);
    queue.stop();
  });
});
