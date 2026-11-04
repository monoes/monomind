/**
 * Versioned schema migrations, run against BOTH drivers.
 *
 * The properties pinned here are the ones a user's existing database depends
 * on: a store written by the pre-runner code is adopted without a single row
 * or schema object changing, re-opening is a no-op, a store from a newer
 * release is refused rather than "repaired", and a migration that throws
 * leaves nothing half-applied.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runMigrations,
  type SchemaMigration,
  SchemaTooNewError,
  schemaMigrationVersion,
} from './schema-migrations.js';
import { BetterSqliteDriver, type SqlDriver, SqlJsDriver } from './sql-driver.js';
import { initializeSchema, LATEST_MEMORY_MIGRATION, SCHEMA_VERSION } from './sql-schema.js';
import { SQLiteBackend } from './sqlite-backend.js';

/**
 * Frozen copy of what the pre-runner `initializeSchema()` (schema version 4)
 * left on disk. Deliberately a literal, not a call into sql-schema.ts: the
 * fixture must keep describing the OLD code path even after the live schema
 * code moves on.
 */
const V4_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY, key TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL,
    namespace TEXT NOT NULL, tags TEXT NOT NULL, metadata TEXT NOT NULL, owner_id TEXT,
    access_level TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    expires_at INTEGER, event_at INTEGER, version INTEGER NOT NULL DEFAULT 1,
    "references" TEXT NOT NULL, access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_namespace ON memory_entries(namespace);
  CREATE INDEX IF NOT EXISTS idx_key ON memory_entries(key);
  CREATE INDEX IF NOT EXISTS idx_type ON memory_entries(type);
  CREATE INDEX IF NOT EXISTS idx_owner_id ON memory_entries(owner_id);
  CREATE INDEX IF NOT EXISTS idx_created_at ON memory_entries(created_at);
  CREATE INDEX IF NOT EXISTS idx_updated_at ON memory_entries(updated_at);
  CREATE INDEX IF NOT EXISTS idx_expires_at ON memory_entries(expires_at);
  CREATE TABLE IF NOT EXISTS memory_embeddings (
    entry_id TEXT PRIMARY KEY, embedding BLOB,
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS memory_entry_tags (
    entry_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (entry_id, tag),
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_entry_tag ON memory_entry_tags(tag, entry_id);
  CREATE TABLE IF NOT EXISTS agent_reads (
    entry_id TEXT NOT NULL, agent_id TEXT NOT NULL, read_at INTEGER NOT NULL,
    UNIQUE(entry_id, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_reads_entry ON agent_reads(entry_id);
  CREATE INDEX IF NOT EXISTS idx_agent_reads_at ON agent_reads(read_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_namespace_key_unique ON memory_entries(namespace, key);
`;

/**
 * FTS5 part of the v4 schema; only builds where FTS5 is compiled in (not sql.js).
 * Trigger bodies keep the old code's exact indentation: SQLite stores the text verbatim.
 */
const V4_FTS_SQL = `
  CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
    entry_id UNINDEXED, key, content, tokenize = 'porter unicode61'
  );
    CREATE TRIGGER memory_entries_fts_ai
    AFTER INSERT ON memory_entries BEGIN
      DELETE FROM memory_entries_fts WHERE entry_id = NEW.id;
      INSERT INTO memory_entries_fts(entry_id, key, content)
        VALUES (NEW.id, NEW.key, NEW.content);
    END;
    CREATE TRIGGER memory_entries_fts_ad
    AFTER DELETE ON memory_entries BEGIN
      DELETE FROM memory_entries_fts WHERE entry_id = OLD.id;
    END;
    CREATE TRIGGER memory_entries_fts_au
    AFTER UPDATE OF key, content ON memory_entries BEGIN
      DELETE FROM memory_entries_fts WHERE entry_id = OLD.id;
      INSERT INTO memory_entries_fts(entry_id, key, content)
        VALUES (NEW.id, NEW.key, NEW.content);
    END;
`;

/** Build a database exactly as the pre-runner code left it, with real rows in every table. */
function buildV4Fixture(driver: SqlDriver): void {
  driver.exec(V4_TABLES_SQL);
  try {
    driver.exec(V4_FTS_SQL);
  } catch {
    /* no FTS5 on this build — the old code skipped it the same way */
  }
  for (const [id, key, updatedAt] of [
    ['e1', 'alpha', 10],
    ['e2', 'beta', 20],
    ['e3', 'gamma', 30],
  ] as const) {
    driver.run(
      `INSERT INTO memory_entries
        (id, key, content, type, namespace, tags, metadata, owner_id, access_level,
         created_at, updated_at, expires_at, event_at, version, "references",
         access_count, last_accessed_at)
       VALUES (?, ?, ?, 'semantic', 'ns', '["t"]', '{}', NULL, 'private',
               1, ?, NULL, NULL, 1, '[]', 0, 1)`,
      [id, key, `content of ${key}`, updatedAt],
    );
    driver.run('INSERT INTO memory_embeddings (entry_id, embedding) VALUES (?, ?)', [
      id,
      new Uint8Array([1, 2, 3, updatedAt]),
    ]);
    driver.run('INSERT INTO memory_entry_tags (entry_id, tag) VALUES (?, ?)', [id, 't']);
  }
  driver.run("INSERT INTO agent_reads (entry_id, agent_id, read_at) VALUES ('e1', 'agent-a', 5)");
  driver.exec('PRAGMA user_version = 4');
}

/** Every schema object (minus the tracking table) and every row of every table. */
function snapshot(driver: SqlDriver): { schema: unknown[]; rows: Record<string, unknown[]> } {
  const schema = driver
    .all(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name != 'schema_migrations' ORDER BY type, name",
    )
    .map((r) => ({ ...r }));
  const rows: Record<string, unknown[]> = {};
  for (const t of driver.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' ORDER BY name",
  )) {
    const name = String(t.name);
    rows[name] = driver.all(`SELECT * FROM "${name}"`).map((r) => ({ ...r }));
  }
  return { schema, rows };
}

const userVersion = (driver: SqlDriver) =>
  Number(driver.get('PRAGMA user_version')?.user_version ?? 0);
const migrationRows = (driver: SqlDriver) =>
  driver.all('SELECT id, description, applied_at, baseline FROM schema_migrations ORDER BY id');
const tableExists = (driver: SqlDriver, name: string) =>
  driver.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]) !== null;

const DRIVERS: Array<{ name: string; create: () => Promise<SqlDriver> }> = [
  {
    name: 'BetterSqliteDriver',
    create: async () => new BetterSqliteDriver(new Database(':memory:') as never),
  },
  {
    name: 'SqlJsDriver',
    create: async () => {
      const SQL = await initSqlJs();
      return new SqlJsDriver(new SQL.Database() as never);
    },
  },
];

for (const d of DRIVERS) {
  describe(`schema migrations — ${d.name}`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = await d.create();
    });

    afterEach(() => {
      try {
        driver.close();
      } catch {
        /* already closed */
      }
    });

    it('brings a fresh database to the latest version, running every migration', () => {
      initializeSchema(driver);

      expect(schemaMigrationVersion(driver)).toBe(LATEST_MEMORY_MIGRATION);
      const rows = migrationRows(driver);
      expect(rows.map((r) => Number(r.id))).toEqual(
        Array.from({ length: LATEST_MEMORY_MIGRATION }, (_, i) => i + 1),
      );
      expect(rows.every((r) => Number(r.baseline) === 0)).toBe(true);
      expect(rows.every((r) => String(r.description).length > 0)).toBe(true);
      for (const t of ['memory_entries', 'memory_embeddings', 'memory_entry_tags', 'agent_reads']) {
        expect(tableExists(driver, t)).toBe(true);
      }
      // Older releases gate their repairs on this stamp; it must keep being written.
      expect(userVersion(driver)).toBe(SCHEMA_VERSION);
    });

    it('adopts a database built by the old code path as a baseline, changing nothing', () => {
      buildV4Fixture(driver);
      const before = snapshot(driver);
      const seen: string[] = [];
      const exec = driver.exec.bind(driver);
      driver.exec = (sql: string) => {
        seen.push(sql);
        exec(sql);
      };

      initializeSchema(driver);

      expect(snapshot(driver)).toEqual(before);
      expect(before.rows.memory_entries).toHaveLength(3);
      expect(before.rows.memory_embeddings).toHaveLength(3);
      expect(before.rows.memory_entry_tags).toHaveLength(3);
      expect(before.rows.agent_reads).toHaveLength(1);
      // No full-table repair ran against the adopted store.
      expect(seen.some((s) => s.includes('ROW_NUMBER()'))).toBe(false);
      expect(seen.some((s) => s.includes('MAX(rowid)'))).toBe(false);
      const rows = migrationRows(driver);
      expect(rows.map((r) => Number(r.id))).toEqual(
        Array.from({ length: LATEST_MEMORY_MIGRATION }, (_, i) => i + 1),
      );
      expect(rows.every((r) => Number(r.baseline) === 1)).toBe(true);
      expect(userVersion(driver)).toBe(SCHEMA_VERSION);
    });

    it('is a no-op when run a second time', () => {
      buildV4Fixture(driver);
      initializeSchema(driver);
      const before = snapshot(driver);
      const recorded = migrationRows(driver).map((r) => ({ ...r }));

      initializeSchema(driver);
      expect(snapshot(driver)).toEqual(before);
      expect(migrationRows(driver).map((r) => ({ ...r }))).toEqual(recorded);
    });

    it('refuses a database written by a newer version, without touching it', () => {
      initializeSchema(driver);
      driver.run(
        "INSERT INTO schema_migrations (id, description, applied_at, baseline) VALUES (?, 'from the future', 1, 0)",
        [LATEST_MEMORY_MIGRATION + 1],
      );
      const before = snapshot(driver);

      let caught: unknown;
      try {
        initializeSchema(driver);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SchemaTooNewError);
      expect((caught as SchemaTooNewError).code).toBe('MEMORY_SCHEMA_TOO_NEW');
      expect((caught as Error).message).toMatch(
        new RegExp(
          `version ${LATEST_MEMORY_MIGRATION + 1}.*supports up to ${LATEST_MEMORY_MIGRATION}`,
        ),
      );
      expect(snapshot(driver)).toEqual(before);
    });

    it('rolls a failing migration back and keeps the ones before it', () => {
      const migrations: SchemaMigration[] = [
        { id: 1, description: 'create a', up: (db) => db.exec('CREATE TABLE a (x INTEGER)') },
        {
          id: 2,
          description: 'create b, then fail',
          up: (db) => {
            db.exec('CREATE TABLE b (x INTEGER)');
            db.run('INSERT INTO b (x) VALUES (1)');
            throw new Error('boom');
          },
        },
      ];

      expect(() => runMigrations(driver, migrations)).toThrow(/boom/);
      expect(tableExists(driver, 'a')).toBe(true);
      expect(tableExists(driver, 'b')).toBe(false);
      expect(schemaMigrationVersion(driver)).toBe(1);

      // Fixing the migration lets the next run pick up where it stopped.
      migrations[1] = {
        id: 2,
        description: 'create b',
        up: (db) => db.exec('CREATE TABLE b (x INTEGER)'),
      };
      const report = runMigrations(driver, migrations);
      expect(report).toMatchObject({ from: 1, to: 2, applied: [2], baselined: [] });
      expect(tableExists(driver, 'b')).toBe(true);
    });

    it('rejects a migration list whose ids are not 1..n in order', () => {
      const up = () => {};
      expect(() =>
        runMigrations(driver, [
          { id: 1, description: 'one', up },
          { id: 3, description: 'three', up },
        ]),
      ).toThrow(/ids must be 1\.\.n/);
    });
  });
}

describe('SQLiteBackend on an existing on-disk store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-migrations-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFixture(file: string, extra?: (driver: SqlDriver) => void): void {
    const driver = new BetterSqliteDriver(new Database(file) as never);
    buildV4Fixture(driver);
    extra?.(driver);
    driver.close();
  }

  it('opens a store written by the old code and reads every entry back', async () => {
    const file = join(dir, 'memory.db');
    writeFixture(file);

    const backend = new SQLiteBackend({ databasePath: file, walMode: false });
    await backend.initialize();
    try {
      expect(await backend.count()).toBe(3);
      expect((await backend.getByKey('ns', 'beta'))?.content).toBe('content of beta');
    } finally {
      await backend.shutdown();
    }
  });

  it('refuses to open a store from a newer version', async () => {
    const file = join(dir, 'memory.db');
    writeFixture(file, (driver) => {
      initializeSchema(driver);
      driver.run(
        "INSERT INTO schema_migrations (id, description, applied_at, baseline) VALUES (?, 'future', 1, 0)",
        [LATEST_MEMORY_MIGRATION + 5],
      );
    });

    const backend = new SQLiteBackend({ databasePath: file, walMode: false });
    await expect(backend.initialize()).rejects.toMatchObject({ code: 'MEMORY_SCHEMA_TOO_NEW' });
  });
});
