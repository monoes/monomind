import { describe, it, expect, vi } from 'vitest';

import { EntityCleanupWorker } from '../../packages/@monomind/hooks/src/workers/entity-cleanup.js';

describe('EntityCleanupWorker', () => {
  it('calls pruneExpired on entity memory', async () => {
    const pruneExpiredMock = vi.fn().mockReturnValue(0);
    const worker = new EntityCleanupWorker({
      entityMemory: { pruneExpired: pruneExpiredMock },
    });

    await worker.cleanup();

    expect(pruneExpiredMock).toHaveBeenCalledTimes(1);
  });

  it('returns pruned count', async () => {
    const pruneExpiredMock = vi.fn().mockReturnValue(5);
    const worker = new EntityCleanupWorker({
      entityMemory: { pruneExpired: pruneExpiredMock },
    });

    const result = await worker.cleanup();

    expect(result).toBe(5);
  });

  it('returns 0 when pruneExpired throws', async () => {
    const pruneExpiredMock = vi.fn().mockImplementation(() => {
      throw new Error('DB corrupted');
    });
    const worker = new EntityCleanupWorker({
      entityMemory: { pruneExpired: pruneExpiredMock },
    });

    const result = await worker.cleanup();

    expect(result).toBe(0);
  });
});
