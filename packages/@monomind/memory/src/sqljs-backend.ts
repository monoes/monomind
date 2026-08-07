/**
 * sql.js (WASM) Memory Backend
 *
 * A thin driver-selecting wrapper around SqlBackend, which holds all the
 * behaviour. This file previously carried its own ~845-line IMemoryBackend
 * implementation parallel to sqlite-backend.ts; the two drifted into different
 * schemas and different query semantics (tag filtering was ANY-match on one and
 * ALL-match on the other for the same call). See sql-backend.ts.
 *
 * Two things remain genuinely specific to this driver and live here:
 *   - WASM loading, preferring the copy in node_modules over the CDN.
 *   - Durability. sql.js is in-memory, so the database must be exported to
 *     disk explicitly — on an interval and at shutdown.
 *
 * Databases written by the pre-unification version stored embeddings inline on
 * memory_entries. They are migrated into memory_embeddings on first open; the
 * migration copies rather than moves and is idempotent (see sql-schema.ts).
 *
 * The class name and config shape are unchanged — this is the published API.
 *
 * @module v1/memory/sqljs-backend
 */

import initSqlJs from 'sql.js';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SqlBackend } from './sql-backend.js';
import { SqlJsDriver, type SqlDriver } from './sql-driver.js';
import { writeFileAtomicSync } from './atomic-file.js';
import type { EmbeddingGenerator } from './types.js';

/**
 * Configuration for the sql.js backend
 */
export interface SqlJsBackendConfig {
  /** Path to SQLite database file (:memory: for in-memory) */
  databasePath: string;

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

  /** Auto-persist interval in milliseconds (0 = manual only) */
  autoPersistInterval: number;

  /** Explicit path to sql-wasm.wasm, overriding local resolution */
  wasmPath?: string;

  /** SQLite busy timeout in milliseconds. Passed through to the driver's pragma
   *  for parity with SQLiteBackend; largely a no-op for the in-memory sql.js
   *  engine, but applied when the database file is shared. Default: 0. */
  busyTimeoutMs: number;
}

/**
 * Resolve the WASM binary shipped inside node_modules.
 *
 * Fetching from the sql.js CDN is a silent network dependency in what should be
 * a normal npm install, and is undesirable in offline/air-gapped environments —
 * the same environments most likely to need this fallback, since it only kicks
 * in when native better-sqlite3 fails. Returns null if local resolution fails,
 * so the caller can fall back to the CDN as a last resort.
 */
function resolveLocalWasmPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve('sql.js/dist/sql-wasm.wasm');
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG: SqlJsBackendConfig = {
  databasePath: ':memory:',
  optimize: true,
  defaultNamespace: 'default',
  maxEntries: 1000000,
  verbose: false,
  autoPersistInterval: 5000,
  busyTimeoutMs: 0,
};

export class SqlJsBackend extends SqlBackend {
  private sqlJsConfig: SqlJsBackendConfig;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<SqlJsBackendConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    super({
      defaultNamespace: merged.defaultNamespace,
      embeddingGenerator: merged.embeddingGenerator,
      maxEntries: merged.maxEntries,
      verbose: merged.verbose,
    });
    this.sqlJsConfig = merged;
  }

  protected async openDriver(): Promise<SqlDriver> {
    const localWasmPath = this.sqlJsConfig.wasmPath ?? resolveLocalWasmPath() ?? undefined;
    const SQL = await initSqlJs({
      locateFile: localWasmPath ? () => localWasmPath : (file) => `https://sql.js.org/dist/${file}`,
    });

    const path = this.sqlJsConfig.databasePath;
    const isMemory = path === ':memory:';

    const db =
      !isMemory && existsSync(path)
        ? new SQL.Database(new Uint8Array(readFileSync(path)))
        : new SQL.Database();

    if (this.sqlJsConfig.verbose) {
      console.log(
        !isMemory && existsSync(path)
          ? `[SqlJsBackend] Loaded database from ${path}`
          : '[SqlJsBackend] Created new in-memory database',
      );
    }

    // Only give the driver a flush function when there is somewhere to flush to.
    const flush = isMemory
      ? undefined
      : async (bytes: Uint8Array) => {
          const buffer = Buffer.from(bytes);
          writeFileAtomicSync(path, buffer);
          if (this.sqlJsConfig.verbose) {
            console.log(`[SqlJsBackend] Persisted ${buffer.length} bytes to ${path}`);
          }
          this.emit('persisted', { size: buffer.length, path });
        };

    return new SqlJsDriver(db as never, flush);
  }

  async initialize(): Promise<void> {
    await super.initialize();

    if (this.sqlJsConfig.autoPersistInterval > 0 && this.sqlJsConfig.databasePath !== ':memory:') {
      this.persistTimer = setInterval(() => {
        this.persist().catch((error) => this.emit('error', { operation: 'auto-persist', error }));
      }, this.sqlJsConfig.autoPersistInterval);
      // Do not hold the event loop open purely for periodic persistence.
      if (this.persistTimer.unref) this.persistTimer.unref();
    }
  }

  async shutdown(): Promise<void> {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    // SqlBackend.shutdown() persists before closing.
    await super.shutdown();
  }
}

export default SqlJsBackend;
