/**
 * LanceDB Backend - IMemoryBackend via @lancedb/lancedb
 *
 * Drop-in semantic replacement for AgentDBBackend. Uses LanceDB's columnar
 * format, native IVF-PQ ANN search, SQL predicate push-down, and optional
 * full-text search — all in one embedded Rust engine with no server process.
 *
 * Loaded dynamically: install @lancedb/lancedb + apache-arrow to enable.
 *
 * @module v1/memory/lancedb-backend
 */

import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  EmbeddingGenerator,
} from './types.js';

// ===== Optional dynamic import =====

let lancedb: any;
let importError: Error | null = null;

async function ensureLanceDB(): Promise<void> {
  if (lancedb) return;
  if (importError) throw importError;
  try {
    // @ts-expect-error — optional peer dep resolved at runtime
    lancedb = await import('@lancedb/lancedb');
  } catch (err: any) {
    importError = new Error(
      `LanceDB not installed. Run:\n  npm install @lancedb/lancedb apache-arrow\n\nOriginal error: ${err.message}`
    );
    throw importError;
  }
}

// ===== Configuration =====

export interface LanceDBBackendConfig {
  /** Directory for the Lance database files (default: ~/.monomind/lancedb) */
  dbPath?: string;

  /** Default namespace — also used as the table name (default: 'default') */
  namespace?: string;

  /** Vector dimension. Must match your embedding generator (default: 1536). */
  vectorDimension?: number;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /**
   * Build a full-text search index on `content` + `key` columns.
   * Enables `table.search(text, {queryType:'fts'})` after first write.
   * Requires at least one record in the table (LanceDB limitation).
   */
  enableFts?: boolean;

  /**
   * IVF-PQ search probes (default: 20).
   * Higher = better recall, slower. Ignored until IVF-PQ index is built
   * (auto-triggered at 50k rows).
   */
  nProbes?: number;
}

// ===== Record shape stored in Lance =====

interface LanceRecord {
  id: string;
  key: string;
  content: string;
  type: string;
  namespace: string;
  ownerId: string;
  accessLevel: string;
  tagsStr: string;     // pipe-delimited: |tag1|tag2|
  refsStr: string;     // JSON array
  metadataStr: string; // JSON object
  vector: number[];
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  expiresAt: number;   // 0 = no expiry
  eventAt: number;     // 0 = none
  version: number;
  accessCount: number;
  importanceScore: number;
}

// ===== Helpers =====

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function toRecord(entry: MemoryEntry, dim: number): LanceRecord {
  return {
    id: entry.id,
    key: entry.key,
    content: entry.content,
    type: entry.type,
    namespace: entry.namespace,
    ownerId: entry.ownerId ?? '',
    accessLevel: entry.accessLevel,
    tagsStr: entry.tags.length ? `|${entry.tags.join('|')}|` : '||',
    refsStr: JSON.stringify(entry.references ?? []),
    metadataStr: JSON.stringify(entry.metadata ?? {}),
    vector: entry.embedding ? Array.from(entry.embedding) : new Array(dim).fill(0),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastAccessedAt: entry.lastAccessedAt,
    expiresAt: entry.expiresAt ?? 0,
    eventAt: entry.eventAt ?? 0,
    version: entry.version,
    accessCount: entry.accessCount,
    importanceScore: entry.importanceScore ?? 1.0,
  };
}

function fromRecord(r: Record<string, any>): MemoryEntry {
  const tags = String(r.tagsStr ?? '').split('|').filter(Boolean);
  let references: string[] = [];
  try { references = JSON.parse(String(r.refsStr ?? '[]')); } catch { /* leave empty */ }
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(String(r.metadataStr ?? '{}')); } catch { /* leave empty */ }

  return {
    id: String(r.id),
    key: String(r.key),
    content: String(r.content),
    type: r.type as any,
    namespace: String(r.namespace),
    ownerId: r.ownerId ? String(r.ownerId) : undefined,
    accessLevel: r.accessLevel as any,
    tags,
    references,
    metadata,
    embedding: undefined, // not round-tripped — re-embed if needed
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    lastAccessedAt: Number(r.lastAccessedAt),
    expiresAt: Number(r.expiresAt) || undefined,
    eventAt: Number(r.eventAt) || undefined,
    version: Number(r.version),
    accessCount: Number(r.accessCount),
    importanceScore: Number(r.importanceScore),
  };
}

function buildFilter(q: MemoryQuery): string {
  const conds: string[] = [];
  if (q.namespace) conds.push(`namespace = ${sqlStr(q.namespace)}`);
  if (q.key) conds.push(`key = ${sqlStr(q.key)}`);
  if (q.keyPrefix) conds.push(`starts_with(key, ${sqlStr(q.keyPrefix)})`);
  if (q.memoryType) conds.push(`type = ${sqlStr(q.memoryType)}`);
  if (q.ownerId) conds.push(`ownerId = ${sqlStr(q.ownerId)}`);
  if (q.tags?.length) {
    for (const t of q.tags) conds.push(`contains(tagsStr, ${sqlStr(`|${t}|`)})`);
  }
  if (q.createdAfter) conds.push(`createdAt >= ${q.createdAfter}`);
  if (q.createdBefore) conds.push(`createdAt <= ${q.createdBefore}`);
  if (q.updatedAfter) conds.push(`updatedAt >= ${q.updatedAfter}`);
  if (q.updatedBefore) conds.push(`updatedAt <= ${q.updatedBefore}`);
  if (q.eventAfter) conds.push(`eventAt >= ${q.eventAfter}`);
  if (q.eventBefore) conds.push(`eventAt <= ${q.eventBefore}`);
  if (!q.includeExpired) conds.push(`(expiresAt = 0 OR expiresAt > ${Date.now()})`);
  return conds.length ? conds.join(' AND ') : '';
}

// ===== Backend =====

export class LanceDBBackend extends EventEmitter implements IMemoryBackend {
  private config: Required<Omit<LanceDBBackendConfig, 'embeddingGenerator'>> & {
    embeddingGenerator?: EmbeddingGenerator;
  };
  private db: any = null;
  // table per namespace, lazy-created
  private tables = new Map<string, any>();
  private ftsBuilt = new Set<string>();
  private initialized = false;
  private queryCount = 0;
  private queryTotalMs = 0;
  private searchCount = 0;
  private searchTotalMs = 0;

  constructor(config: LanceDBBackendConfig = {}) {
    super();
    this.config = {
      dbPath: config.dbPath ?? join(homedir(), '.monomind', 'lancedb'),
      namespace: config.namespace ?? 'default',
      vectorDimension: config.vectorDimension ?? 1536,
      enableFts: config.enableFts ?? false,
      nProbes: config.nProbes ?? 20,
      embeddingGenerator: config.embeddingGenerator,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await ensureLanceDB();
    this.db = await lancedb.connect(this.config.dbPath);
    this.initialized = true;
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    this.tables.clear();
    this.db = null;
    this.initialized = false;
    this.emit('shutdown');
  }

  // ===== Table management =====

  /** Open an existing table. Returns null without creating if the namespace doesn't exist. */
  private async openExistingTable(namespace: string): Promise<any | null> {
    if (this.tables.has(namespace)) return this.tables.get(namespace)!;
    if (!this.initialized || !this.db) throw new Error('LanceDBBackend not initialized — call initialize() first');
    const tableNames: string[] = await this.db.tableNames();
    if (!tableNames.includes(namespace)) return null;
    const table = await this.db.openTable(namespace);
    this.tables.set(namespace, table);
    return table;
  }

  /** Open or create a table — call only from write paths (store, bulkInsert). */
  private async getTable(namespace: string): Promise<any> {
    if (this.tables.has(namespace)) return this.tables.get(namespace)!;
    if (!this.initialized || !this.db) throw new Error('LanceDBBackend not initialized — call initialize() first');

    const tableNames: string[] = await this.db.tableNames();
    let table: any;

    if (tableNames.includes(namespace)) {
      table = await this.db.openTable(namespace);
    } else {
      // Create with a placeholder row so the schema is fully established.
      // The placeholder is deleted immediately after creation.
      const dim = this.config.vectorDimension;
      const placeholder: LanceRecord = {
        id: '__init__',
        key: '__init__',
        content: '',
        type: 'working',
        namespace,
        ownerId: '',
        accessLevel: 'private',
        tagsStr: '||',
        refsStr: '[]',
        metadataStr: '{}',
        vector: new Array(dim).fill(0),
        createdAt: 0,
        updatedAt: 0,
        lastAccessedAt: 0,
        expiresAt: 0,
        eventAt: 0,
        version: 0,
        accessCount: 0,
        importanceScore: 0,
      };
      table = await this.db.createTable(namespace, [placeholder]);
      await table.delete(`id = '__init__'`);
    }

    this.tables.set(namespace, table);
    return table;
  }

  // ===== IMemoryBackend implementation =====

  async store(entry: MemoryEntry): Promise<void> {
    const table = await this.getTable(entry.namespace);
    const record = toRecord(entry, this.config.vectorDimension);

    // Upsert: delete any existing row with same id, then insert
    await table.delete(`id = ${sqlStr(entry.id)}`);
    await table.add([record]);

    // Build FTS index on first real write (LanceDB needs at least 1 row)
    if (this.config.enableFts && !this.ftsBuilt.has(entry.namespace)) {
      try {
        await table.createIndex({
          config: lancedb.Index.fts(['content', 'key']),
        });
        this.ftsBuilt.add(entry.namespace);
      } catch {
        // FTS build is best-effort; search falls back to vector-only
      }
    }

    this.emit('entry:stored', { id: entry.id, namespace: entry.namespace });
  }

  async get(id: string): Promise<MemoryEntry | null> {
    // Search default namespace first, then any other open tables (deduped).
    // openExistingTable is used to avoid creating phantom tables during reads.
    const toSearch = [...new Set([this.config.namespace, ...this.tables.keys()])];
    for (const ns of toSearch) {
      try {
        const table = await this.openExistingTable(ns);
        if (!table) continue;
        const rows = await table.query()
          .where(`id = ${sqlStr(id)}`)
          .limit(1)
          .toArray();
        if (rows.length > 0) return fromRecord(rows[0]);
      } catch { /* ignore per-namespace errors */ }
    }
    return null;
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    try {
      const table = await this.openExistingTable(namespace);
      if (!table) return null;
      const rows = await table.query()
        .where(`namespace = ${sqlStr(namespace)} AND key = ${sqlStr(key)}`)
        .limit(1)
        .toArray();
      return rows.length > 0 ? fromRecord(rows[0]) : null;
    } catch {
      return null;
    }
  }

  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updated: MemoryEntry = {
      ...existing,
      ...(update.content !== undefined && { content: update.content }),
      ...(update.tags !== undefined && { tags: update.tags }),
      ...(update.metadata !== undefined && { metadata: update.metadata }),
      ...(update.accessLevel !== undefined && { accessLevel: update.accessLevel }),
      ...(update.expiresAt !== undefined && { expiresAt: update.expiresAt }),
      ...(update.references !== undefined && { references: update.references }),
      updatedAt: Date.now(),
      version: existing.version + 1,
    };

    await this.store(updated);
    this.emit('entry:updated', { id });
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    // Check existence first — lance.delete() returns void, can't tell if row matched
    const existing = await this.get(id);
    if (!existing) return false;
    try {
      const table = await this.getTable(existing.namespace);
      await table.delete(`id = ${sqlStr(id)}`);
      this.emit('entry:deleted', { id, namespace: existing.namespace });
      return true;
    } catch {
      return false;
    }
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const ns = query.namespace ?? this.config.namespace;
    const t0 = Date.now();
    try {
      const table = await this.openExistingTable(ns);
      if (!table) return [];
      const filter = buildFilter(query);
      let q = table.query();
      if (filter) q = q.where(filter);
      q = q.limit(query.limit ?? 100);
      if (query.offset) q = q.offset(query.offset);

      const rows = await q.toArray();
      this.queryCount++;
      this.queryTotalMs += Date.now() - t0;
      return rows.map(fromRecord);
    } catch {
      return [];
    }
  }

  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    const ns = options.filters?.namespace ?? this.config.namespace;
    const t0 = Date.now();
    try {
      const table = await this.openExistingTable(ns);
      if (!table) return [];
      const queryVector = Array.from(embedding);
      const k = options.k ?? 10;

      // over-fetch for threshold filtering, then trim; single predicate (chaining may overwrite)
      const preFilter = `namespace = ${sqlStr(ns)} AND (expiresAt = 0 OR expiresAt > ${Date.now()})`;
      let q = table.search(queryVector).nprobes(this.config.nProbes).limit(k * 2).where(preFilter);

      const rows = await q.toArray();
      const threshold = options.threshold ?? 0;

      const results: SearchResult[] = rows
        .map((r: Record<string, any>) => {
          // LanceDB _distance: cosine distance (0=identical, 1=orthogonal, 2=opposite)
          const distance = Number(r._distance ?? 0);
          const score = Math.max(0, 1 - distance);
          return { entry: fromRecord(r), score, distance };
        })
        .filter(r => r.score >= threshold)
        .slice(0, k);

      this.searchCount++;
      this.searchTotalMs += Date.now() - t0;
      return results;
    } catch {
      return [];
    }
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    if (!entries.length) return;
    // Group by namespace to minimize table opens
    const byNs = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const list = byNs.get(e.namespace) ?? [];
      list.push(e);
      byNs.set(e.namespace, list);
    }
    const dim = this.config.vectorDimension;
    for (const [ns, group] of byNs) {
      const table = await this.getTable(ns);
      const ids = group.map(e => sqlStr(e.id)).join(', ');
      await table.delete(`id IN (${ids})`);
      await table.add(group.map(e => toRecord(e, dim)));
    }
  }

  async bulkDelete(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const idList = ids.map(sqlStr).join(', ');
    // Count before deleting to get accurate return value (lance.delete returns void)
    let deleted = 0;
    for (const [ns, table] of this.tables) {
      try {
        const before = typeof table.countRows === 'function'
          ? await table.countRows(`id IN (${idList})`)
          : 0; // skip pre-count if API unavailable; return 0 (conservative)
        await table.delete(`id IN (${idList})`);
        deleted += before;
      } catch { /* ignore */ }
    }
    return deleted;
  }

  async count(namespace?: string): Promise<number> {
    const ns = namespace ?? this.config.namespace;
    try {
      const table = await this.openExistingTable(ns);
      if (!table) return 0;
      // countRows() avoids loading all IDs into memory (available in lancedb >= 0.9)
      if (typeof table.countRows === 'function') {
        return await table.countRows(`namespace = ${sqlStr(ns)}`);
      }
      const rows = await table.query()
        .where(`namespace = ${sqlStr(ns)}`)
        .select(['id'])
        .toArray();
      return rows.length;
    } catch {
      return 0;
    }
  }

  async listNamespaces(): Promise<string[]> {
    try {
      return await this.db.tableNames();
    } catch {
      return [];
    }
  }

  async clearNamespace(namespace: string): Promise<number> {
    try {
      const n = await this.count(namespace);
      await this.db.dropTable(namespace);
      this.tables.delete(namespace);
      this.ftsBuilt.delete(namespace);
      return n;
    } catch {
      return 0;
    }
  }

  async getStats(): Promise<BackendStats> {
    const namespaces = await this.listNamespaces();
    const entriesByNamespace: Record<string, number> = {};
    let totalEntries = 0;
    for (const ns of namespaces) {
      const n = await this.count(ns);
      entriesByNamespace[ns] = n;
      totalEntries += n;
    }
    return {
      totalEntries,
      entriesByNamespace,
      entriesByType: {} as any, // groupby query is expensive; omit
      memoryUsage: 0, // Lance manages its own columnar compression
      avgQueryTime: this.queryCount ? this.queryTotalMs / this.queryCount : 0,
      avgSearchTime: this.searchCount ? this.searchTotalMs / this.searchCount : 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const ok = this.initialized && this.db !== null;
    const status = ok ? 'healthy' : 'unhealthy';
    const component = { status, latency: 0 } as any;
    return {
      status,
      components: { storage: component, index: component, cache: component },
      timestamp: Date.now(),
      issues: ok ? [] : ['LanceDB not initialized'],
      recommendations: [],
    };
  }
}
