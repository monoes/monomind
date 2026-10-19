import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteBackend } from './sqlite-backend.js';
import { SqlJsBackend } from './sqljs-backend.js';
import { createDefaultEntry } from './types.js';

// sql.js holds the whole database in memory and exports all of it on every persist.
// A long-lived server that re-exported its stale snapshot every few seconds therefore
// erased writes made by other processes (the CLI, hooks) in the meantime — even when the
// server itself had written nothing. And opening a database that better-sqlite3 owns
// (WAL journal, FTS5 index) with sql.js silently loses data, so that must be refused.

describe('SqlJsBackend persist safety', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monomind-sqljs-safety-'));
    dbPath = join(dir, 'memory.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const open = async () => {
    const backend = new SqlJsBackend({ databasePath: dbPath, autoPersistInterval: 0 });
    await backend.initialize();
    return backend;
  };

  const put = (backend: SqlJsBackend, key: string) =>
    backend.store(createDefaultEntry({ key, content: `content ${key}` }));

  const keysOnDisk = async (): Promise<string[]> => {
    const reader = await open();
    try {
      const rows = await reader.query({ type: 'exact', limit: 100 } as never);
      return rows.map((e) => e.key).sort();
    } finally {
      await reader.shutdown();
    }
  };

  async function seed(...keys: string[]) {
    const seeder = await open();
    for (const k of keys) await put(seeder, k);
    await seeder.shutdown();
  }

  it('an idle persist does not overwrite a write another process made', async () => {
    await seed('M1');
    const server = await open();

    const cli = await open();
    await put(cli, 'C1');
    await cli.shutdown();

    await server.persist(); // nothing written by the server: must be a no-op
    await server.shutdown();

    expect(await keysOnDisk()).toEqual(['C1', 'M1']);
  });

  it('refuses to persist over a file that changed underneath it, and reports it', async () => {
    await seed('M1');
    const server = await open();
    await put(server, 'S1');

    const cli = await open();
    await put(cli, 'C1');
    await cli.shutdown();

    await expect(server.persist()).rejects.toThrow(/changed on disk/);
    await server.shutdown().catch(() => undefined);

    expect(await keysOnDisk()).toEqual(['C1', 'M1']);
  });

  it('persists its own consecutive writes', async () => {
    const server = await open();
    await put(server, 'A');
    await server.persist();
    await put(server, 'B');
    await server.persist();
    await server.shutdown();

    expect(await keysOnDisk()).toEqual(['A', 'B']);
  });

  it('writes a brand-new database file even when nothing was stored', async () => {
    const server = await open();
    await server.shutdown();
    expect(existsSync(dbPath)).toBe(true);
  });

  describe('refuses databases it cannot safely own', () => {
    const seedNative = async (walMode: boolean) => {
      const native = new SQLiteBackend({ databasePath: dbPath, walMode });
      await native.initialize();
      await native.store(createDefaultEntry({ key: 'N1', content: 'native' }));
      await native.shutdown();
    };

    it('a WAL-mode database', async () => {
      await seedNative(true);
      await expect(open()).rejects.toMatchObject({ code: 'SQLJS_UNSAFE_DATABASE' });
    });

    it('a database with a live -wal file', async () => {
      writeFileSync(dbPath, Buffer.alloc(0));
      writeFileSync(`${dbPath}-wal`, Buffer.from('pending frames'));
      await expect(open()).rejects.toMatchObject({ code: 'SQLJS_UNSAFE_DATABASE' });
    });

    it('a database with an FTS5 index', async () => {
      await seedNative(false);
      await expect(open()).rejects.toMatchObject({ code: 'SQLJS_UNSAFE_DATABASE' });
    });
  });
});
