/**
 * HybridBackend - Combines SQLite (structured queries) + LanceDB (vector search)
 *
 * Per ADR-009: "HybridBackend (SQLite + LanceDB) as default"
 * - SQLite for: Structured queries, ACID transactions, exact matches
 * - LanceDB for: Semantic search, vector similarity, RAG
 *
 * @module v1/memory/hybrid-backend
 */

import { EventEmitter } from 'node:events';
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
  EmbeddingGenerator,
  createDefaultEntry,
  QueryType,
} from './types.js';
import { SQLiteBackend, SQLiteBackendConfig } from './sqlite-backend.js';
import { LanceDBBackend, LanceDBBackendConfig } from './lancedb-backend.js';
import { MemoryGraph } from './memory-graph.js';

/**
 * Configuration for HybridBackend
 */
export interface HybridBackendConfig {
  /** SQLite configuration */
  sqlite?: Partial<SQLiteBackendConfig>;

  /** LanceDB configuration override */

  /**
   * LanceDB configuration (used when semanticBackend is 'lancedb').
   * Requires: npm install @lancedb/lancedb apache-arrow
   */
  lancedb?: LanceDBBackendConfig;

  /** Which backend handles semantic (vector) search. Always 'lancedb'. */
  semanticBackend?: 'lancedb';

  /** Default namespace */
  defaultNamespace?: string;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Query routing strategy */
  routingStrategy?: 'auto' | 'sqlite-first' | 'semantic-first';

  /** Enable dual-write (write to both backends) */
  dualWrite?: boolean;

  /** Semantic search threshold for hybrid queries */
  semanticThreshold?: number;

  /** Maximum results to fetch from each backend in hybrid queries */
  hybridMaxResults?: number;

  /**
   * Filter semantic search results for prompt-injection patterns.
   * When true, entries whose content matches known injection signatures are
   * removed from results and an `injection:blocked` event is emitted.
   * Source: newinnovation.md §5 — Semantic injection detection
   */
  filterInjection?: boolean;

  /**
   * MemoRAG query rewriter — generates 2-3 reformulated sub-queries before HNSW.
   *
   * When provided, `querySemantic()` calls this function on the original query text
   * to produce alternative formulations (e.g. more specific, paraphrased, or
   * keyword-expanded variants). Each sub-query is embedded and searched independently;
   * results are fused using Reciprocal Rank Fusion (RRF).
   *
   * Use a cheap LLM call (Haiku) or a deterministic paraphrase function.
   * Source: arXiv:2409.05591 — MemoRAG (TheWebConf 2025)
   */
  memoragRewriter?: (query: string) => Promise<string[]>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<HybridBackendConfig> = {
  sqlite: {},
  
  lancedb: {},
  semanticBackend: 'lancedb',
  defaultNamespace: 'default',
  embeddingGenerator: undefined as any,
  routingStrategy: 'auto',
  dualWrite: true,
  semanticThreshold: 0.7,
  hybridMaxResults: 100,
  filterInjection: false,
  memoragRewriter: undefined as any,
};

/**
 * Structural prompt-injection patterns for filtering externally-sourced content.
 * Source: arXiv:2302.12173, arXiv:2310.12815 — indirect prompt injection in RAG pipelines.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*prompt\s*[:=]/i,
  /\[\s*system\s*\]/i,
  /\bforget\s+(your\s+)?(previous\s+)?instructions?\b/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?/i,
  /jailbreak/i,
  /\bDAN\b/,
  /<\s*\/?system\s*>/i,
];

/**
 * Structured Query Interface
 * Optimized for SQLite's strengths
 */
export interface StructuredQuery {
  /** Exact key match */
  key?: string;

  /** Key prefix match */
  keyPrefix?: string;

  /** Namespace filter */
  namespace?: string;

  /** Owner filter */
  ownerId?: string;

  /** Type filter */
  type?: string;

  /** Time range filters */
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;

  /** Pagination */
  limit?: number;
  offset?: number;
}

/**
 * Semantic Query Interface
 * Optimized for LanceDB's vector search
 */
export interface SemanticQuery {
  /** Content to search for (will be embedded) */
  content?: string;

  /** Pre-computed embedding */
  embedding?: Float32Array;

  /** Number of results */
  k?: number;

  /** Similarity threshold (0-1) */
  threshold?: number;

  /** Additional filters */
  filters?: Partial<MemoryQuery>;
}

/**
 * Hybrid Query Interface
 * Combines structured + semantic search
 */
export interface HybridQuery {
  /** Semantic component */
  semantic: SemanticQuery;

  /** Structured component */
  structured?: StructuredQuery;

  /** How to combine results */
  combineStrategy?: 'union' | 'intersection' | 'semantic-first' | 'structured-first';

  /** Weights for score combination */
  weights?: {
    semantic: number;
    structured: number;
  };
}

/**
 * HybridBackend Implementation
 *
 * Intelligently routes queries between SQLite and LanceDB:
 * - Exact matches, prefix queries → SQLite
 * - Semantic search, similarity → LanceDB
 * - Complex hybrid queries → Both backends with intelligent merging
 */
export class HybridBackend extends EventEmitter implements IMemoryBackend {
  private sqlite: IMemoryBackend; // SQLiteBackend normally; same as semantic when lancedb solo
  private semantic: IMemoryBackend; // LanceDBBackend
  private config: Required<HybridBackendConfig>;
  private initialized: boolean = false;
  /** Lazy MemoryGraph for HippoRAG PPR re-ranking */
  private memoryGraph: MemoryGraph | null = null;

  // Performance tracking
  private stats = {
    sqliteQueries: 0,
    semanticQueries: 0,
    hybridQueries: 0,
    totalQueryTime: 0,
  };

  constructor(config: HybridBackendConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize semantic backend (LanceDB)
    if (this.config.semanticBackend === 'lancedb') {
      // Solo LanceDB mode: one backend handles all queries (structured + vector).
      // Both this.sqlite and this.semantic point to the same instance so all
      // routing paths (exact/prefix/tag/semantic) transparently use LanceDB.
      // dualWrite forced off to prevent double-writes to the same instance.
      const ldb = new LanceDBBackend({
        ...this.config.lancedb,
        namespace: this.config.defaultNamespace,
        embeddingGenerator: this.config.embeddingGenerator,
      });
      this.semantic = ldb;
      this.sqlite = ldb;
      this.config.dualWrite = false;
    } else {
      this.sqlite = new SQLiteBackend({
        ...this.config.sqlite,
        defaultNamespace: this.config.defaultNamespace,
        embeddingGenerator: this.config.embeddingGenerator,
      });
      this.semantic = new LanceDBBackend({
        ...this.config.lancedb,
        namespace: this.config.defaultNamespace,
        embeddingGenerator: this.config.embeddingGenerator,
      });
    }

    // Forward events (skip duplicate wiring in solo mode)
    const em = (b: IMemoryBackend) => b as unknown as EventEmitter;
    em(this.sqlite).on?.('entry:stored', (d: any) => this.emit('sqlite:stored', d));
    em(this.sqlite).on?.('entry:updated', (d: any) => this.emit('sqlite:updated', d));
    em(this.sqlite).on?.('entry:deleted', (d: any) => this.emit('sqlite:deleted', d));

    if (this.semantic !== this.sqlite) {
      em(this.semantic).on?.('entry:stored', (d: any) => this.emit('semantic:stored', d));
      em(this.semantic).on?.('entry:updated', (d: any) => this.emit('semantic:updated', d));
      em(this.semantic).on?.('entry:deleted', (d: any) => this.emit('semantic:deleted', d));
      em(this.semantic).on?.('cache:hit', (d: any) => this.emit('cache:hit', d));
      em(this.semantic).on?.('cache:miss', (d: any) => this.emit('cache:miss', d));
    }
  }

  /**
   * Initialize both backends
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const inits = this.semantic === this.sqlite
      ? [this.semantic.initialize()]
      : [this.sqlite.initialize(), this.semantic.initialize()];
    await Promise.all(inits);

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown both backends
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    const shutdowns = this.semantic === this.sqlite
      ? [this.semantic.shutdown()]
      : [this.sqlite.shutdown(), this.semantic.shutdown()];
    await Promise.all(shutdowns);

    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Store in both backends (dual-write for consistency).
   *
   * A-MEM auto-linking: after writing, HNSW-searches for the top-3 most similar
   * existing entries and adds bidirectional `references` edges between them and
   * the new entry.  Only runs when an `embeddingGenerator` is configured.
   * Source: arXiv:2409.11987 (A-MEM — Zettelkasten-style agent memory)
   */
  async store(entry: MemoryEntry): Promise<void> {
    if (this.config.dualWrite) {
      // Write to both backends in parallel
      await Promise.all([this.sqlite.store(entry), this.semantic.store(entry)]);
    } else {
      // Write to primary backend only
      await this.semantic.store(entry);
    }

    this.emit('entry:stored', { id: entry.id });

    // A-MEM: auto-link to top-3 semantic neighbors (non-blocking, best-effort)
    if (typeof this.config.embeddingGenerator === 'function' && entry.content) {
      this.aMemAutoLink(entry).catch(() => {
        // Linking is best-effort; storage already succeeded
      });
    }
  }

  /**
   * A-MEM bidirectional reference linking.
   * Finds the top-3 semantically similar existing entries and creates
   * `references` edges in both directions.
   */
  private async aMemAutoLink(newEntry: MemoryEntry): Promise<void> {
    try {
      const embedding = await this.config.embeddingGenerator!(newEntry.content!);
      const neighbors = await this.semantic.search(embedding, {
        k: 4, // fetch 4 to exclude self
        threshold: 0.75,
      });

      const topNeighbors = neighbors
        .filter(r => r.entry.id !== newEntry.id)
        .slice(0, 3);

      if (topNeighbors.length === 0) return;

      const neighborIds = topNeighbors.map(r => r.entry.id);

      // Update new entry to reference neighbors
      const newRefs = [...new Set([...(newEntry.references ?? []), ...neighborIds])];
      await this.update(newEntry.id, { references: newRefs });

      // Update each neighbor to back-reference the new entry
      await Promise.all(
        topNeighbors.map(async ({ entry: neighbor }) => {
          const backRefs = [...new Set([...(neighbor.references ?? []), newEntry.id])];
          await this.update(neighbor.id, { references: backRefs });
        }),
      );

      this.emit('amem:linked', { id: newEntry.id, linkedTo: neighborIds });
    } catch {
      // Linking is best-effort
    }
  }

  /**
   * Get from semantic backend.
   *
   * Collaborative memory promotion: when `agentId` is supplied, also notifies
   * the SQLite backend so it can track the read and promote the entry's
   * AccessLevel to 'team' once 3+ distinct agents have accessed it.
   * Source: newinnovation.md §2.7 — memory access-level promotion.
   */
  async get(id: string, agentId?: string): Promise<MemoryEntry | null> {
    const entry = await this.semantic.get(id);

    // Track the read in SQLite for collaborative promotion (best-effort, non-blocking).
    // Skipped in solo-lancedb mode since this.sqlite === this.semantic (already fetched above).
    if (agentId && entry && this.semantic !== this.sqlite) {
      (this.sqlite as any).get(id, agentId).catch(() => { /* non-critical */ });
    }

    return entry;
  }

  /**
   * Get by key (SQLite optimized for exact matches)
   */
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    return this.sqlite.getByKey(namespace, key);
  }

  /**
   * Update in both backends
   */
  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    if (this.config.dualWrite) {
      // Update both backends
      const [sqliteResult, semanticResult] = await Promise.all([
        this.sqlite.update(id, update),
        this.semantic.update(id, update),
      ]);
      return semanticResult || sqliteResult;
    } else {
      return this.semantic.update(id, update);
    }
  }

  /**
   * Delete from both backends
   */
  async delete(id: string): Promise<boolean> {
    if (this.config.dualWrite) {
      const [sqliteResult, semanticResult] = await Promise.all([
        this.sqlite.delete(id),
        this.semantic.delete(id),
      ]);
      return sqliteResult || semanticResult;
    } else {
      return this.semantic.delete(id);
    }
  }

  /**
   * Query routing — semantic goes to LanceDB, structured to SQLite
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const startTime = performance.now();

    let results: MemoryEntry[];

    // Route based on query type
    switch (query.type) {
      case 'exact':
        // SQLite optimized for exact matches
        this.stats.sqliteQueries++;
        results = await this.sqlite.query(query);
        break;

      case 'prefix':
        // SQLite optimized for prefix queries
        this.stats.sqliteQueries++;
        results = await this.sqlite.query(query);
        break;

      case 'tag':
        // Both can handle tags, use SQLite for structured filtering
        this.stats.sqliteQueries++;
        results = await this.sqlite.query(query);
        break;

      case 'semantic':
        // LanceDB handles semantic search
        this.stats.semanticQueries++;
        results = await this.semantic.query(query);
        break;

      case 'hybrid':
        // Use hybrid query combining both backends
        this.stats.hybridQueries++;
        results = await this.queryHybridInternal(query);
        break;

      default:
        // Auto-routing based on query properties
        results = await this.autoRoute(query);
    }

    const duration = performance.now() - startTime;
    this.stats.totalQueryTime += duration;

    this.emit('query:completed', { type: query.type, duration, count: results.length });
    return results;
  }

  /**
   * Structured queries (SQL)
   * Routes to SQLite for optimal performance
   */
  async queryStructured(query: StructuredQuery): Promise<MemoryEntry[]> {
    this.stats.sqliteQueries++;

    const memoryQuery: MemoryQuery = {
      type: query.key ? 'exact' : query.keyPrefix ? 'prefix' : 'hybrid',
      key: query.key,
      keyPrefix: query.keyPrefix,
      namespace: query.namespace,
      ownerId: query.ownerId,
      memoryType: query.type as any,
      createdAfter: query.createdAfter,
      createdBefore: query.createdBefore,
      updatedAfter: query.updatedAfter,
      updatedBefore: query.updatedBefore,
      limit: query.limit || 100,
      offset: query.offset || 0,
    };

    return this.sqlite.query(memoryQuery);
  }

  /**
   * Apply injection filtering and structured field filters to a set of entries.
   * Used by the MemoRAG path (RRF-fused results) and as a shared post-processing step.
   */
  private postProcessSemanticResults(entries: MemoryEntry[], query: SemanticQuery): MemoryEntry[] {
    let result = entries;

    if (this.config.filterInjection) {
      result = result.filter(entry => {
        const content = entry.content ?? '';
        if (INJECTION_PATTERNS.some(rx => rx.test(content))) {
          this.emit('injection:blocked', { id: entry.id, namespace: entry.namespace });
          return false;
        }
        return true;
      });
    }

    if (query.filters) {
      const f = query.filters as Record<string, unknown>;
      if (f.tags && Array.isArray(f.tags)) {
        const requiredTags = f.tags as string[];
        result = result.filter(e => requiredTags.every(t => e.tags.includes(t)));
      }
      if (f.namespace && typeof f.namespace === 'string') {
        result = result.filter(e => e.namespace === f.namespace);
      }
      if (f.type && typeof f.type === 'string' && f.type !== 'semantic') {
        result = result.filter(e => e.type === f.type);
      }
    }

    return result.slice(0, query.k || 10);
  }

  /**
   * Reciprocal Rank Fusion — merge multiple ranked result lists.
   * Score for entry i in list j: 1 / (k + rank_j(i))  where k=60 (standard).
   * Source: Cormack et al., "Reciprocal Rank Fusion outperforms Condorcet and individual
   * Rank Learning Methods" (SIGIR 2009). Used by MemoRAG sub-query fusion.
   */
  private rrfFuse(rankedLists: MemoryEntry[][], k = 60): MemoryEntry[] {
    const scores = new Map<string, number>();
    const byId = new Map<string, MemoryEntry>();

    for (const list of rankedLists) {
      for (let rank = 0; rank < list.length; rank++) {
        const entry = list[rank];
        byId.set(entry.id, entry);
        scores.set(entry.id, (scores.get(entry.id) ?? 0) + 1 / (k + rank + 1));
      }
    }

    return [...byId.keys()]
      .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
      .map(id => byId.get(id)!);
  }

  /**
   * Semantic queries (vector)
   * Routes to semantic backend for ANN vector search.
   *
   * MemoRAG query rewriting (arXiv:2409.05591): when `memoragRewriter` is configured
   * and `query.content` is present, generates 2-3 reformulated sub-queries, embeds
   * each, searches HNSW independently, then fuses with Reciprocal Rank Fusion (RRF)
   * before HippoRAG PPR re-ranking.
   */
  async querySemantic(query: SemanticQuery): Promise<MemoryEntry[]> {
    this.stats.semanticQueries++;

    let searchResults: SearchResult[] = [];

    // MemoRAG: expand the query into multiple sub-queries for richer recall
    let memoragUsed = false;
    if (query.content && typeof this.config.memoragRewriter === 'function') {
      try {
        const subQueries = await this.config.memoragRewriter(query.content);
        if (subQueries.length > 0) {
          // Embed all sub-queries and search in parallel
          const subResults = await Promise.all(
            subQueries.map(async (sq) => {
              if (!this.config.embeddingGenerator) return [];
              const sqEmbedding = await this.config.embeddingGenerator(sq);
              const results = await this.semantic.search(sqEmbedding, {
                k: (query.k || 10) * 2,
                threshold: query.threshold || this.config.semanticThreshold,
                filters: query.filters as MemoryQuery | undefined,
              });
              return results.map(r => r.entry);
            }),
          );
          this.emit('memorag:rewritten', { original: query.content, subQueries, count: subResults.flat().length });
          // RRF-fuse the sub-query results; assign to searchResults to fall through to PPR/GraphRAG
          const fused = this.rrfFuse(subResults);
          searchResults = fused.map(entry => ({ entry, score: 1.0, distance: 0 }));
          memoragUsed = true;
        }
      } catch {
        // Rewriter failed — fall through to standard path
      }
    }

    if (!memoragUsed) {
      let embedding = query.embedding;

      // Generate embedding if content provided
      if (!embedding && query.content && this.config.embeddingGenerator) {
        embedding = await this.config.embeddingGenerator(query.content);
      }

      if (!embedding) {
        throw new Error('SemanticQuery requires either content or embedding');
      }

      searchResults = await this.semantic.search(embedding, {
        k: (query.k || 10) * 2, // Over-fetch to account for post-filtering
        threshold: query.threshold || this.config.semanticThreshold,
        filters: query.filters as MemoryQuery | undefined,
      });
    }

    // HippoRAG PPR re-ranking: expand one hop through MemoryEntry.references
    // Source: https://arxiv.org/abs/2405.14831
    let entries: MemoryEntry[];
    if (searchResults.length > 0) {
      if (!this.memoryGraph) {
        this.memoryGraph = new MemoryGraph();
        // Seed graph with reference edges from search results
        for (const r of searchResults) {
          this.memoryGraph.addNode(r.entry);
          for (const refId of (r.entry.references ?? [])) {
            this.memoryGraph.addEdge(r.entry.id, refId, 'reference', 1.0);
          }
        }
      } else {
        for (const r of searchResults) {
          this.memoryGraph.addNode(r.entry);
          for (const refId of (r.entry.references ?? [])) {
            this.memoryGraph.addEdge(r.entry.id, refId, 'reference', 1.0);
          }
        }
      }
      // GraphRAG: compute community summaries before PPR so communities are populated.
      // Community summaries are prepended to each entry's metadata so downstream callers
      // can use global thematic context alongside local vector similarity.
      // Source: https://arxiv.org/abs/2404.16130 (Microsoft GraphRAG)
      const communitySummaries = this.memoryGraph.getCommunitySummaries(5);
      // Build a nodeId → community summary lookup for O(1) annotation
      const nodeToSummary = new Map<string, { communityId: string; nodeCount: number; avgPageRank: number }>();
      for (const summary of communitySummaries) {
        for (const nodeId of summary.topNodeIds) {
          nodeToSummary.set(nodeId, {
            communityId: summary.communityId,
            nodeCount: summary.nodeCount,
            avgPageRank: summary.avgPageRank,
          });
        }
      }

      const reranked = await this.memoryGraph.pprRerank(searchResults, this.semantic);
      // Annotate each entry with its community ID and summary from GraphRAG
      entries = reranked.map((r) => {
        const commSummary = nodeToSummary.get(r.entry.id);
        const community = r.community ?? commSummary?.communityId;
        if (!community && !commSummary) return r.entry;
        return {
          ...r.entry,
          metadata: {
            ...(r.entry.metadata ?? {}),
            community,
            ...(commSummary ? {
              communityNodeCount: commSummary.nodeCount,
              communityAvgPageRank: commSummary.avgPageRank,
            } : {}),
          },
        };
      });
    } else {
      entries = searchResults.map((r) => r.entry);
    }

    // Injection filter: remove entries whose content matches known injection signatures
    if (this.config.filterInjection) {
      const safe: MemoryEntry[] = [];
      for (const entry of entries) {
        const content = entry.content ?? '';
        if (INJECTION_PATTERNS.some(rx => rx.test(content))) {
          this.emit('injection:blocked', { id: entry.id, namespace: entry.namespace });
        } else {
          safe.push(entry);
        }
      }
      entries = safe;
    }

    // Apply tag/namespace/type filters
    if (query.filters) {
      const f = query.filters as Record<string, unknown>;
      if (f.tags && Array.isArray(f.tags)) {
        const requiredTags = f.tags as string[];
        entries = entries.filter((e) =>
          requiredTags.every((t) => e.tags.includes(t))
        );
      }
      if (f.namespace && typeof f.namespace === 'string') {
        entries = entries.filter((e) => e.namespace === f.namespace);
      }
      if (f.type && typeof f.type === 'string' && f.type !== 'semantic') {
        entries = entries.filter((e) => e.type === f.type);
      }
    }

    return entries.slice(0, query.k || 10);
  }

  /**
   * Hybrid queries (combine both)
   * Intelligently merges results from both backends
   */
  async queryHybrid(query: HybridQuery): Promise<MemoryEntry[]> {
    this.stats.hybridQueries++;

    const strategy = query.combineStrategy || 'semantic-first';
    const weights = query.weights || { semantic: 0.7, structured: 0.3 };

    // Execute both queries in parallel
    const [semanticResults, structuredResults] = await Promise.all([
      this.querySemantic(query.semantic),
      query.structured ? this.queryStructured(query.structured) : Promise.resolve([]),
    ]);

    // Combine results based on strategy
    switch (strategy) {
      case 'union':
        return this.combineUnion(semanticResults, structuredResults);

      case 'intersection':
        return this.combineIntersection(semanticResults, structuredResults);

      case 'semantic-first':
        return this.combineSemanticFirst(semanticResults, structuredResults);

      case 'structured-first':
        return this.combineStructuredFirst(semanticResults, structuredResults);

      default:
        return this.combineUnion(semanticResults, structuredResults);
    }
  }

  /**
   * Semantic vector search (routes to LanceDB)
   */
  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    this.stats.semanticQueries++;
    return this.semantic.search(embedding, options);
  }

  /**
   * Bulk insert to both backends
   */
  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    if (this.config.dualWrite) {
      await Promise.all([this.sqlite.bulkInsert(entries), this.semantic.bulkInsert(entries)]);
    } else {
      await this.semantic.bulkInsert(entries);
    }
  }

  /**
   * Bulk delete from both backends
   */
  async bulkDelete(ids: string[]): Promise<number> {
    if (this.config.dualWrite) {
      const [sqliteCount, semanticCount] = await Promise.all([
        this.sqlite.bulkDelete(ids),
        this.semantic.bulkDelete(ids),
      ]);
      return Math.max(sqliteCount, semanticCount);
    } else {
      return this.semantic.bulkDelete(ids);
    }
  }

  /**
   * Count entries (use SQLite for efficiency)
   */
  async count(namespace?: string): Promise<number> {
    return this.sqlite.count(namespace);
  }

  /**
   * List namespaces (use SQLite)
   */
  async listNamespaces(): Promise<string[]> {
    return this.sqlite.listNamespaces();
  }

  /**
   * Clear namespace in both backends
   */
  async clearNamespace(namespace: string): Promise<number> {
    if (this.config.dualWrite) {
      const [sqliteCount, semanticCount] = await Promise.all([
        this.sqlite.clearNamespace(namespace),
        this.semantic.clearNamespace(namespace),
      ]);
      return Math.max(sqliteCount, semanticCount);
    } else {
      return this.semantic.clearNamespace(namespace);
    }
  }

  /**
   * Get combined statistics from both backends
   */
  async getStats(): Promise<BackendStats> {
    const solo = this.semantic === this.sqlite;
    const [sqliteStats, semanticStats] = await Promise.all([
      solo ? Promise.resolve(null as any) : this.sqlite.getStats(),
      this.semantic.getStats(),
    ]);

    return {
      totalEntries: solo ? semanticStats.totalEntries : Math.max(sqliteStats.totalEntries, semanticStats.totalEntries),
      entriesByNamespace: semanticStats.entriesByNamespace,
      entriesByType: semanticStats.entriesByType,
      memoryUsage: solo ? semanticStats.memoryUsage : sqliteStats.memoryUsage + semanticStats.memoryUsage,
      hnswStats: semanticStats.hnswStats ?? {
        vectorCount: 0,          // 0 = no active HNSW index; do not fabricate from totalEntries
        memoryUsage: 0,
        avgSearchTime: 0,
        buildTime: 0,
        compressionRatio: 1.0,
      },
      cacheStats: (semanticStats as any).cacheStats ?? {
        hitRate: 0,
        size: 0,
        maxSize: 1000,
      },
      avgQueryTime:
        this.stats.hybridQueries + this.stats.sqliteQueries + this.stats.semanticQueries > 0
          ? this.stats.totalQueryTime /
            (this.stats.hybridQueries + this.stats.sqliteQueries + this.stats.semanticQueries)
          : 0,
      avgSearchTime: semanticStats.avgSearchTime,
    };
  }

  /**
   * Health check for both backends
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const solo = this.semantic === this.sqlite;
    const [sqliteHealth, semanticHealth] = await Promise.all([
      solo ? Promise.resolve({ status: 'healthy', issues: [], recommendations: [], components: {} as any, timestamp: Date.now() } as HealthCheckResult) : this.sqlite.healthCheck(),
      this.semantic.healthCheck(),
    ]);

    const allIssues = [...sqliteHealth.issues, ...semanticHealth.issues];
    const allRecommendations = [
      ...sqliteHealth.recommendations,
      ...semanticHealth.recommendations,
    ];

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (
      sqliteHealth.status === 'unhealthy' ||
      semanticHealth.status === 'unhealthy'
    ) {
      status = 'unhealthy';
    } else if (
      sqliteHealth.status === 'degraded' ||
      semanticHealth.status === 'degraded'
    ) {
      status = 'degraded';
    }

    return {
      status,
      components: {
        storage: sqliteHealth.components.storage,
        index: semanticHealth.components.index,
        cache: semanticHealth.components.cache,
      },
      timestamp: Date.now(),
      issues: allIssues,
      recommendations: allRecommendations,
    };
  }

  // ===== Private Methods =====

  /**
   * Auto-route queries based on properties
   */
  private async autoRoute(query: MemoryQuery): Promise<MemoryEntry[]> {
    // If has embedding or content, use semantic search (LanceDB)
    const hasEmbeddingGenerator = typeof this.config.embeddingGenerator === 'function';
    if (query.embedding || (query.content && hasEmbeddingGenerator)) {
      this.stats.semanticQueries++;
      return this.semantic.query(query);
    }

    // If has exact key or prefix, use structured search (SQLite)
    if (query.key || query.keyPrefix) {
      this.stats.sqliteQueries++;
      return this.sqlite.query(query);
    }

    // For other filters, use routing strategy
    switch (this.config.routingStrategy) {
      case 'sqlite-first':
        this.stats.sqliteQueries++;
        return this.sqlite.query(query);

      case 'semantic-first':
        this.stats.semanticQueries++;
        return this.semantic.query(query);

      case 'auto':
      default:
        // Default to semantic backend (LanceDB)
        this.stats.semanticQueries++;
        return this.semantic.query(query);
    }
  }

  /**
   * Internal hybrid query implementation
   */
  private async queryHybridInternal(query: MemoryQuery): Promise<MemoryEntry[]> {
    // If semantic component exists, use hybrid
    if (query.embedding || query.content) {
      const semanticQuery: SemanticQuery = {
        content: query.content,
        embedding: query.embedding,
        k: query.limit || 10,
        threshold: query.threshold,
        filters: query,
      };

      const structuredQuery: StructuredQuery = {
        namespace: query.namespace,
        key: query.key,
        keyPrefix: query.keyPrefix,
        ownerId: query.ownerId,
        type: query.memoryType,
        createdAfter: query.createdAfter,
        createdBefore: query.createdBefore,
        updatedAfter: query.updatedAfter,
        updatedBefore: query.updatedBefore,
        limit: query.limit,
        offset: query.offset,
      };

      return this.queryHybrid({
        semantic: semanticQuery,
        structured: structuredQuery,
        combineStrategy: 'semantic-first',
      });
    }

    // Otherwise, route to structured
    return this.autoRoute(query);
  }

  /**
   * Combine results using union (all unique results)
   */
  private combineUnion(
    semanticResults: MemoryEntry[],
    structuredResults: MemoryEntry[]
  ): MemoryEntry[] {
    const seen = new Set<string>();
    const combined: MemoryEntry[] = [];

    for (const entry of semanticResults) {
      if (!seen.has(entry.id)) { seen.add(entry.id); combined.push(entry); }
    }
    for (const entry of structuredResults) {
      if (!seen.has(entry.id)) { seen.add(entry.id); combined.push(entry); }
    }

    return combined;
  }

  /**
   * Combine results using intersection (only common results)
   */
  private combineIntersection(
    semanticResults: MemoryEntry[],
    structuredResults: MemoryEntry[]
  ): MemoryEntry[] {
    const semanticIds = new Set(semanticResults.map((e) => e.id));
    return structuredResults.filter((e) => semanticIds.has(e.id));
  }

  /**
   * Semantic-first: Prefer semantic results, add structured if not present
   */
  private combineSemanticFirst(
    semanticResults: MemoryEntry[],
    structuredResults: MemoryEntry[]
  ): MemoryEntry[] {
    const semanticIds = new Set<string>();
    for (const e of semanticResults) semanticIds.add(e.id);
    const additional = structuredResults.filter((e) => !semanticIds.has(e.id));
    return [...semanticResults, ...additional];
  }

  /**
   * Structured-first: Prefer structured results, add semantic if not present
   */
  private combineStructuredFirst(
    semanticResults: MemoryEntry[],
    structuredResults: MemoryEntry[]
  ): MemoryEntry[] {
    const structuredIds = new Set<string>();
    for (const e of structuredResults) structuredIds.add(e.id);
    const additional = semanticResults.filter((e) => !structuredIds.has(e.id));
    return [...structuredResults, ...additional];
  }

  // ===== Proxy Methods — stubs for legacy controller API =====

  /**
   * Record feedback for a memory entry.
   * Delegates to semantic backend's recordFeedback when available.
   * Gracefully degrades to no-op when unavailable.
   */
  async recordFeedback(
    _entryId: string,
    _feedback: { score: number; label?: string; context?: Record<string, unknown> },
  ): Promise<boolean> {
    return false; // monolean: stub — LanceDB has no feedback API
  }

  async verifyWitnessChain(_entryId: string): Promise<{
    valid: boolean;
    chainLength: number;
    errors: string[];
  }> {
    return { valid: false, chainLength: 0, errors: ['not supported by LanceDB backend'] };
  }

  async getWitnessChain(_entryId: string): Promise<Array<{
    hash: string;
    timestamp: number;
    operation: string;
  }>> {
    return [];
  }

  // ===== Backend Access =====

  /**
   * Get underlying backends for advanced operations
   */
  getSQLiteBackend(): IMemoryBackend {
    return this.sqlite;
  }

  getSemanticBackend(): IMemoryBackend {
    return this.semantic;
  }
}

export default HybridBackend;
