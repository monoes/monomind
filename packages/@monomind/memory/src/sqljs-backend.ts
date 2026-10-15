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

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import initSqlJs from 'sql.js';
import { writeFileAtomicSync } from './atomic-file.js';
import { SqlBackend } from './sql-backend.js';
import { type SqlDriver, SqlJsDriver } from './sql-driver.js';
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

/** Identity of the file's current contents (inode changes on every atomic rename). */
function fileSignature(path: string): string | null {
  try {
    const st = statSync(path);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

function unsafeDatabase(path: string, reason: string): Error {
  return Object.assign(
    new Error(
      `SqlJsBackend cannot safely open ${path}: ${reason}. Opening it with sql.js would lose ` +
        'data written by the native backend; install better-sqlite3 (or rebuild it) instead.',
    ),
    { code: 'SQLJS_UNSAFE_DATABASE' },
  );
}

/** sql.js ignores the write-ahead log, so frames still in it would be lost or overwritten. */
function assertNoWalSidecar(path: string): void {
  try {
    if (statSync(`${path}-wal`).size > 0)
      throw unsafeDatabase(path, 'a non-empty -wal file exists');
  } catch (error) {
    if ((error as { code?: string }).code === 'SQLJS_UNSAFE_DATABASE') throw error;
  }
}

/** Header bytes 18-19 (file format write/read version) are 2 for a WAL-mode database. */
function assertHeaderNotWal(path: string, bytes: Uint8Array): void {
  if (bytes.length > 19 && (bytes[18] === 2 || bytes[19] === 2)) {
    throw unsafeDatabase(path, 'it is in WAL journal mode');
  }
}

/** The sql.js build has no FTS5, so writes to a database with an FTS5 index fail midway. */
function assertNoFts5Index(
  path: string,
  db: { exec(sql: string): unknown[]; close(): void },
): void {
  const found = db.exec("SELECT 1 FROM sqlite_master WHERE name = 'memory_entries_fts'");
  if (found.length > 0) {
    db.close();
    throw unsafeDatabase(path, 'it has an FTS5 index that sql.js cannot maintain');
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

  /**
   * Report a background persistence failure without turning an operational
   * problem such as ENOSPC into an unhandled EventEmitter `error` event.
   * Consumers that need to react can install a normal `error` listener; in
   * its absence, the failed write remains non-fatal and the next interval can
   * retry it. Explicit `persist()` calls still reject to their caller.
   */
  private reportAutoPersistError(error: unknown): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', { operation: 'auto-persist', error });
    } else if (this.sqlJsConfig.verbose) {
      console.error('[SqlJsBackend] Auto-persist failed; will retry on the next interval', error);
    }
  }

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
    const existed = !isMemory && existsSync(path);

    // Signature of the file as loaded; the flush below refuses to overwrite a file
    // that no longer matches it. Taken before the read so a change in between shows.
    let loadedSignature = existed ? fileSignature(path) : null;
    if (existed) assertNoWalSidecar(path);
    const bytes = existed ? new Uint8Array(readFileSync(path)) : null;
    if (bytes) assertHeaderNotWal(path, bytes);

    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    if (bytes) assertNoFts5Index(path, db);

    if (this.sqlJsConfig.verbose) {
      console.log(
        existed
          ? `[SqlJsBackend] Loaded database from ${path}`
          : '[SqlJsBackend] Created new in-memory database',
      );
    }

    // Only give the driver a flush function when there is somewhere to flush to.
    const flush = isMemory
      ? undefined
      : async (out: Uint8Array) => {
          if (fileSignature(path) !== loadedSignature) {
            throw Object.assign(
              new Error(
                `${path} changed on disk since this process loaded it; refusing to overwrite ` +
                  "another process's writes with a stale snapshot",
              ),
              { code: 'SQLJS_STALE_SNAPSHOT' },
            );
          }
          const buffer = Buffer.from(out);
          writeFileAtomicSync(path, buffer);
          loadedSignature = fileSignature(path);
          if (this.sqlJsConfig.verbose) {
            console.log(`[SqlJsBackend] Persisted ${buffer.length} bytes to ${path}`);
          }
          this.emit('persisted', { size: buffer.length, path });
        };

    return new SqlJsDriver(db as never, flush, existed);
  }

  protected getAnnCacheDir(): string | null {
    return this.sqlJsConfig.databasePath === ':memory:'
      ? null
      : dirname(this.sqlJsConfig.databasePath);
  }

  async initialize(): Promise<void> {
    await super.initialize();

    if (this.sqlJsConfig.autoPersistInterval > 0 && this.sqlJsConfig.databasePath !== ':memory:') {
      this.persistTimer = setInterval(() => {
        this.persist().catch((error: unknown) => this.reportAutoPersistError(error));
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
