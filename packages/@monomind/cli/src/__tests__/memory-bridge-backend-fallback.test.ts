// The bridge used to fall back to sql.js after ANY failure to initialise the native
// backend. A locked or corrupt database is not an engine problem: sql.js would load a
// stale in-memory copy of the same file and later write it back over the other
// processes' data. It may only take over when better-sqlite3 itself cannot be loaded.

import { describe, expect, it, vi } from 'vitest';
import { openBackendWithFallback } from '../memory/memory-bridge-backend.js';

function fakeModule(nativeError: unknown) {
  const sqlJs = vi.fn();
  class SQLiteBackend {
    async initialize() {
      if (nativeError) throw nativeError;
    }
  }
  class SqlJsBackend {
    constructor() {
      sqlJs();
    }
    async initialize() {}
  }
  return { mod: { SQLiteBackend, SqlJsBackend }, sqlJs };
}

describe('openBackendWithFallback', () => {
  it('uses the native backend when it initialises', async () => {
    const { mod, sqlJs } = fakeModule(null);
    const backend = await openBackendWithFallback(mod, {});
    expect(backend).toBeInstanceOf(mod.SQLiteBackend);
    expect(sqlJs).not.toHaveBeenCalled();
  });

  it('falls back to sql.js when better-sqlite3 cannot be loaded', async () => {
    const { mod, sqlJs } = fakeModule(
      Object.assign(new Error('no native'), { code: 'MEMORY_NATIVE_UNAVAILABLE' }),
    );
    const backend = await openBackendWithFallback(mod, {});
    expect(backend).toBeInstanceOf(mod.SqlJsBackend);
    expect(sqlJs).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a locked database', Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })],
    ['a corrupt database', Object.assign(new Error('malformed'), { code: 'SQLITE_CORRUPT' })],
    ['an unexpected failure', new Error('boom')],
  ])('surfaces %s instead of opening sql.js', async (_name, error) => {
    const { mod, sqlJs } = fakeModule(error);
    await expect(openBackendWithFallback(mod, {})).rejects.toBe(error);
    expect(sqlJs).not.toHaveBeenCalled();
  });
});
