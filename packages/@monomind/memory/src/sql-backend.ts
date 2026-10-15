/**
 * Unified SQL memory backend.
 *
 * One IMemoryBackend implementation over a pluggable SqlDriver, replacing the
 * two near-parallel implementations (better-sqlite3 and sql.js) that together
 * ran to ~1,780 lines. They had already drifted in ways users could observe:
 * different schemas, different tag-filter semantics (ANY vs ALL for the same
 * call), tag validation on one and not the other, and a crash on the sql.js
 * side when reading a missing row. Sharing the logic removes that class of bug
 * rather than testing for it after the fact.
 *
 * Driver differences (cursors, transactions, persistence, pragmas) live in
 * sql-driver.ts; the canonical schema and the legacy-data migration live in
 * sql-schema.ts. This file contains only behaviour.
 *
 * File-size sweep: the class's method BODIES are grouped into sibling
 * modules — ANN/HNSW index management in sql-backend-ann.ts, the
 * store/update/delete family in sql-backend-writes.ts, the get/query/search
 * family in sql-backend-reads.ts, and stats/health/persist in
 * sql-backend-introspect.ts. Each stays a real method here (same signature,
 * same visibility) so callers and TypeScript see no difference; the method
 * body is just `return theSiblingImpl.call(this, ...args)`. Fields those
 * bodies read/write moved from `private` to `protected` (compile-time only;
 * no runtime change) — TypeScript allows a standalone function typed
 * `this: SqlBackend` to reach `protected` members but not `private` ones, so
 * `protected` is the minimum visibility the split needs.
 *
 * @module v1/memory/sql-backend
 */

import { EventEmitter } from 'node:events';
import type { HNSWIndex } from './hnsw-index.js';
import { sqlBackendAnnMethods } from './sql-backend-ann.js';
import { sqlBackendIntrospectMethods } from './sql-backend-introspect.js';
import { sqlBackendReadMethods } from './sql-backend-reads.js';
import { sqlBackendWriteMethods } from './sql-backend-writes.js';
import type { SqlDriver } from './sql-driver.js';
import { hasFTS5Table, initializeSchema, type MigrationReport } from './sql-schema.js';
import type {
  BackendStats,
  EmbeddingGenerator,
  HealthCheckResult,
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryUpdate,
  MemoryQuery,
  MemoryType,
  SearchOptions,
  SearchResult,
} from './types.js';

export interface SqlBackendConfig {
  /** Default namespace applied when an entry omits one. */
  defaultNamespace: string;
  /** Embedding generator, for callers that store text and want vectors. */
  embeddingGenerator?: EmbeddingGenerator;
  /** Soft cap used by healthCheck to report utilization. */
  maxEntries: number;
  verbose: boolean;
}

const DEFAULT_CONFIG: SqlBackendConfig = {
  defaultNamespace: 'default',
  maxEntries: 1_000_000,
  verbose: false,
};

export class SqlBackend extends EventEmitter implements IMemoryBackend {
  protected config: SqlBackendConfig;
  protected driver: SqlDriver | null = null;
  protected initialized = false;
  /** Populated during initialize(); surfaced for diagnostics. */
  migrationReport: MigrationReport | null = null;
  /** Whether the FTS5 full-text index is available (Issue #66). */
  protected _fts5Available = false;

  protected stats = { queryCount: 0, totalQueryTime: 0, writeCount: 0, totalWriteTime: 0 };
  /** Debounce counter: the agent_reads purge is expensive, so it is amortised. */
  protected _readCount = 0;

  // ===== ANN (HNSW) fast path for search() ==================================
  // Below MONOMIND_HNSW_THRESHOLD active embedded entries, brute-force cosine
  // (a few tens of ms per the docstring on search() below) stays cheaper than
  // building and maintaining a graph. Above it, an index is built once per
  // (dimensions, entry-count, max-updated-at) fingerprint and reused — a
  // change to any of those is the invalidation signal (store/delete change
  // the count; an in-place re-embed of an existing id changes max-updated-at
  // without changing the count).
  protected _annIndex: HNSWIndex | null = null;
  protected _annEntries: Map<string, MemoryEntry> = new Map();
  protected _annDimensions = 0;
  protected _annBuiltForCount = -1;
  protected _annBuiltForMaxUpdatedAt = -1;

  static readonly ANN_THRESHOLD = (() => {
    const raw = process.env.MONOMIND_HNSW_THRESHOLD;
    const n = raw !== undefined ? parseInt(raw, 10) : NaN;
    // 100k, not 5k (issue #426): at 20k vectors brute force answered in
    // ~0.25 s while the JSON-cached graph took ~1.2 s to load (~1 GB RSS)
    // and ~78 s to build the first time.
    return Number.isFinite(n) && n > 0 ? n : 100_000;
  })();

  /** Directory to cache the built ANN graph in, next to the real DB file.
   *  Returns null (no persistence) for in-memory databases — there is no
   *  stable location to cache next to, and the process-lifetime in-memory
   *  cache above already covers repeated searches within one run. */
  protected getAnnCacheDir(): string | null {
    return null;
  }

  // Bodies live in sql-backend-ann.ts (file-size sweep) — thin wrappers here
  // keep the same call signatures and visibility other methods rely on.
  protected annCachePath(): string | null {
    return sqlBackendAnnMethods.annCachePath.call(this);
  }

  protected countEmbeddedActiveEntries(): { count: number; maxUpdatedAt: number } {
    return sqlBackendAnnMethods.countEmbeddedActiveEntries.call(this);
  }

  protected async getAnnIndex(
    dimensions: number,
    force = false,
  ): Promise<{ index: HNSWIndex; entries: Map<string, MemoryEntry> } | null> {
    return sqlBackendAnnMethods.getAnnIndex.call(this, dimensions, force);
  }

  /**
   * Diagnostics for `memory search --build-hnsw` / status reporting. Read-only
   * — does not build the index as a side effect.
   */
  getAnnStatus(): {
    thresholdEntries: number;
    activeEmbeddedEntries: number;
    built: boolean;
    entryCount: number;
    dimensions: number;
    cachePath: string | null;
  } {
    return {
      thresholdEntries: SqlBackend.ANN_THRESHOLD,
      activeEmbeddedEntries: this.countEmbeddedActiveEntries().count,
      built: this._annIndex !== null,
      entryCount: this._annEntries.size,
      dimensions: this._annDimensions,
      cachePath: this.annCachePath(),
    };
  }

  /**
   * Force-build (or reload from a valid on-disk cache) the ANN index
   * regardless of ANN_THRESHOLD — the real implementation behind
   * `memory search --build-hnsw`. Below the threshold, search() itself
   * still uses brute force; this only pre-warms the index and its cache.
   */
  async forceBuildAnnIndex(
    dimensions: number,
  ): Promise<{ entryCount: number; dimensions: number; cachePath: string | null }> {
    this.ensureInitialized();
    const result = await this.getAnnIndex(dimensions, true);
    return {
      entryCount: result?.entries.size ?? 0,
      dimensions,
      cachePath: this.annCachePath(),
    };
  }

  constructor(config: Partial<SqlBackendConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Subclasses open their driver here. */
  protected async openDriver(): Promise<SqlDriver> {
    throw new Error('SqlBackend.openDriver() must be implemented by a subclass');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.driver = await this.openDriver();

    try {
      // Enable FK enforcement — required for ON DELETE CASCADE to fire.
      try {
        this.driver.exec('PRAGMA foreign_keys = ON');
      } catch {
        /* unsupported on this driver */
      }

      this.migrationReport = initializeSchema(this.driver);
      this._fts5Available = hasFTS5Table(this.driver);
    } catch (error) {
      // A failed initialize must not leave the connection open, and must not
      // persist a half-initialised database.
      try {
        this.driver.close();
      } catch {
        /* already closed */
      }
      this.driver = null;
      throw error;
    }
    if (this.config.verbose && this.migrationReport.legacyColumnFound) {
      console.log(
        `[SqlBackend] migrated ${this.migrationReport.migrated} inline embedding(s); ` +
          `${this.migrationReport.skipped} already present`,
      );
    }

    this.initialized = true;
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.initialized || !this.driver) return;
    // A refused persist (e.g. the file changed underneath a sql.js snapshot) must
    // still release the connection; the error is rethrown afterwards.
    let persistError: unknown;
    try {
      await this.driver.persist();
    } catch (error) {
      persistError = error;
    }
    try {
      this.driver.pragma('optimize');
    } catch {
      /* not supported everywhere */
    }
    this.driver.close();
    this.driver = null;
    this.initialized = false;
    this.emit('shutdown');
    if (persistError) throw persistError;
  }

  // ===== Writes =============================================================
  // Bodies live in sql-backend-writes.ts (file-size sweep).

  async store(entry: MemoryEntry): Promise<void> {
    return sqlBackendWriteMethods.store.call(this, entry);
  }

  async storeIfVersion(entry: MemoryEntry, expectedVersion: number): Promise<boolean> {
    return sqlBackendWriteMethods.storeIfVersion.call(this, entry, expectedVersion);
  }

  async storeIfAbsent(entry: MemoryEntry): Promise<boolean> {
    return sqlBackendWriteMethods.storeIfAbsent.call(this, entry);
  }

  protected storeSync(entry: MemoryEntry): void {
    sqlBackendWriteMethods.storeSync.call(this, entry);
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    return sqlBackendWriteMethods.bulkInsert.call(this, entries);
  }

  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    return sqlBackendWriteMethods.update.call(this, id, update);
  }

  async delete(id: string): Promise<boolean> {
    return sqlBackendWriteMethods.delete.call(this, id);
  }

  async bulkDelete(ids: string[]): Promise<number> {
    return sqlBackendWriteMethods.bulkDelete.call(this, ids);
  }

  async clearNamespace(namespace: string): Promise<number> {
    return sqlBackendWriteMethods.clearNamespace.call(this, namespace);
  }

  // ===== Reads ==============================================================
  // Bodies live in sql-backend-reads.ts (file-size sweep).

  async get(id: string, agentId?: string): Promise<MemoryEntry | null> {
    return sqlBackendReadMethods.get.call(this, id, agentId);
  }

  protected checkAndPromoteEntry(entryId: string): void {
    sqlBackendReadMethods.checkAndPromoteEntry.call(this, entryId);
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    return sqlBackendReadMethods.getByKey.call(this, namespace, key);
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    return sqlBackendReadMethods.query.call(this, query);
  }

  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    return sqlBackendReadMethods.search.call(this, embedding, options);
  }

  async keywordSearch(
    queryText: string,
    options: { namespace?: string; limit?: number } = {},
  ): Promise<
    { id: string; key: string; content: string; namespace: string; rank: number }[] | null
  > {
    return sqlBackendReadMethods.keywordSearch.call(this, queryText, options);
  }

  /** Whether FTS5 full-text search is available on this backend instance. */
  get fts5Available(): boolean {
    return this._fts5Available;
  }

  async count(namespace?: string): Promise<number> {
    return sqlBackendReadMethods.count.call(this, namespace);
  }

  async listNamespaces(): Promise<string[]> {
    return sqlBackendReadMethods.listNamespaces.call(this);
  }

  // ===== Introspection ======================================================
  // Bodies live in sql-backend-introspect.ts (file-size sweep).

  async getStats(): Promise<BackendStats> {
    return sqlBackendIntrospectMethods.getStats.call(this);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return sqlBackendIntrospectMethods.healthCheck.call(this);
  }

  /** Flush to durable storage. No-op on write-through drivers. */
  async persist(): Promise<void> {
    return sqlBackendIntrospectMethods.persist.call(this);
  }

  // ===== Internals =========================================================

  // Every tag write is parameterized, so this is shape sanity rather than
  // injection defense. `src:<absolute path>` provenance tags are first-class in
  // the knowledge pipeline and legitimately contain spaces, parentheses and
  // unicode, so they only exclude control characters. The same holds for
  // `url:<canonical url>` (a query string carries `?`, `=`, `&`, `%`) and
  // `parent:<scope>:<path>` — refusing those failed every chunk of any capture
  // whose page URL has a query string, e.g. every YouTube video.
  private static readonly TAG_RE = /^[a-zA-Z0-9_\-.:/~ ]+$/;
  private static readonly PROVENANCE_TAG_RE = /^(?:src|url|parent):[^\x00-\x1f\x7f]+$/;
  private static readonly MAX_TAG_LEN = 512;

  protected validateTags(tags: string[]): void {
    for (const tag of tags) {
      const ok =
        typeof tag === 'string' &&
        tag.length <= SqlBackend.MAX_TAG_LEN &&
        (SqlBackend.PROVENANCE_TAG_RE.test(tag) || SqlBackend.TAG_RE.test(tag));
      if (!ok) throw new Error(`Invalid tag format: "${String(tag).slice(0, 80)}"`);
    }
  }

  protected ensureInitialized(): void {
    if (!this.initialized || !this.driver) {
      throw new Error('Backend not initialized. Call initialize() first.');
    }
  }

  protected rowToEntry(row: Record<string, unknown>): MemoryEntry {
    // PKG-3: callers LEFT JOIN memory_embeddings AS _emb so the embedding is
    // already on the row — no extra SELECT per entry. The buffer slice
    // pattern matches storeSync(): Node pools small Buffers in a shared 4KB
    // slab, so `.buffer` alone can span unrelated memory.
    let embedding: Float32Array | undefined;
    const buf = row._emb as Buffer | Uint8Array | undefined;
    if (buf && buf.byteLength > 0) {
      embedding = new Float32Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength / 4);
    }

    return {
      id: String(row.id),
      key: String(row.key),
      content: String(row.content),
      embedding,
      type: row.type as MemoryType,
      namespace: String(row.namespace),
      tags: JSON.parse(String(row.tags)),
      metadata: JSON.parse(String(row.metadata)),
      ownerId: (row.owner_id as string | null) ?? undefined,
      accessLevel: row.access_level as MemoryEntry['accessLevel'],
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      expiresAt: (row.expires_at as number | null) ?? undefined,
      eventAt: (row.event_at as number | null) ?? undefined,
      version: Number(row.version),
      references: JSON.parse(String(row.references)),
      accessCount: Number(row.access_count),
      lastAccessedAt: Number(row.last_accessed_at),
    };
  }
}
