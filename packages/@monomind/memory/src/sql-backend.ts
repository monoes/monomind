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
 * @module v1/memory/sql-backend
 */

import { EventEmitter } from 'node:events';
import { cosineSimilarity } from './math-utils.js';
import type { SqlDriver, SqlParam } from './sql-driver.js';
import { initializeSchema, type MigrationReport } from './sql-schema.js';
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  ComponentHealth,
  MemoryType,
  EmbeddingGenerator,
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

/** Cap on votes/rows pulled in one go, guarding against unbounded memory use. */
const MAX_QUERY_LIMIT = 10_000;

export class SqlBackend extends EventEmitter implements IMemoryBackend {
  protected config: SqlBackendConfig;
  protected driver: SqlDriver | null = null;
  protected initialized = false;
  /** Populated during initialize(); surfaced for diagnostics. */
  migrationReport: MigrationReport | null = null;

  private stats = { queryCount: 0, totalQueryTime: 0, writeCount: 0, totalWriteTime: 0 };
  /** Debounce counter: the agent_reads purge is expensive, so it is amortised. */
  private _readCount = 0;

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

    // Enable FK enforcement — required for ON DELETE CASCADE to fire.
    try {
      this.driver.exec('PRAGMA foreign_keys = ON');
    } catch {
      /* unsupported on this driver */
    }

    this.migrationReport = initializeSchema(this.driver);
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
    await this.driver.persist();
    try {
      this.driver.pragma('optimize');
    } catch {
      /* not supported everywhere */
    }
    this.driver.close();
    this.driver = null;
    this.initialized = false;
    this.emit('shutdown');
  }

  // ===== Writes ============================================================

  async store(entry: MemoryEntry): Promise<void> {
    this.ensureInitialized();
    const startTime = performance.now();
    this.validateTags(entry.tags);

    this.driver!.transaction(() => this.storeSync(entry));

    const duration = performance.now() - startTime;
    this.stats.writeCount++;
    this.stats.totalWriteTime += duration;
    this.emit('entry:stored', { id: entry.id, duration });
  }

  /** Synchronous store body, shared by store() and bulkInsert(). */
  private storeSync(entry: MemoryEntry): void {
    const d = this.driver!;

    // Read any existing embedding BEFORE INSERT OR REPLACE fires the CASCADE
    // that would delete it — an entry updated without a vector must keep the
    // one it already had.
    let embeddingToStore = entry.embedding;
    if (!embeddingToStore) {
      const existing = d.get('SELECT embedding FROM memory_embeddings WHERE entry_id = ?', [entry.id]);
      const buf = existing?.embedding as Buffer | Uint8Array | undefined;
      if (buf && buf.byteLength > 0) {
        embeddingToStore = new Float32Array(
          buf.buffer as ArrayBuffer,
          buf.byteOffset,
          buf.byteLength / 4,
        );
      }
    }

    d.run(
      `INSERT OR REPLACE INTO memory_entries (
         id, key, content, type, namespace, tags, metadata, owner_id, access_level,
         created_at, updated_at, expires_at, event_at, version, "references",
         access_count, last_accessed_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        entry.id, entry.key, entry.content, entry.type, entry.namespace,
        JSON.stringify(entry.tags), JSON.stringify(entry.metadata),
        entry.ownerId || null, entry.accessLevel,
        entry.createdAt, entry.updatedAt, entry.expiresAt || null, entry.eventAt ?? null,
        entry.version, JSON.stringify(entry.references), entry.accessCount, entry.lastAccessedAt,
      ] as SqlParam[],
    );

    d.run('DELETE FROM memory_entry_tags WHERE entry_id = ?', [entry.id]);
    for (const tag of entry.tags) {
      d.run('INSERT OR IGNORE INTO memory_entry_tags (entry_id, tag) VALUES (?, ?)', [entry.id, tag]);
    }

    if (embeddingToStore) {
      // Slice by byteOffset/byteLength: for copies under Node's 4KB pooling
      // threshold, `.buffer` refers to the entire shared pool, so writing it
      // whole silently stores unrelated memory.
      const bytes = Buffer.from(
        embeddingToStore.buffer as ArrayBuffer,
        embeddingToStore.byteOffset,
        embeddingToStore.byteLength,
      );
      d.run('INSERT OR REPLACE INTO memory_embeddings (entry_id, embedding) VALUES (?, ?)', [
        entry.id,
        bytes,
      ]);
    }
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    this.ensureInitialized();
    for (const e of entries) this.validateTags(e.tags);
    this.driver!.transaction(() => {
      for (const entry of entries) this.storeSync(entry);
    });
    this.emit('bulk:inserted', { count: entries.length });
  }

  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    this.ensureInitialized();
    const entry = await this.get(id);
    if (!entry) return null;

    if (update.content !== undefined) entry.content = update.content;
    if (update.tags !== undefined) entry.tags = update.tags;
    if (update.metadata !== undefined) entry.metadata = { ...entry.metadata, ...update.metadata };
    if (update.accessLevel !== undefined) entry.accessLevel = update.accessLevel;
    if (update.expiresAt !== undefined) entry.expiresAt = update.expiresAt;
    if (update.references !== undefined) entry.references = update.references;

    entry.updatedAt = Date.now();
    entry.version++;

    await this.store(entry);
    this.emit('entry:updated', { id });
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();
    const d = this.driver!;
    // Explicit tag cleanup as well as the CASCADE — belt and braces, since FK
    // enforcement is a pragma that not every driver honours.
    d.run('DELETE FROM memory_entry_tags WHERE entry_id = ?', [id]);
    d.run('DELETE FROM memory_embeddings WHERE entry_id = ?', [id]);
    const changes = d.run('DELETE FROM memory_entries WHERE id = ?', [id]);
    if (changes > 0) {
      this.emit('entry:deleted', { id });
      return true;
    }
    return false;
  }

  async bulkDelete(ids: string[]): Promise<number> {
    this.ensureInitialized();
    const d = this.driver!;
    const count = d.transaction(() => {
      let deleted = 0;
      for (const id of ids) {
        d.run('DELETE FROM memory_entry_tags WHERE entry_id = ?', [id]);
        d.run('DELETE FROM memory_embeddings WHERE entry_id = ?', [id]);
        if (d.run('DELETE FROM memory_entries WHERE id = ?', [id]) > 0) deleted++;
      }
      return deleted;
    });
    this.emit('bulk:deleted', { count });
    return count;
  }

  async clearNamespace(namespace: string): Promise<number> {
    this.ensureInitialized();
    const d = this.driver!;
    const count = d.transaction(() => {
      d.run(
        `DELETE FROM memory_entry_tags
          WHERE entry_id IN (SELECT id FROM memory_entries WHERE namespace = ?)`,
        [namespace],
      );
      const changes = d.run('DELETE FROM memory_entries WHERE namespace = ?', [namespace]);
      d.run('DELETE FROM memory_embeddings WHERE entry_id NOT IN (SELECT id FROM memory_entries)');
      return changes;
    });
    this.emit('namespace:cleared', { namespace, count });
    return count;
  }

  // ===== Reads =============================================================

  async get(id: string, agentId?: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();
    const startTime = performance.now();
    const row = this.driver!.get('SELECT * FROM memory_entries WHERE id = ?', [id]);
    if (!row) return null;

    // Collaborative memory promotion — https://arxiv.org/abs/2505.18279
    const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
    if (agentId && AGENT_ID_RE.test(agentId)) {
      try {
        this.driver!.run(
          'INSERT OR IGNORE INTO agent_reads (entry_id, agent_id, read_at) VALUES (?, ?, ?)',
          [id, agentId, Date.now()],
        );
        this._readCount++;
        if (this._readCount % 1000 === 0) this.checkAndPromoteEntry(id);
      } catch {
        /* non-critical */
      }
    }

    const entry = this.rowToEntry(row);
    this.emit('entry:retrieved', { id, duration: performance.now() - startTime });
    return entry;
  }

  /**
   * Promote an entry to 'team' once 3+ distinct agents have read it within 24h.
   * https://arxiv.org/abs/2505.18279
   */
  private checkAndPromoteEntry(entryId: string): void {
    const d = this.driver;
    if (!d) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    d.run('DELETE FROM agent_reads WHERE read_at <= ?', [cutoff]);
    const row = d.get(
      'SELECT COUNT(DISTINCT agent_id) as cnt FROM agent_reads WHERE entry_id = ? AND read_at > ?',
      [entryId, cutoff],
    );
    if (Number(row?.cnt ?? 0) >= 3) {
      d.run("UPDATE memory_entries SET access_level = 'team' WHERE id = ? AND access_level = 'private'", [
        entryId,
      ]);
    }
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();
    const startTime = performance.now();
    const row = this.driver!.get('SELECT * FROM memory_entries WHERE namespace = ? AND key = ?', [
      namespace,
      key,
    ]);
    if (!row) return null;
    const entry = this.rowToEntry(row);
    this.emit('entry:retrieved', { namespace, key, duration: performance.now() - startTime });
    return entry;
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    this.ensureInitialized();
    const startTime = performance.now();

    let sql = 'SELECT * FROM memory_entries WHERE 1=1';
    const params: SqlParam[] = [];

    if (query.namespace) { sql += ' AND namespace = ?'; params.push(query.namespace); }
    if (query.key) { sql += ' AND key = ?'; params.push(query.key); }
    if (query.keyPrefix) { sql += ' AND key LIKE ?'; params.push(`${query.keyPrefix}%`); }
    if (query.memoryType) { sql += ' AND type = ?'; params.push(query.memoryType); }
    if (query.accessLevel) { sql += ' AND access_level = ?'; params.push(query.accessLevel); }
    if (query.ownerId) { sql += ' AND owner_id = ?'; params.push(query.ownerId); }
    if (query.createdAfter) { sql += ' AND created_at >= ?'; params.push(query.createdAfter); }
    if (query.createdBefore) { sql += ' AND created_at <= ?'; params.push(query.createdBefore); }
    if (query.updatedAfter) { sql += ' AND updated_at >= ?'; params.push(query.updatedAfter); }
    if (query.updatedBefore) { sql += ' AND updated_at <= ?'; params.push(query.updatedBefore); }
    // Bi-temporal event-time filters (arXiv:2501.13956 — Zep/Graphiti)
    if (query.eventAfter) { sql += ' AND event_at >= ?'; params.push(query.eventAfter); }
    if (query.eventBefore) { sql += ' AND event_at <= ?'; params.push(query.eventBefore); }

    if (!query.includeExpired) {
      sql += ' AND (expires_at IS NULL OR expires_at > ?)';
      params.push(Date.now());
    }

    // MemoryQuery.tags is documented as "entries must have all specified tags"
    // (types.ts). Counting distinct matches enforces that; an EXISTS(... IN ...)
    // would be ANY-match, which is exactly the divergence that made the two old
    // backends return different result sets for the same call.
    if (query.tags && query.tags.length > 0) {
      this.validateTags(query.tags);
      const placeholders = query.tags.map(() => '?').join(', ');
      sql += ` AND (
        SELECT COUNT(DISTINCT t.tag) FROM memory_entry_tags t
        WHERE t.entry_id = memory_entries.id AND t.tag IN (${placeholders})
      ) = ?`;
      params.push(...query.tags, query.tags.length);
    }

    const colMap: Record<string, string> = {
      createdAt: 'created_at', updatedAt: 'updated_at',
      lastAccessedAt: 'last_accessed_at', accessCount: 'access_count', key: 'key',
    };
    const orderCol =
      query.sortField && query.sortField !== 'score' && colMap[query.sortField]
        ? colMap[query.sortField]
        : 'created_at';
    const orderDir = query.sortDirection === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${orderCol} ${orderDir} LIMIT ?`;

    const effectiveLimit = Math.min(Math.max(1, query.limit ?? MAX_QUERY_LIMIT), MAX_QUERY_LIMIT);
    params.push(effectiveLimit);
    if (query.offset) { sql += ' OFFSET ?'; params.push(query.offset); }

    const rows = this.driver!.all(sql, params);
    const results = rows.map((r) => this.rowToEntry(r));

    const duration = performance.now() - startTime;
    this.stats.queryCount++;
    this.stats.totalQueryTime += duration;
    this.emit('query:executed', { query, resultCount: results.length, duration });
    return results;
  }

  /**
   * Semantic search — brute-force cosine over stored embeddings, namespace- and
   * TTL-filtered in SQL. At second-brain scale (10^3–10^5 vectors of 384 dims)
   * this is a few tens of ms; swap in an ANN index if a profiled workload
   * outgrows it.
   */
  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    this.ensureInitialized();
    const ns = options.filters?.namespace;
    const rows = this.driver!.iterate(
      `SELECT e.*, emb.embedding AS _emb
         FROM memory_entries e
         JOIN memory_embeddings emb ON emb.entry_id = e.id
        WHERE (e.expires_at IS NULL OR e.expires_at = 0 OR e.expires_at > ?)
        ${ns ? 'AND e.namespace = ?' : ''}`,
      ns ? [Date.now(), ns] : [Date.now()],
    );

    const results: SearchResult[] = [];
    for (const row of rows) {
      const buf = row._emb as Buffer | Uint8Array | undefined;
      if (!buf || buf.byteLength % 4 !== 0) continue;
      const vec = new Float32Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength / 4);
      if (vec.length !== embedding.length) continue;
      const similarity = cosineSimilarity(embedding, vec);
      if (options.threshold !== undefined && similarity < options.threshold) continue;
      const clean = { ...row };
      delete (clean as Record<string, unknown>)._emb;
      results.push({ entry: this.rowToEntry(clean), score: similarity, distance: 1 - similarity });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.k);
  }

  async count(namespace?: string): Promise<number> {
    this.ensureInitialized();
    const row = namespace
      ? this.driver!.get('SELECT COUNT(*) as count FROM memory_entries WHERE namespace = ?', [namespace])
      : this.driver!.get('SELECT COUNT(*) as count FROM memory_entries');
    return Number(row?.count ?? 0);
  }

  async listNamespaces(): Promise<string[]> {
    this.ensureInitialized();
    return this.driver!.all('SELECT DISTINCT namespace FROM memory_entries').map((r) =>
      String(r.namespace),
    );
  }

  // ===== Introspection =====================================================

  async getStats(): Promise<BackendStats> {
    this.ensureInitialized();
    const d = this.driver!;

    const entriesByNamespace: Record<string, number> = {};
    for (const row of d.all('SELECT namespace, COUNT(*) as count FROM memory_entries GROUP BY namespace')) {
      entriesByNamespace[String(row.namespace)] = Number(row.count);
    }

    const entriesByType: Record<MemoryType, number> = {
      episodic: 0, semantic: 0, working: 0, cache: 0,
    };
    for (const row of d.all('SELECT type, COUNT(*) as count FROM memory_entries GROUP BY type')) {
      entriesByType[String(row.type) as MemoryType] = Number(row.count);
    }

    // page_count/page_size are native-only; sql.js reports 0 rather than a
    // fabricated figure.
    let memoryUsage = 0;
    const pageCount = d.pragma('page_count');
    const pageSize = d.pragma('page_size');
    if (typeof pageCount === 'number' && typeof pageSize === 'number') {
      memoryUsage = pageCount * pageSize;
    }

    return {
      totalEntries: await this.count(),
      entriesByNamespace,
      entriesByType,
      memoryUsage,
      avgQueryTime: this.stats.queryCount > 0 ? this.stats.totalQueryTime / this.stats.queryCount : 0,
      avgSearchTime: 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (!this.initialized || !this.driver) {
      return {
        status: 'unhealthy',
        components: {
          storage: { status: 'unhealthy', latency: 0, message: 'Not initialized' },
          index: { status: 'healthy', latency: 0 },
          cache: { status: 'healthy', latency: 0 },
        },
        timestamp: Date.now(),
        issues: ['Backend not initialized'],
        recommendations: ['Call initialize() before using'],
      };
    }

    let storageHealth: ComponentHealth;
    try {
      const integrity = this.driver.pragma('integrity_check');
      if (integrity === undefined || integrity === 'ok') {
        // undefined means the driver cannot run the check, not that it failed.
        storageHealth = { status: 'healthy', latency: 0 };
      } else {
        issues.push('Database integrity check failed');
        recommendations.push('Run VACUUM to repair database');
        storageHealth = { status: 'unhealthy', latency: 0, message: 'Integrity check failed' };
      }
    } catch (error) {
      issues.push('Failed to check database integrity');
      storageHealth = { status: 'unhealthy', latency: 0, message: String(error) };
    }

    const totalEntries = await this.count();
    const utilizationPercent = (totalEntries / this.config.maxEntries) * 100;
    if (utilizationPercent > 95) {
      issues.push('Storage utilization critical (>95%)');
      recommendations.push('Cleanup old data or increase maxEntries');
      storageHealth = { status: 'unhealthy', latency: 0, message: 'Near capacity' };
    } else if (utilizationPercent > 80) {
      issues.push('Storage utilization high (>80%)');
      recommendations.push('Consider cleanup');
      if (storageHealth.status === 'healthy') {
        storageHealth = { status: 'degraded', latency: 0, message: 'High utilization' };
      }
    }

    const status =
      storageHealth.status === 'unhealthy'
        ? 'unhealthy'
        : storageHealth.status === 'degraded'
          ? 'degraded'
          : 'healthy';

    return {
      status,
      components: {
        storage: storageHealth,
        index: { status: 'healthy', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(),
      issues,
      recommendations,
    };
  }

  /** Flush to durable storage. No-op on write-through drivers. */
  async persist(): Promise<void> {
    if (!this.driver) return;
    await this.driver.persist();
  }

  // ===== Internals =========================================================

  // Every tag write is parameterized, so this is shape sanity rather than
  // injection defense. `src:<absolute path>` provenance tags are first-class in
  // the knowledge pipeline and legitimately contain spaces, parentheses and
  // unicode, so they only exclude control characters.
  private static readonly TAG_RE = /^[a-zA-Z0-9_\-.:/~ ]+$/;
  private static readonly SRC_TAG_RE = /^src:[^\x00-\x1f\x7f]+$/;
  private static readonly MAX_TAG_LEN = 512;

  protected validateTags(tags: string[]): void {
    for (const tag of tags) {
      const ok =
        typeof tag === 'string' &&
        tag.length <= SqlBackend.MAX_TAG_LEN &&
        (tag.startsWith('src:') ? SqlBackend.SRC_TAG_RE.test(tag) : SqlBackend.TAG_RE.test(tag));
      if (!ok) throw new Error(`Invalid tag format: "${String(tag).slice(0, 80)}"`);
    }
  }

  protected ensureInitialized(): void {
    if (!this.initialized || !this.driver) {
      throw new Error('Backend not initialized. Call initialize() first.');
    }
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    let embedding: Float32Array | undefined;
    const embRow = this.driver!.get('SELECT embedding FROM memory_embeddings WHERE entry_id = ?', [
      String(row.id),
    ]);
    const buf = embRow?.embedding as Buffer | Uint8Array | undefined;
    if (buf && buf.byteLength > 0) {
      // Slice by byteOffset/byteLength — see storeSync for why `.buffer` alone
      // can span unrelated pooled memory.
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
