/**
 * Canonical memory schema, shared by both SQL drivers.
 *
 * Previously each backend declared its own schema and they diverged into two
 * different *designs*, not merely a subset relationship:
 *
 *   better-sqlite3   4 tables — memory_entries, memory_embeddings (FK CASCADE),
 *                    memory_entry_tags (indexed tag filtering), agent_reads
 *                    (collaborative promotion) — 11 indexes + 1 unique
 *   sql.js           1 table — memory_entries with an inline `embedding BLOB`
 *                    — 5 indexes + 1 unique
 *
 * So a user who fell back to WASM silently got a structurally different, less
 * capable store. The 4-table design is canonical here because it is the primary
 * path, supports indexed tag queries rather than post-query filtering in JS,
 * and is what the collaborative-promotion feature requires.
 *
 * Adopting it for sql.js means existing sql.js databases must be migrated:
 * their embeddings live in a column that no longer exists in the canonical
 * shape. `migrateLegacyInlineEmbeddings` below does that, and is deliberately
 * conservative — it copies before it drops, is idempotent, and leaves the
 * legacy column in place rather than rewriting the table.
 */

import type { SqlDriver } from './sql-driver.js';

/** Bumped when the canonical schema changes; stored in PRAGMA user_version. */
export const SCHEMA_VERSION = 3;

/**
 * Create the canonical schema. Safe to run repeatedly.
 *
 * `embedding BLOB` is intentionally absent from memory_entries — embeddings
 * live in memory_embeddings so a row can be read without loading its vector.
 */
export function createCanonicalSchema(driver: SqlDriver): void {
  driver.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_namespace ON memory_entries(namespace);
    CREATE INDEX IF NOT EXISTS idx_key ON memory_entries(key);
    CREATE INDEX IF NOT EXISTS idx_type ON memory_entries(type);
    CREATE INDEX IF NOT EXISTS idx_owner_id ON memory_entries(owner_id);
    CREATE INDEX IF NOT EXISTS idx_created_at ON memory_entries(created_at);
    CREATE INDEX IF NOT EXISTS idx_updated_at ON memory_entries(updated_at);
    CREATE INDEX IF NOT EXISTS idx_expires_at ON memory_entries(expires_at);

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      entry_id TEXT PRIMARY KEY,
      embedding BLOB,
      FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_entry_tags (
      entry_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (entry_id, tag),
      FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_entry_tag ON memory_entry_tags(tag, entry_id);

    CREATE TABLE IF NOT EXISTS agent_reads (
      entry_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      read_at INTEGER NOT NULL,
      UNIQUE(entry_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_reads_entry ON agent_reads(entry_id);
    CREATE INDEX IF NOT EXISTS idx_agent_reads_at ON agent_reads(read_at);
  `);
}

/**
 * Enforce UNIQUE(namespace, key).
 *
 * The sql.js schema always had it; the native one carried only a plain index,
 * so repeated stores under the same key accumulated duplicates and getByKey
 * returned an arbitrary winner. Existing databases may already hold duplicates,
 * so dedupe (keeping the newest) before creating the unique index.
 */
export function enforceNamespaceKeyUnique(driver: SqlDriver): void {
  try {
    driver.exec(`
      DELETE FROM memory_entries WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY namespace, key ORDER BY updated_at DESC, id DESC
          ) AS rn FROM memory_entries
        ) WHERE rn = 1
      );
      DROP INDEX IF EXISTS idx_namespace_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_namespace_key_unique
        ON memory_entries(namespace, key);
    `);
  } catch {
    // Very old SQLite builds lack window functions. Keep the plain index rather
    // than failing initialization — duplicate accumulation is the lesser evil.
    driver.exec('CREATE INDEX IF NOT EXISTS idx_namespace_key ON memory_entries(namespace, key)');
  }
}

/** True when memory_entries still carries the legacy inline embedding column. */
export function hasLegacyInlineEmbedding(driver: SqlDriver): boolean {
  try {
    const cols = driver.all('PRAGMA table_info(memory_entries)');
    return cols.some((c) => String(c.name) === 'embedding');
  } catch {
    return false;
  }
}

export interface MigrationReport {
  /** Whether a legacy inline-embedding column was present at all. */
  legacyColumnFound: boolean;
  /** Rows whose embedding was copied into memory_embeddings. */
  migrated: number;
  /** Rows already present in memory_embeddings and therefore left alone. */
  skipped: number;
}

/**
 * Move embeddings from the legacy inline `memory_entries.embedding` column into
 * `memory_embeddings`.
 *
 * Written defensively, because this runs against real user data on the fallback
 * path — the machines least able to recover from a bad migration:
 *
 *   - **Copy, never move.** The legacy column is left untouched. If anything
 *     downstream is wrong, the original bytes are still there.
 *   - **Idempotent.** `INSERT OR IGNORE` plus an explicit skip count means
 *     re-running changes nothing, so a crash mid-migration is recoverable by
 *     simply running again.
 *   - **Transactional.** Either every row moves or none does.
 *   - **Null-safe.** Rows with no embedding are not given an empty one.
 */
export function migrateLegacyInlineEmbeddings(driver: SqlDriver): MigrationReport {
  const report: MigrationReport = { legacyColumnFound: false, migrated: 0, skipped: 0 };

  if (!hasLegacyInlineEmbedding(driver)) return report;
  report.legacyColumnFound = true;

  driver.transaction(() => {
    const rows = driver.all(
      `SELECT e.id AS id, e.embedding AS embedding
         FROM memory_entries e
        WHERE e.embedding IS NOT NULL`,
    );

    for (const row of rows) {
      const id = String(row.id);
      const existing = driver.get('SELECT entry_id FROM memory_embeddings WHERE entry_id = ?', [
        id,
      ]);
      if (existing) {
        report.skipped++;
        continue;
      }
      driver.run('INSERT OR IGNORE INTO memory_embeddings (entry_id, embedding) VALUES (?, ?)', [
        id,
        row.embedding as Uint8Array,
      ]);
      report.migrated++;
    }
  });

  return report;
}

// ===== FTS5 Full-Text Search Index (Issue #66) =============================

/**
 * True when the FTS5 virtual table already exists.
 */
export function hasFTS5Table(driver: SqlDriver): boolean {
  try {
    const row = driver.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_entries_fts'",
    );
    return row !== null;
  } catch {
    return false;
  }
}

/**
 * Create FTS5 virtual table + sync triggers.  Idempotent and fail-safe:
 *
 *   - **FTS5 unavailable** (sql.js compiled without the extension, or very old
 *     SQLite): the CREATE VIRTUAL TABLE will throw; we catch and return false.
 *     Keyword search falls back to the existing JS scan — no data loss.
 *   - **Already exists**: nothing to do; triggers are IF NOT EXISTS.
 *   - **Existing data**: bulk-populated in a single INSERT … SELECT.
 *
 * The FTS5 table is standalone (not external-content) with an `entry_id`
 * column marked UNINDEXED so `MATCH` only considers `key` and `content`.
 * Triggers keep it in lock-step with the source table on every write.
 *
 * Returns true if the FTS5 table is usable after this call.
 */
export function createFTS5Index(driver: SqlDriver): boolean {
  const alreadyExists = hasFTS5Table(driver);

  if (!alreadyExists) {
    try {
      driver.exec(`
        CREATE VIRTUAL TABLE memory_entries_fts USING fts5(
          entry_id UNINDEXED,
          key,
          content,
          tokenize = 'porter unicode61'
        );
      `);
    } catch {
      // FTS5 extension not available on this build (common for sql.js WASM).
      return false;
    }

    try {
      // Populate from existing data.
      driver.exec(`
        INSERT INTO memory_entries_fts(entry_id, key, content)
          SELECT id, key, content FROM memory_entries;
      `);
    } catch {
      // Populate failed — drop the half-built FTS table so the next init
      // attempt gets a clean retry rather than a corrupt partial index.
      try {
        driver.exec('DROP TABLE IF EXISTS memory_entries_fts');
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  try {
    ensureFTS5Triggers(driver);
    if (alreadyExists) dedupeFTS5Rows(driver);
    return true;
  } catch {
    if (!alreadyExists) {
      try {
        driver.exec('DROP TABLE IF EXISTS memory_entries_fts');
      } catch {
        /* ignore */
      }
    }
    return false;
  }
}

/**
 * (Re)define the FTS5 sync triggers to the current, correct SQL — always,
 * even when the FTS5 table already existed (so a database created before a
 * trigger fix still gets it, not just brand-new ones). `DROP … IF EXISTS` +
 * `CREATE` rather than `CREATE … IF NOT EXISTS`: cheap (triggers hold no
 * data) and idempotent, and it is what makes a trigger DEFINITION change
 * actually reach an existing store instead of being silently skipped
 * forever because the table (not the trigger body) is what `createFTS5Index`
 * checks for existence.
 *
 * `memory_entries_fts_ai` deletes any pre-existing row for `NEW.id` before
 * inserting — not just an insert. `SqlBackend.store()`'s plain upsert writes
 * via `INSERT OR REPLACE`, whose internal conflict-resolution delete does
 * NOT reliably fire `memory_entries_fts_ad`'s `AFTER DELETE` trigger (an
 * `INSERT OR REPLACE` never really is an UPDATE statement, and empirically —
 * see the regression test — even `PRAGMA recursive_triggers = ON` does not
 * change this for the conflict-resolution delete specifically). Without the
 * self-heal here, updating an entry left its STALE fts row behind alongside
 * the new one: a search then returned the same entry id twice, once scored
 * against its old content and once against its current content — and
 * because the query term then appears in "most" of the (duplicated, near-
 * identical) matched rows, BM25's IDF degenerates toward zero, displaying
 * the correct, sole match at a misleadingly low score close to 0.00.
 * `memory_entries_fts_ai` fires reliably for `INSERT OR REPLACE` (its insert
 * half is a genuine top-level INSERT), which is what makes this the trigger
 * to make self-healing rather than trying to fix the DELETE side. */
function ensureFTS5Triggers(driver: SqlDriver): void {
  driver.exec(`
    DROP TRIGGER IF EXISTS memory_entries_fts_ai;
    CREATE TRIGGER memory_entries_fts_ai
    AFTER INSERT ON memory_entries BEGIN
      DELETE FROM memory_entries_fts WHERE entry_id = NEW.id;
      INSERT INTO memory_entries_fts(entry_id, key, content)
        VALUES (NEW.id, NEW.key, NEW.content);
    END;

    DROP TRIGGER IF EXISTS memory_entries_fts_ad;
    CREATE TRIGGER memory_entries_fts_ad
    AFTER DELETE ON memory_entries BEGIN
      DELETE FROM memory_entries_fts WHERE entry_id = OLD.id;
    END;

    DROP TRIGGER IF EXISTS memory_entries_fts_au;
    CREATE TRIGGER memory_entries_fts_au
    AFTER UPDATE OF key, content ON memory_entries BEGIN
      DELETE FROM memory_entries_fts WHERE entry_id = OLD.id;
      INSERT INTO memory_entries_fts(entry_id, key, content)
        VALUES (NEW.id, NEW.key, NEW.content);
    END;
  `);
}

/**
 * One-time repair for a database that already has the FTS5 table: remove any
 * duplicate rows the pre-fix `memory_entries_fts_ai` trigger left behind for
 * the same `entry_id` (fixing the trigger only stops NEW duplicates; it does
 * not retroactively clean up ones already written). Keeps the row with the
 * largest `rowid` per `entry_id` — FTS5 rowids are monotonically increasing
 * on insert, so that is the most-recently-written (current) content; run
 * every `initializeSchema()` call, so it is also a no-op once clean. */
function dedupeFTS5Rows(driver: SqlDriver): void {
  driver.exec(`
    DELETE FROM memory_entries_fts
    WHERE rowid NOT IN (SELECT MAX(rowid) FROM memory_entries_fts GROUP BY entry_id);
  `);
}

/**
 * Bring a database to the canonical schema: create tables, migrate legacy
 * inline embeddings, enforce uniqueness, build the FTS5 index, and record
 * the version.
 */
export function initializeSchema(driver: SqlDriver): MigrationReport {
  createCanonicalSchema(driver);
  const report = migrateLegacyInlineEmbeddings(driver);
  enforceNamespaceKeyUnique(driver);
  createFTS5Index(driver);
  try {
    driver.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } catch {
    /* pragma unsupported on this driver — version tracking is advisory */
  }
  return report;
}
