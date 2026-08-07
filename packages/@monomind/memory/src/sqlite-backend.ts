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

// better-sqlite3 is an OPTIONAL dependency — sql.js is the documented fallback,
// and database-provider.ts recommends it outright on Windows, where node-gyp
// routinely fails to build native modules. This import must therefore be lazy.
//
// It used to be a static top-level import, and because index.ts re-exports
// SQLiteBackend, that made `import '@monoes/memory'` throw
// ERR_MODULE_NOT_FOUND for anyone without better-sqlite3 — the whole package,
// including the pure-WASM sql.js path, was unusable in exactly the situation
// the fallback exists for. Local test suites never caught it because
// better-sqlite3 is always installed here.
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

  /** SQLite busy timeout in milliseconds. When another connection holds a lock,
   *  SQLite will wait up to this long before returning SQLITE_BUSY. Default: 0
   *  (fail immediately). Callers sharing a database across processes (e.g. CLI
   *  hooks and the MCP server hitting the same memory.db) should set this to
   *  several seconds (e.g. 5000). */
  busyTimeoutMs: number;
}

const DEFAULT_CONFIG: SQLiteBackendConfig = {
  databasePath: ':memory:',
  walMode: true,
  optimize: true,
  defaultNamespace: 'default',
  maxEntries: 1000000,
  verbose: false,
  busyTimeoutMs: 0,
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
    // better-sqlite3 is an `export =` CJS module, so the constructor arrives on
    // `.default` at runtime while its type namespace has no `default` member —
    // hence the cast, matching what migration.ts already does.
    // Only the surface this method actually touches; the driver takes it from here.
    type NativeDb = { pragma(statement: string): unknown };
    let Database: new (path: string, options?: Record<string, unknown>) => NativeDb;
    try {
      const mod = await import('better-sqlite3');
      Database = (mod as unknown as { default: typeof Database }).default;
    } catch (error) {
      // Reaching here means this backend was chosen explicitly while the native
      // module is unavailable. Say so, instead of surfacing a bare
      // ERR_MODULE_NOT_FOUND from deep inside the driver.
      throw new Error(
        'SQLiteBackend requires the optional dependency better-sqlite3, which is not installed ' +
        `(${(error as Error).message}). Use SqlJsBackend, or select the 'sql.js' provider, ` +
        'for environments where the native module cannot be built.',
      );
    }

    const db = new Database(this.sqliteConfig.databasePath, {
      verbose: this.sqliteConfig.verbose ? console.log : undefined,
    });

    if (this.sqliteConfig.busyTimeoutMs > 0) db.pragma(`busy_timeout = ${this.sqliteConfig.busyTimeoutMs}`);
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
