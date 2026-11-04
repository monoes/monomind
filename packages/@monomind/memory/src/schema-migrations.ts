/**
 * Versioned schema migrations for the memory SQLite store.
 *
 * Dependency-free and driver-agnostic: it only uses the SqlDriver contract, so
 * it runs the same on better-sqlite3 and sql.js.
 *
 * Applied migrations are recorded in a `schema_migrations` table rather than
 * in `PRAGMA user_version`. The pragma is already taken: releases before this
 * runner stamp it with their own SCHEMA_VERSION on every open (overwriting a
 * higher value), and the global brain is opened by whichever monomind version
 * happens to run. A counter that an older install silently rewinds cannot
 * tell which migrations ran; a table that older code never touches can.
 *
 * Guarantees:
 *   - each migration runs in its own transaction, together with the row that
 *     records it, so a migration that throws leaves no trace and is retried
 *     on the next open;
 *   - already-recorded migrations are skipped, so re-running is a no-op;
 *   - a database that records a migration this build does not know was
 *     written by a newer release, and is refused before anything is written;
 *   - an untracked database the caller recognises as already being at some
 *     version is stamped with that baseline, without running its migrations.
 */

import type { SqlDriver } from './sql-driver.js';

export interface SchemaMigration {
  /** 1-based, contiguous, in the order the migrations run. Never renumber a shipped one. */
  readonly id: number;
  readonly description: string;
  /** Must be synchronous and must not open its own transaction (the runner holds one). */
  up(driver: SqlDriver): void;
}

export interface MigrationRunReport {
  /** Version recorded before this run, after any baseline stamp. */
  from: number;
  /** Version after this run. */
  to: number;
  /** Migrations whose `up` ran in this call. */
  applied: number[];
  /** Migrations recorded as a baseline in this call, without running `up`. */
  baselined: number[];
}

export interface RunMigrationsOptions {
  /**
   * Called only when the tracking table has no rows. Returns the version an
   * existing database is already at (0 for a fresh one); migrations up to it
   * are recorded as baseline instead of being run.
   */
  baseline?: (driver: SqlDriver) => number;
}

export class SchemaTooNewError extends Error {
  readonly code = 'MEMORY_SCHEMA_TOO_NEW';
  constructor(
    readonly databaseVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `memory database is at schema version ${databaseVersion}, but this @monoes/memory ` +
        `supports up to ${supportedVersion}. It was written by a newer monomind; upgrade ` +
        `monomind to use it. Refusing to open it so this older version cannot damage it.`,
    );
    this.name = 'SchemaTooNewError';
  }
}

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    baseline INTEGER NOT NULL DEFAULT 0
  )`;

const RECORD =
  'INSERT OR IGNORE INTO schema_migrations (id, description, applied_at, baseline) VALUES (?, ?, ?, ?)';

function hasTrackingTable(driver: SqlDriver): boolean {
  return (
    driver.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    ) !== null
  );
}

/** Highest recorded migration id; 0 for an untracked database. */
export function schemaMigrationVersion(driver: SqlDriver): number {
  if (!hasTrackingTable(driver)) return 0;
  return Number(driver.get('SELECT MAX(id) AS v FROM schema_migrations')?.v ?? 0) || 0;
}

function isRecorded(driver: SqlDriver, id: number): boolean {
  return driver.get('SELECT id FROM schema_migrations WHERE id = ?', [id]) !== null;
}

export function runMigrations(
  driver: SqlDriver,
  migrations: readonly SchemaMigration[],
  options: RunMigrationsOptions = {},
): MigrationRunReport {
  migrations.forEach((m, i) => {
    if (m.id !== i + 1)
      throw new Error(
        `schema migration ids must be 1..n in order; got ${m.id} at position ${i + 1}`,
      );
  });
  const latest = migrations.length;

  // Refuse before writing anything, the tracking table included.
  const recorded = schemaMigrationVersion(driver);
  if (recorded > latest) throw new SchemaTooNewError(recorded, latest);

  driver.exec(CREATE_TRACKING_TABLE);
  const report: MigrationRunReport = { from: recorded, to: recorded, applied: [], baselined: [] };

  if (recorded === 0 && options.baseline) {
    const base = Math.min(Math.max(0, Math.floor(options.baseline(driver))), latest);
    if (base > 0) {
      const now = Date.now();
      driver.transaction(() => {
        for (const m of migrations.slice(0, base)) {
          if (driver.run(RECORD, [m.id, m.description, now, 1]) > 0) report.baselined.push(m.id);
        }
      });
      report.from = report.to = base;
    }
  }

  for (const m of migrations) {
    if (m.id <= report.to) continue;
    driver.transaction(() => {
      // Re-checked inside the transaction: another process may have applied it meanwhile.
      if (isRecorded(driver, m.id)) return;
      m.up(driver);
      driver.run(RECORD, [m.id, m.description, Date.now(), 0]);
      report.applied.push(m.id);
    });
    report.to = m.id;
  }
  return report;
}
