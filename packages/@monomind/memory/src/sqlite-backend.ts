/**
 * SQLite Memory Backend
 *
 * Provides structured storage for memory entries using SQLite.
 * Optimized for ACID transactions, exact matches, and complex queries.
 * Part of ADR-009: Hybrid Memory Backend (SQLite + AgentDB)
 *
 * @module v1/memory/sqlite-backend
 */

import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  ComponentHealth,
  MemoryType,
  EmbeddingGenerator,
  generateMemoryId,
  createDefaultEntry,
} from './types.js';

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

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: SQLiteBackendConfig = {
  databasePath: ':memory:',
  walMode: true,
  optimize: true,
  defaultNamespace: 'default',
  maxEntries: 1000000,
  verbose: false,
};

/**
 * SQLite Backend for Structured Memory Storage
 *
 * Provides:
 * - ACID transactions for data consistency
 * - Efficient indexing for exact matches and prefix queries
 * - Full-text search capabilities
 * - Complex SQL queries with joins and aggregations
 * - Persistent storage with WAL mode
 */
export class SQLiteBackend extends EventEmitter implements IMemoryBackend {
  private config: SQLiteBackendConfig;
  private db: Database.Database | null = null;
  private initialized: boolean = false;

  // Performance tracking
  private stats = {
    queryCount: 0,
    totalQueryTime: 0,
    writeCount: 0,
    totalWriteTime: 0,
  };

  // Cached prepared statements — prepared once in initialize() to avoid N+1 re-prepare
  private stmtGetEmbedding: Database.Statement | null = null;
  private stmtInsertEntry: Database.Statement | null = null;
  private stmtInsertEmbedding: Database.Statement | null = null;
  private stmtDeleteTags: Database.Statement | null = null;
  private stmtInsertTag: Database.Statement | null = null;
  // Debounce counter for checkAndPromoteEntry (H2: avoid full-table purge on every get)
  private _readCount = 0;

  constructor(config: Partial<SQLiteBackendConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the SQLite backend
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Open database connection
    this.db = new Database(this.config.databasePath, {
      verbose: this.config.verbose ? console.log : undefined,
    });

    // Enable WAL mode for better concurrency
    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
    }

    // Enable FK enforcement — required for ON DELETE CASCADE to fire
    this.db.pragma('foreign_keys = ON');

    // Performance optimizations
    if (this.config.optimize) {
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = MEMORY');
    }

    // Create schema
    this.createSchema();

    // Pre-compile hot-path statements to avoid N+1 re-prepare
    this.stmtGetEmbedding = this.db.prepare(
      'SELECT embedding FROM memory_embeddings WHERE entry_id = ?'
    );
    this.stmtInsertEntry = this.db.prepare(`
      INSERT OR REPLACE INTO memory_entries (
        id, key, content, type, namespace, tags, metadata,
        owner_id, access_level, created_at, updated_at, expires_at,
        event_at, version, "references", access_count, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtInsertEmbedding = this.db.prepare(
      'INSERT OR REPLACE INTO memory_embeddings (entry_id, embedding) VALUES (?, ?)'
    );
    this.stmtDeleteTags = this.db.prepare(
      'DELETE FROM memory_entry_tags WHERE entry_id = ?'
    );
    this.stmtInsertTag = this.db.prepare(
      'INSERT OR IGNORE INTO memory_entry_tags (entry_id, tag) VALUES (?, ?)'
    );

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown the backend
   */
  async shutdown(): Promise<void> {
    if (!this.initialized || !this.db) return;

    // Optimize database before closing
    if (this.config.optimize) {
      this.db.pragma('optimize');
    }

    this.db.close();
    this.db = null;
    this.stmtGetEmbedding = null;
    this.stmtInsertEntry = null;
    this.stmtInsertEmbedding = null;
    this.stmtDeleteTags = null;
    this.stmtInsertTag = null;
    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Store a memory entry
   */
  async store(entry: MemoryEntry): Promise<void> {
    this.ensureInitialized();
    const startTime = performance.now();

    this.validateTags(entry.tags);

    const doStore = this.db!.transaction((e: MemoryEntry) => {
      // Read existing embedding BEFORE INSERT OR REPLACE fires CASCADE and deletes it
      let embeddingToStore = e.embedding;
      if (!embeddingToStore) {
        const existingEmb = this.stmtGetEmbedding!.get(e.id) as any;
        if (existingEmb?.embedding) {
          embeddingToStore = new Float32Array(Buffer.from(existingEmb.embedding).buffer);
        }
      }
      this.stmtInsertEntry!.run(
        e.id, e.key, e.content, e.type, e.namespace,
        JSON.stringify(e.tags), JSON.stringify(e.metadata),
        e.ownerId || null, e.accessLevel,
        e.createdAt, e.updatedAt, e.expiresAt || null, e.eventAt ?? null,
        e.version, JSON.stringify(e.references), e.accessCount, e.lastAccessedAt
      );
      this.stmtDeleteTags!.run(e.id);
      for (const tag of e.tags) {
        this.stmtInsertTag!.run(e.id, tag);
      }
      if (embeddingToStore) {
        this.stmtInsertEmbedding!.run(
          e.id,
          Buffer.from(embeddingToStore.buffer, embeddingToStore.byteOffset, embeddingToStore.byteLength),
        );
      }
    });

    doStore(entry);

    const duration = performance.now() - startTime;
    this.stats.writeCount++;
    this.stats.totalWriteTime += duration;

    this.emit('entry:stored', { id: entry.id, duration });
  }

  /**
   * Get a memory entry by ID
   */
  async get(id: string, agentId?: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT * FROM memory_entries WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    // Collaborative memory promotion: track per-agent reads for auto-promotion
    // Source: https://arxiv.org/abs/2505.18279
    const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
    if (agentId && AGENT_ID_RE.test(agentId)) {
      try {
        this.db!.prepare(
          'INSERT OR IGNORE INTO agent_reads (entry_id, agent_id, read_at) VALUES (?, ?, ?)'
        ).run(id, agentId, Date.now());
        // Debounce: run full-table purge only every 1000 reads (H2)
        this._readCount++;
        if (this._readCount % 1000 === 0) {
          void this.checkAndPromoteEntry(id);
        }
      } catch { /* non-critical */ }
    }

    return this.rowToEntry(row);
  }

  /**
   * Auto-promote an entry's access_level to 'team' when 3+ distinct agents
   * have read it within the past 24 hours.
   * Source: https://arxiv.org/abs/2505.18279
   */
  private checkAndPromoteEntry(entryId: string): void {
    if (!this.db) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    // Purge stale read records to keep table size bounded
    this.db.prepare('DELETE FROM agent_reads WHERE read_at <= ?').run(cutoff);

    const countRow = this.db.prepare(
      'SELECT COUNT(DISTINCT agent_id) as cnt FROM agent_reads WHERE entry_id = ? AND read_at > ?'
    ).get(entryId, cutoff) as { cnt: number } | undefined;

    if ((countRow?.cnt ?? 0) >= 3) {
      this.db.prepare(
        "UPDATE memory_entries SET access_level = 'team' WHERE id = ? AND access_level = 'private'"
      ).run(entryId);
    }
  }

  /**
   * Get a memory entry by key within a namespace
   */
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    const stmt = this.db!.prepare(`
      SELECT * FROM memory_entries
      WHERE namespace = ? AND key = ?
    `);
    const row = stmt.get(namespace, key) as any;

    if (!row) return null;

    return this.rowToEntry(row);
  }

  /**
   * Update a memory entry
   */
  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    const entry = await this.get(id);
    if (!entry) return null;

    // Apply updates
    if (update.content !== undefined) entry.content = update.content;
    if (update.tags !== undefined) entry.tags = update.tags;
    if (update.metadata !== undefined) {
      entry.metadata = { ...entry.metadata, ...update.metadata };
    }
    if (update.accessLevel !== undefined) entry.accessLevel = update.accessLevel;
    if (update.expiresAt !== undefined) entry.expiresAt = update.expiresAt;
    if (update.references !== undefined) entry.references = update.references;

    entry.updatedAt = Date.now();
    entry.version++;

    // Store updated entry
    await this.store(entry);

    this.emit('entry:updated', { id });
    return entry;
  }

  /**
   * Delete a memory entry
   */
  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const deleteEntry = this.db!.prepare('DELETE FROM memory_entries WHERE id = ?');

    // Explicit tag cleanup before entry delete (belt-and-suspenders with CASCADE)
    this.stmtDeleteTags!.run(id);
    const result = deleteEntry.run(id);

    if (result.changes > 0) {
      this.emit('entry:deleted', { id });
      return true;
    }

    return false;
  }

  /**
   * Query memory entries with filters
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    this.ensureInitialized();
    const startTime = performance.now();

    let sql = 'SELECT * FROM memory_entries WHERE 1=1';
    const params: any[] = [];

    // Build WHERE clauses
    if (query.namespace) {
      sql += ' AND namespace = ?';
      params.push(query.namespace);
    }

    if (query.key) {
      sql += ' AND key = ?';
      params.push(query.key);
    }

    if (query.keyPrefix) {
      sql += ' AND key LIKE ?';
      params.push(`${query.keyPrefix}%`);
    }

    if (query.memoryType) {
      sql += ' AND type = ?';
      params.push(query.memoryType);
    }

    if (query.accessLevel) {
      sql += ' AND access_level = ?';
      params.push(query.accessLevel);
    }

    if (query.ownerId) {
      sql += ' AND owner_id = ?';
      params.push(query.ownerId);
    }

    if (query.createdAfter) {
      sql += ' AND created_at >= ?';
      params.push(query.createdAfter);
    }

    if (query.createdBefore) {
      sql += ' AND created_at <= ?';
      params.push(query.createdBefore);
    }

    if (query.updatedAfter) {
      sql += ' AND updated_at >= ?';
      params.push(query.updatedAfter);
    }

    if (query.updatedBefore) {
      sql += ' AND updated_at <= ?';
      params.push(query.updatedBefore);
    }

    // Bi-temporal event-time filters (arXiv:2501.13956 — Zep/Graphiti)
    if (query.eventAfter) {
      sql += ' AND event_at >= ?';
      params.push(query.eventAfter);
    }

    if (query.eventBefore) {
      sql += ' AND event_at <= ?';
      params.push(query.eventBefore);
    }

    if (!query.includeExpired) {
      sql += ' AND (expires_at IS NULL OR expires_at > ?)';
      params.push(Date.now());
    }

    // Tag filtering — uses indexed memory_entry_tags table (no json_each scan)
    if (query.tags && query.tags.length > 0) {
      this.validateTags(query.tags);
      const tagPlaceholders = query.tags.map(() => '?').join(', ');
      sql += ` AND EXISTS (
        SELECT 1 FROM memory_entry_tags t
        WHERE t.entry_id = memory_entries.id AND t.tag IN (${tagPlaceholders})
      )`;
      params.push(...query.tags);
    }

    // Pagination — always enforce a cap to prevent full-table scans
    const MAX_QUERY_LIMIT = 10_000;
    const effectiveLimit = Math.min(
      Math.max(1, query.limit ?? MAX_QUERY_LIMIT),
      MAX_QUERY_LIMIT
    );
    const colMap: Record<string, string> = {
      createdAt: 'created_at', updatedAt: 'updated_at',
      lastAccessedAt: 'last_accessed_at', accessCount: 'access_count', key: 'key',
    };
    const orderCol = (query.sortField && query.sortField !== 'score' && colMap[query.sortField])
      ? colMap[query.sortField]
      : 'created_at';
    const orderDir = query.sortDirection === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${orderCol} ${orderDir}`;
    sql += ' LIMIT ?';
    params.push(effectiveLimit);
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as any[];

    const results = rows.map((row) => this.rowToEntry(row));

    const duration = performance.now() - startTime;
    this.stats.queryCount++;
    this.stats.totalQueryTime += duration;

    return results;
  }

  /**
   * Semantic vector search (not optimized for SQLite, returns empty)
   * Use HybridBackend for semantic search with AgentDB
   */
  async search(
    embedding: Float32Array,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    // SQLite is not optimized for vector search
    // This method returns empty to encourage use of HybridBackend
    console.warn(
      'SQLiteBackend.search(): Vector search not optimized. Use HybridBackend for semantic search.'
    );
    return [];
  }

  /**
   * Bulk insert entries
   */
  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    this.ensureInitialized();

    const transaction = this.db!.transaction((entries: MemoryEntry[]) => {
      for (const entry of entries) {
        this.storeSync(entry);
      }
    });

    transaction(entries);
    this.emit('bulk:inserted', { count: entries.length });
  }

  /**
   * Bulk delete entries
   */
  async bulkDelete(ids: string[]): Promise<number> {
    this.ensureInitialized();

    const deleteEntry = this.db!.prepare('DELETE FROM memory_entries WHERE id = ?');

    const transaction = this.db!.transaction((ids: string[]) => {
      let deleted = 0;
      for (const id of ids) {
        this.stmtDeleteTags!.run(id);
        const result = deleteEntry.run(id);
        if (result.changes > 0) deleted++;
      }
      return deleted;
    });

    return transaction(ids);
  }

  /**
   * Get entry count
   */
  async count(namespace?: string): Promise<number> {
    this.ensureInitialized();

    let sql = 'SELECT COUNT(*) as count FROM memory_entries';
    const params: any[] = [];

    if (namespace) {
      sql += ' WHERE namespace = ?';
      params.push(namespace);
    }

    const stmt = this.db!.prepare(sql);
    const result = stmt.get(...params) as any;
    return result.count;
  }

  /**
   * List all namespaces
   */
  async listNamespaces(): Promise<string[]> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT DISTINCT namespace FROM memory_entries');
    const rows = stmt.all() as any[];
    return rows.map((row) => row.namespace);
  }

  /**
   * Clear all entries in a namespace
   */
  async clearNamespace(namespace: string): Promise<number> {
    this.ensureInitialized();

    const deleteTags = this.db!.prepare(`
      DELETE FROM memory_entry_tags
      WHERE entry_id IN (SELECT id FROM memory_entries WHERE namespace = ?)
    `);
    const deleteEntries = this.db!.prepare('DELETE FROM memory_entries WHERE namespace = ?');
    const deleteOrphanEmbeddings = this.db!.prepare(`
      DELETE FROM memory_embeddings
      WHERE entry_id NOT IN (SELECT id FROM memory_entries)
    `);

    let changes = 0;
    this.db!.transaction(() => {
      deleteTags.run(namespace);
      changes = deleteEntries.run(namespace).changes;
      deleteOrphanEmbeddings.run();
    })();

    return changes;
  }

  /**
   * Get backend statistics
   */
  async getStats(): Promise<BackendStats> {
    this.ensureInitialized();

    // Count by namespace
    const namespaceStmt = this.db!.prepare(`
      SELECT namespace, COUNT(*) as count
      FROM memory_entries
      GROUP BY namespace
    `);
    const namespaceRows = namespaceStmt.all() as any[];
    const entriesByNamespace: Record<string, number> = {};
    for (const row of namespaceRows) {
      entriesByNamespace[row.namespace] = row.count;
    }

    // Count by type
    const typeStmt = this.db!.prepare(`
      SELECT type, COUNT(*) as count
      FROM memory_entries
      GROUP BY type
    `);
    const typeRows = typeStmt.all() as any[];
    const entriesByType: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
      working: 0,
      cache: 0,
    };
    for (const row of typeRows) {
      entriesByType[row.type as MemoryType] = row.count;
    }

    // Get database size
    const pageCount = this.db!.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db!.pragma('page_size', { simple: true }) as number;
    const memoryUsage = pageCount * pageSize;

    const totalEntries = await this.count();

    return {
      totalEntries,
      entriesByNamespace,
      entriesByType,
      memoryUsage,
      avgQueryTime:
        this.stats.queryCount > 0
          ? this.stats.totalQueryTime / this.stats.queryCount
          : 0,
      avgSearchTime: 0, // Not applicable for SQLite
    };
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (!this.initialized || !this.db) {
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

    // Check database integrity
    let storageHealth: ComponentHealth;
    try {
      const integrityCheck = this.db.pragma('integrity_check', { simple: true });
      if (integrityCheck === 'ok') {
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

    // Check utilization
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

  // ===== Private Methods =====

  private static readonly TAG_RE = /^[a-zA-Z0-9_\-.:]+$/;

  private validateTags(tags: string[]): void {
    for (const tag of tags) {
      if (typeof tag !== 'string' || !SQLiteBackend.TAG_RE.test(tag)) {
        throw new Error(`Invalid tag format: "${tag}"`);
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('SQLiteBackend not initialized. Call initialize() first.');
    }
  }

  private createSchema(): void {
    if (!this.db) return;

    // Main entries table
    this.db.exec(`
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
        version INTEGER NOT NULL,
        "references" TEXT NOT NULL,
        access_count INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_namespace ON memory_entries(namespace);
      CREATE INDEX IF NOT EXISTS idx_key ON memory_entries(key);
      CREATE INDEX IF NOT EXISTS idx_namespace_key ON memory_entries(namespace, key);
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

      CREATE TABLE IF NOT EXISTS agent_reads (
        entry_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        read_at INTEGER NOT NULL,
        UNIQUE(entry_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_reads_entry ON agent_reads(entry_id);
      CREATE INDEX IF NOT EXISTS idx_agent_reads_at ON agent_reads(read_at);

      CREATE TABLE IF NOT EXISTS memory_entry_tags (
        entry_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (entry_id, tag),
        FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_entry_tag ON memory_entry_tags(tag, entry_id);
    `);

    // One-time backfill gated by user_version — wrapped in a transaction to hold
    // a write lock and prevent double-backfill under concurrent process startup.
    this.db.transaction(() => {
      const schemaVersion = this.db!.pragma('user_version', { simple: true }) as number;
      if (schemaVersion < 1) {
        this.db!.exec(`
          INSERT OR IGNORE INTO memory_entry_tags (entry_id, tag)
            SELECT memory_entries.id, t.value
            FROM memory_entries, json_each(tags) AS t
            WHERE json_valid(tags) AND t.value IS NOT NULL AND t.value != '';
        `);
        this.db!.pragma('user_version = 1');
      }
    })();
  }

  private rowToEntry(row: any): MemoryEntry {
    // Get embedding if exists — use pre-compiled statement to avoid N+1 re-prepare
    let embedding: Float32Array | undefined;
    const embeddingRow = this.stmtGetEmbedding!.get(row.id) as any;
    if (embeddingRow && embeddingRow.embedding) {
      // Buffer.from() forces a non-pooled copy so .buffer spans only this embedding
      embedding = new Float32Array(Buffer.from(embeddingRow.embedding).buffer);
    }

    return {
      id: row.id,
      key: row.key,
      content: row.content,
      embedding,
      type: row.type as MemoryType,
      namespace: row.namespace,
      tags: JSON.parse(row.tags),
      metadata: JSON.parse(row.metadata),
      ownerId: row.owner_id,
      accessLevel: row.access_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      eventAt: row.event_at ?? undefined,
      version: row.version,
      references: JSON.parse(row.references),
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
    };
  }

  /**
   * Synchronous store for use in transactions
   */
  private storeSync(entry: MemoryEntry): void {
    this.validateTags(entry.tags);
    // Read existing embedding before INSERT OR REPLACE cascades-deletes it
    let embeddingToStore = entry.embedding;
    if (!embeddingToStore) {
      const existingEmb = this.stmtGetEmbedding!.get(entry.id) as any;
      if (existingEmb?.embedding) {
        embeddingToStore = new Float32Array(Buffer.from(existingEmb.embedding).buffer);
      }
    }
    this.stmtInsertEntry!.run(
      entry.id, entry.key, entry.content, entry.type, entry.namespace,
      JSON.stringify(entry.tags), JSON.stringify(entry.metadata),
      entry.ownerId || null, entry.accessLevel,
      entry.createdAt, entry.updatedAt, entry.expiresAt || null, entry.eventAt ?? null,
      entry.version, JSON.stringify(entry.references), entry.accessCount, entry.lastAccessedAt
    );
    this.stmtDeleteTags!.run(entry.id);
    for (const tag of entry.tags) {
      this.stmtInsertTag!.run(entry.id, tag);
    }
    if (embeddingToStore) {
      this.stmtInsertEmbedding!.run(
        entry.id,
        Buffer.from(embeddingToStore.buffer, embeddingToStore.byteOffset, embeddingToStore.byteLength),
      );
    }
  }
}

export default SQLiteBackend;
