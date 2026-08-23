/**
 * Schema + legacy-migration tests, run against BOTH drivers.
 *
 * The unification adopted the 4-table native schema as canonical. Existing
 * sql.js databases stored embeddings inline on memory_entries, so they need
 * migrating — against real user data, on the fallback path used by machines
 * where better-sqlite3 could not build. That is the least forgiving place to
 * get a migration wrong, so the properties below are pinned explicitly:
 * nothing is destroyed, re-running is safe, and a partial run can be resumed.
 */

import Database from 'better-sqlite3';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BetterSqliteDriver, type SqlDriver, SqlJsDriver } from './sql-driver.js';
import {
  createCanonicalSchema,
  hasLegacyInlineEmbedding,
  initializeSchema,
  migrateLegacyInlineEmbeddings,
} from './sql-schema.js';

/** The pre-unification sql.js schema: one table, embedding stored inline. */
const LEGACY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB,
    type TEXT NOT NULL,
    namespace TEXT NOT NULL,
    tags TEXT NOT NULL,
    metadata TEXT NOT NULL,
    owner_id TEXT,
    access_level TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER,
    event_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    "references" TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at INTEGER NOT NULL
  );
`;

function insertLegacyRow(driver: SqlDriver, id: string, embedding: Uint8Array | null) {
  driver.run(
    `INSERT INTO memory_entries
      (id, key, content, embedding, type, namespace, tags, metadata, owner_id,
       access_level, created_at, updated_at, expires_at, event_at, version,
       "references", access_count, last_accessed_at)
     VALUES (?, ?, ?, ?, 'semantic', 'ns', '[]', '{}', NULL, 'private',
             1, 1, NULL, NULL, 1, '[]', 0, 1)`,
    [id, `key-${id}`, `content ${id}`, embedding as never],
  );
}

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
  describe(`schema + migration — ${d.name}`, () => {
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

    it('creates the canonical four-table schema', () => {
      createCanonicalSchema(driver);
      const tables = driver
        .all("SELECT name FROM sqlite_master WHERE type='table'")
        .map((r) => String(r.name))
        .sort();
      expect(tables).toEqual(
        expect.arrayContaining([
          'agent_reads',
          'memory_embeddings',
          'memory_entries',
          'memory_entry_tags',
        ]),
      );
    });

    it('canonical memory_entries has no inline embedding column', () => {
      createCanonicalSchema(driver);
      expect(hasLegacyInlineEmbedding(driver)).toBe(false);
    });

    it('detects the legacy inline embedding column', () => {
      driver.exec(LEGACY_SCHEMA);
      expect(hasLegacyInlineEmbedding(driver)).toBe(true);
    });

    it('migrates inline embeddings into memory_embeddings, byte for byte', () => {
      driver.exec(LEGACY_SCHEMA);
      const vec = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]);
      insertLegacyRow(driver, 'a', vec);
      createCanonicalSchema(driver);

      const report = migrateLegacyInlineEmbeddings(driver);
      expect(report.legacyColumnFound).toBe(true);
      expect(report.migrated).toBe(1);

      const row = driver.get('SELECT embedding FROM memory_embeddings WHERE entry_id = ?', ['a']);
      expect(row).not.toBeNull();
      expect(Array.from(row?.embedding as Uint8Array)).toEqual(Array.from(vec));
    });

    it('does not fabricate embeddings for rows that had none', () => {
      driver.exec(LEGACY_SCHEMA);
      insertLegacyRow(driver, 'a', null);
      createCanonicalSchema(driver);

      const report = migrateLegacyInlineEmbeddings(driver);
      expect(report.migrated).toBe(0);
      expect(
        driver.get('SELECT entry_id FROM memory_embeddings WHERE entry_id = ?', ['a']),
      ).toBeNull();
    });

    it('preserves the legacy column — migration copies, never destroys', () => {
      driver.exec(LEGACY_SCHEMA);
      const vec = new Uint8Array([9, 8, 7]);
      insertLegacyRow(driver, 'a', vec);
      createCanonicalSchema(driver);
      migrateLegacyInlineEmbeddings(driver);

      const original = driver.get('SELECT embedding FROM memory_entries WHERE id = ?', ['a']);
      expect(Array.from(original?.embedding as Uint8Array)).toEqual(Array.from(vec));
    });

    it('is idempotent — a second run migrates nothing and changes nothing', () => {
      driver.exec(LEGACY_SCHEMA);
      insertLegacyRow(driver, 'a', new Uint8Array([1, 2, 3]));
      createCanonicalSchema(driver);

      const first = migrateLegacyInlineEmbeddings(driver);
      const second = migrateLegacyInlineEmbeddings(driver);

      expect(first.migrated).toBe(1);
      expect(second.migrated).toBe(0);
      expect(second.skipped).toBe(1);
      expect(driver.all('SELECT entry_id FROM memory_embeddings')).toHaveLength(1);
    });

    it('resumes a partially-completed migration without duplicating', () => {
      driver.exec(LEGACY_SCHEMA);
      insertLegacyRow(driver, 'a', new Uint8Array([1]));
      insertLegacyRow(driver, 'b', new Uint8Array([2]));
      createCanonicalSchema(driver);

      // Simulate a crash after the first row was written.
      driver.run('INSERT INTO memory_embeddings (entry_id, embedding) VALUES (?, ?)', [
        'a',
        new Uint8Array([1]) as never,
      ]);

      const report = migrateLegacyInlineEmbeddings(driver);
      expect(report.skipped).toBe(1);
      expect(report.migrated).toBe(1);
      expect(driver.all('SELECT entry_id FROM memory_embeddings')).toHaveLength(2);
    });

    it('is a no-op on an already-canonical database', () => {
      createCanonicalSchema(driver);
      const report = migrateLegacyInlineEmbeddings(driver);
      expect(report).toEqual({ legacyColumnFound: false, migrated: 0, skipped: 0 });
    });

    it('initializeSchema runs the whole path and dedupes namespace+key', () => {
      driver.exec(LEGACY_SCHEMA);
      // Two rows sharing namespace+key — only the newest should survive.
      insertLegacyRow(driver, 'old', new Uint8Array([1]));
      driver.run('UPDATE memory_entries SET key = ?, updated_at = ? WHERE id = ?', [
        'dup',
        1,
        'old',
      ]);
      insertLegacyRow(driver, 'new', new Uint8Array([2]));
      driver.run('UPDATE memory_entries SET key = ?, updated_at = ? WHERE id = ?', [
        'dup',
        99,
        'new',
      ]);

      initializeSchema(driver);

      const rows = driver.all('SELECT id FROM memory_entries WHERE key = ?', ['dup']);
      expect(rows).toHaveLength(1);
      expect(String(rows[0].id)).toBe('new');
    });
  });
}

describe('driver behaviour parity', () => {
  for (const d of DRIVERS) {
    it(`${d.name}: get() returns null for no match rather than a phantom row`, async () => {
      const driver = await d.create();
      createCanonicalSchema(driver);
      expect(driver.get('SELECT * FROM memory_entries WHERE id = ?', ['nope'])).toBeNull();
      driver.close();
    });

    it(`${d.name}: transaction rolls back on throw`, async () => {
      const driver = await d.create();
      createCanonicalSchema(driver);
      expect(() =>
        driver.transaction(() => {
          driver.run(
            `INSERT INTO memory_entries (id,key,content,type,namespace,tags,metadata,owner_id,
             access_level,created_at,updated_at,expires_at,event_at,version,"references",
             access_count,last_accessed_at)
             VALUES ('t','k','c','semantic','ns','[]','{}',NULL,'private',1,1,NULL,NULL,1,'[]',0,1)`,
          );
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(driver.get('SELECT id FROM memory_entries WHERE id = ?', ['t'])).toBeNull();
      driver.close();
    });

    it(`${d.name}: iterate() yields every row`, async () => {
      const driver = await d.create();
      createCanonicalSchema(driver);
      for (const id of ['a', 'b', 'c']) {
        driver.run(
          `INSERT INTO memory_entries (id,key,content,type,namespace,tags,metadata,owner_id,
           access_level,created_at,updated_at,expires_at,event_at,version,"references",
           access_count,last_accessed_at)
           VALUES (?,?,'c','semantic','ns','[]','{}',NULL,'private',1,1,NULL,NULL,1,'[]',0,1)`,
          [id, `k-${id}`],
        );
      }
      const seen = [...driver.iterate('SELECT id FROM memory_entries ORDER BY id')].map((r) =>
        String(r.id),
      );
      expect(seen).toEqual(['a', 'b', 'c']);
      driver.close();
    });
  }
});
