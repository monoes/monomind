/**
 * SQLite Memory Backend (better-sqlite3)
 *
 * A thin driver-selecting wrapper around SqlBackend, which holds all the
 * behaviour. This file previously carried a full ~930-line IMemoryBackend
 * implementation that was near-duplicated in sqljs-backend.ts; the two drifted
 * into different schemas and different query semantics. See sql-backend.ts.
 *
 * The class name and config shape are unchanged — this is the published API.
 *
 * @module v1/memory/sqlite-backend
 */

import Database from 'better-sqlite3';
import { SqlBackend } from './sql-backend.js';
import { BetterSqliteDriver, type SqlDriver } from './sql-driver.js';
import type { EmbeddingGenerator } from './types.js';

/**
 * Configuration for SQLite Backend
 */
export interface SQLiteBackendConfig {
  /** Path to SQLite database file (:memory: for in-memory) */
  databasePath: string;

  /** Enable WAL mode for better concurrency */
  walMode: boolean;

  /** Enable query optimization */
  optimize: boolean;

  /** Default namespace */
  defaultNamespace: string;

  /** Embedding generator (for compatibility with hybrid mode) */
  embeddingGenerator?: EmbeddingGenerator;

  /** Maximum entries before auto-cleanup */
  maxEntries: number;

  /** Enable verbose logging */
  verbose: boolean;
}

const DEFAULT_CONFIG: SQLiteBackendConfig = {
  databasePath: ':memory:',
  walMode: true,
  optimize: true,
  defaultNamespace: 'default',
  maxEntries: 1000000,
  verbose: false,
};

/**
 * SQLite backend for structured memory storage.
 *
 * Provides ACID transactions, indexed lookups, and persistent storage with
 * WAL mode. Behaviour lives in SqlBackend; this class supplies the driver.
 */
export class SQLiteBackend extends SqlBackend {
  private sqliteConfig: SQLiteBackendConfig;

  constructor(config: Partial<SQLiteBackendConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    super({
      defaultNamespace: merged.defaultNamespace,
      embeddingGenerator: merged.embeddingGenerator,
      maxEntries: merged.maxEntries,
      verbose: merged.verbose,
    });
    this.sqliteConfig = merged;
  }

  protected async openDriver(): Promise<SqlDriver> {
    const db = new Database(this.sqliteConfig.databasePath, {
      verbose: this.sqliteConfig.verbose ? console.log : undefined,
    });

    if (this.sqliteConfig.walMode) db.pragma('journal_mode = WAL');
    if (this.sqliteConfig.optimize) {
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = 10000');
      db.pragma('temp_store = MEMORY');
    }

    return new BetterSqliteDriver(db as never);
  }
}

export default SQLiteBackend;
