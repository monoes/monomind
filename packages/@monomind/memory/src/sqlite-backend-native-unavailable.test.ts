import { beforeEach, describe, expect, it, vi } from 'vitest';

// Callers (the CLI memory bridge) fall back to sql.js only when better-sqlite3 itself
// cannot be loaded, which SQLiteBackend signals with code MEMORY_NATIVE_UNAVAILABLE.
// Failures about the database (busy, corrupt) must not carry that code.

let constructorError: Error;
vi.mock('better-sqlite3', () => ({
  default: class {
    constructor() {
      throw constructorError;
    }
  },
}));

import { SQLiteBackend } from './sqlite-backend.js';

describe('SQLiteBackend native availability signal', () => {
  beforeEach(() => {
    constructorError = new Error('unset');
  });

  it('tags a missing native binding', async () => {
    constructorError = new Error('Could not locate the bindings file. Tried: ...');
    await expect(
      new SQLiteBackend({ databasePath: ':memory:' }).initialize(),
    ).rejects.toMatchObject({
      code: 'MEMORY_NATIVE_UNAVAILABLE',
    });
  });

  it('tags an ABI-mismatched binding', async () => {
    constructorError = Object.assign(new Error('was compiled against NODE_MODULE_VERSION 115'), {
      code: 'ERR_DLOPEN_FAILED',
    });
    await expect(
      new SQLiteBackend({ databasePath: ':memory:' }).initialize(),
    ).rejects.toMatchObject({
      code: 'MEMORY_NATIVE_UNAVAILABLE',
    });
  });

  it('does not tag a database-level failure', async () => {
    constructorError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    await expect(new SQLiteBackend({ databasePath: ':memory:' }).initialize()).rejects.toBe(
      constructorError,
    );
  });
});
