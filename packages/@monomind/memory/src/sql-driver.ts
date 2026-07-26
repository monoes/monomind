/**
 * SQL driver abstraction over better-sqlite3 (native) and sql.js (WASM).
 *
 * Why this exists: SQLiteBackend and SqlJsBackend implemented the same
 * IMemoryBackend contract twice — ~1,780 lines of near-parallel logic — because
 * the two drivers expose incompatible APIs. They then drifted, and the drift was
 * silent: `query({tags})` returned ANY-match on one and ALL-match on the other,
 * so the same call gave different answers depending on which driver happened to
 * load (see backend-conformance.test.ts). This adapter exists so there is one
 * implementation of the logic and only the driver plumbing differs.
 *
 * The APIs really are different, which is why the abstraction is not a thin
 * shim:
 *
 *   better-sqlite3   prepare().run/get/all/iterate, exec, pragma, transaction
 *   sql.js           prepare() + bind/step/getAsObject/free, run, exec, export
 *
 * Notable asymmetries handled here:
 *   - sql.js has no cursor: `iterate` is emulated by stepping a statement.
 *   - sql.js has no native transaction wrapper: emulated with BEGIN/COMMIT/
 *     ROLLBACK, which is what better-sqlite3's .transaction() does internally.
 *   - sql.js is in-memory; durability requires an explicit export to disk.
 *     `persist()` is a no-op on better-sqlite3, which writes through.
 *   - PRAGMAs are meaningful only on better-sqlite3; ignored on sql.js.
 *
 * Rows are returned as plain objects keyed by column name, matching
 * better-sqlite3's default and sql.js's getAsObject().
 */

export type SqlParam = string | number | null | Uint8Array | Buffer;
export type SqlRow = Record<string, unknown>;

export interface SqlDriver {
  /**
   * Execute a statement for effect, returning the number of rows changed.
   *
   * The drivers report this differently — better-sqlite3 returns
   * `{ changes }` from run(), sql.js requires a separate getRowsModified()
   * call — and callers genuinely need it (delete() reports whether anything
   * was actually removed), so it is normalised here.
   */
  run(sql: string, params?: SqlParam[]): number;
  /** First row, or null when the query matched nothing. */
  get(sql: string, params?: SqlParam[]): SqlRow | null;
  /** All matching rows. */
  all(sql: string, params?: SqlParam[]): SqlRow[];
  /** Stream rows. On sql.js this steps a statement rather than using a cursor. */
  iterate(sql: string, params?: SqlParam[]): Iterable<SqlRow>;
  /** Run one or more statements (DDL). */
  exec(sql: string): void;
  /** Run fn inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => T): T;
  /** Read a pragma value. Returns undefined where pragmas are unsupported. */
  pragma(statement: string): unknown;
  /** Flush to disk. No-op for write-through drivers. */
  persist(): Promise<void>;
  close(): void;
  /** Driver identity, for diagnostics and capability decisions. */
  readonly kind: 'better-sqlite3' | 'sql.js';
}

// ---------------------------------------------------------------------------
// better-sqlite3
// ---------------------------------------------------------------------------

interface BetterSqliteDb {
  prepare(sql: string): {
    run(...p: unknown[]): { changes: number };
    get(...p: unknown[]): unknown;
    all(...p: unknown[]): unknown[];
    iterate(...p: unknown[]): Iterable<unknown>;
  };
  exec(sql: string): unknown;
  pragma(statement: string, opts?: { simple?: boolean }): unknown;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
}

export class BetterSqliteDriver implements SqlDriver {
  readonly kind = 'better-sqlite3' as const;

  /**
   * Prepared-statement cache keyed by SQL text.
   *
   * The backend this replaced pre-compiled its hot statements in initialize()
   * specifically to avoid re-preparing per row ("N+1 re-prepare"). Routing
   * everything through the driver would have silently reintroduced that cost
   * in loops like bulkInsert and per-row embedding reads, so the optimisation
   * moves here where it applies to every query rather than a hand-picked few.
   */
  private stmtCache = new Map<string, ReturnType<BetterSqliteDb['prepare']>>();

  constructor(private db: BetterSqliteDb) {}

  private stmt(sql: string) {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  run(sql: string, params: SqlParam[] = []): number {
    return this.stmt(sql).run(...params).changes ?? 0;
  }

  get(sql: string, params: SqlParam[] = []): SqlRow | null {
    return (this.stmt(sql).get(...params) as SqlRow | undefined) ?? null;
  }

  all(sql: string, params: SqlParam[] = []): SqlRow[] {
    return this.stmt(sql).all(...params) as SqlRow[];
  }

  iterate(sql: string, params: SqlParam[] = []): Iterable<SqlRow> {
    return this.stmt(sql).iterate(...params) as Iterable<SqlRow>;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn as (...a: unknown[]) => T)();
  }

  pragma(statement: string): unknown {
    return this.db.pragma(statement, { simple: true });
  }

  async persist(): Promise<void> {
    // better-sqlite3 writes through to the file; nothing to flush.
  }

  close(): void {
    // Cached statements belong to the connection and die with it; clear the
    // map so a reused driver object cannot hand out finalized statements.
    this.stmtCache.clear();
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// sql.js
//
// Deliberately not statement-cached. sql.js statements carry bind/step cursor
// state and must be freed; caching them across calls risks leaking a
// half-stepped cursor into an unrelated query. This is the fallback path, where
// correctness matters more than shaving prepares.
// ---------------------------------------------------------------------------

interface SqlJsStatement {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlJsDb {
  prepare(sql: string): SqlJsStatement;
  run(sql: string, params?: unknown[]): unknown;
  exec(sql: string): unknown;
  export(): Uint8Array;
  getRowsModified(): number;
  close(): void;
}

export class SqlJsDriver implements SqlDriver {
  readonly kind = 'sql.js' as const;

  /**
   * @param db      the opened sql.js Database
   * @param flush   writes the exported bytes to durable storage; omitted for
   *                :memory: databases, where persistence is meaningless
   */
  constructor(
    private db: SqlJsDb,
    private flush?: (bytes: Uint8Array) => Promise<void>,
  ) {}

  run(sql: string, params: SqlParam[] = []): number {
    this.db.run(sql, params as unknown[]);
    // sql.js reports affected rows out-of-band rather than from run().
    return typeof this.db.getRowsModified === 'function' ? this.db.getRowsModified() : 0;
  }

  get(sql: string, params: SqlParam[] = []): SqlRow | null {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as unknown[]);
      // step() is the only reliable no-row signal: getAsObject() on a
      // statement that matched nothing returns an object keyed by column name
      // with every value undefined, not {}. Checking Object.keys().length
      // therefore passes it straight through, and callers then die on
      // JSON.parse(undefined) — a real bug this replaced.
      if (!stmt.step()) return null;
      return stmt.getAsObject();
    } finally {
      stmt.free();
    }
  }

  all(sql: string, params: SqlParam[] = []): SqlRow[] {
    const stmt = this.db.prepare(sql);
    const rows: SqlRow[] = [];
    try {
      stmt.bind(params as unknown[]);
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }

  iterate(sql: string, params: SqlParam[] = []): Iterable<SqlRow> {
    // sql.js exposes no cursor. Materialising would defeat the point of
    // iterate() for large tables, so step lazily and free the statement when
    // the consumer stops — including on early `break`, which triggers the
    // generator's return path.
    const db = this.db;
    return {
      *[Symbol.iterator](): Iterator<SqlRow> {
        const stmt = db.prepare(sql);
        try {
          stmt.bind(params as unknown[]);
          while (stmt.step()) yield stmt.getAsObject();
        } finally {
          stmt.free();
        }
      },
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    // sql.js has no transaction wrapper; emulate what better-sqlite3 does.
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.run('ROLLBACK');
      } catch {
        /* rollback of an already-aborted transaction is not itself an error */
      }
      throw err;
    }
  }

  pragma(_statement: string): unknown {
    // PRAGMAs (journal_mode, synchronous, cache_size…) tune the native engine
    // and have no meaning for the WASM build.
    return undefined;
  }

  async persist(): Promise<void> {
    if (!this.flush) return; // :memory: — nothing durable to write
    await this.flush(this.db.export());
  }

  close(): void {
    this.db.close();
  }
}
