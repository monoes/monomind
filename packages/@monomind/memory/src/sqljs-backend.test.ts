import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqlJsBackend } from './sqljs-backend.js';

describe('SqlJsBackend auto-persist failures', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function createBackend() {
    const dir = mkdtempSync(join(tmpdir(), 'monomind-sqljs-'));
    tempDirs.push(dir);
    return new SqlJsBackend({
      databasePath: join(dir, 'memory.db'),
      autoPersistInterval: 25,
      verbose: false,
    });
  }

  function captureAutoPersistCallback() {
    let callback: (() => void) | undefined;
    vi.spyOn(global, 'setInterval').mockImplementation(
      ((fn: () => void) => {
        callback = fn;
        return {} as NodeJS.Timeout;
      }) as typeof setInterval,
    );
    return () => {
      expect(callback).toBeDefined();
      callback!();
    };
  }

  it('does not throw when an unattended auto-persist fails', async () => {
    const triggerAutoPersist = captureAutoPersistCallback();
    const backend = createBackend();
    await backend.initialize();
    const diskFull = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    const persist = vi.spyOn(backend, 'persist').mockRejectedValue(diskFull);

    triggerAutoPersist();
    await Promise.resolve();
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);

    persist.mockRestore();
    await backend.shutdown();
  });

  it('reports an auto-persist failure to an installed error listener', async () => {
    const triggerAutoPersist = captureAutoPersistCallback();
    const backend = createBackend();
    await backend.initialize();
    const diskFull = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    const onError = vi.fn();
    backend.on('error', onError);
    const persist = vi.spyOn(backend, 'persist').mockRejectedValue(diskFull);

    triggerAutoPersist();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith({ operation: 'auto-persist', error: diskFull });

    persist.mockRestore();
    await backend.shutdown();
  });
});
