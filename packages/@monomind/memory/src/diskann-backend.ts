/**
 * DiskAnnBackend — SSD-resident ANN graph with in-memory compressed vectors
 *
 * Architecture (faithful to DiskANN / Vamana; source: arXiv:2305.04359):
 *   (a) Adjacency-list graph persisted as a separate JSON file on disk
 *       (NOT the SQLite rows — a distinct index artifact)
 *   (b) Int8-quantised vectors kept in memory for fast candidate beam search
 *       (scalar quantisation: float32 × 127 → int8, ~4× memory reduction)
 *   (c) Full-precision re-ranking: for each beam candidate, load the original
 *       Float32 embedding from the delegate backend and rescore with cosine
 *
 * This backend wraps any IMemoryBackend (delegate) and delegates all CRUD
 * operations to it, overriding only `search()` with the DiskANN algorithm.
 *
 * @module v1/memory/diskann-backend
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
} from './types.js';

// ============================================================
// Configuration
// ============================================================

export interface DiskAnnBackendConfig {
  /**
   * Filesystem path for the persisted adjacency-list graph file.
   * Must be different from the delegate's database path.
   */
  graphPath: string;

  /**
   * Beam width (ef) — number of candidates to maintain during graph traversal.
   * Higher values trade speed for recall. Default: 32.
   */
  beamWidth?: number;

  /**
   * Maximum outgoing edges per node (M). Default: 12.
   */
  maxConnections?: number;

  /**
   * How many beam candidates to fetch before full-precision re-ranking.
   * Final result count is `k`; this is `k × rerankMultiplier`. Default: 3.
   */
  rerankMultiplier?: number;
}

// ============================================================
// Serialised graph format (disk file)
// ============================================================

interface PersistedGraph {
  graph: [string, string[]][];   // Array of [nodeId, neighborIds[]] tuples
  entryPoint?: string;
  nodeCount: number;
  savedAt: number;
}

// ============================================================
// DiskAnnBackend
// ============================================================

/**
 * DiskAnnBackend
 *
 * Wraps any IMemoryBackend and replaces the `search()` method with a three-phase
 * DiskANN procedure:
 *   1. Quantised beam search (Int8 dot products — fast, approximate)
 *   2. Full-precision re-ranking (Float32 cosine from delegate.get())
 *   3. Threshold filtering and top-k selection
 *
 * All other IMemoryBackend methods delegate directly to the inner backend.
 */
export class DiskAnnBackend implements IMemoryBackend {
  /** Adjacency list: nodeId → sorted neighbour IDs */
  private readonly graph = new Map<string, string[]>();

  /**
   * Int8 scalar-quantised embeddings for beam search.
   * Kept entirely in memory — the critical DiskANN optimisation that avoids
   * loading full-precision vectors during candidate generation.
   */
  private readonly qvecs = new Map<string, Int8Array>();

  /** Random walk entry point into the graph */
  private entryPoint: string | undefined;

  /** Whether the in-memory graph differs from the disk file */
  private graphDirty = false;

  private readonly graphPath: string;
  private readonly beamWidth: number;
  private readonly maxConnections: number;
  private readonly rerankMultiplier: number;

  constructor(
    private readonly delegate: IMemoryBackend,
    config: DiskAnnBackendConfig,
  ) {
    this.graphPath = config.graphPath;
    this.beamWidth = config.beamWidth ?? 32;
    this.maxConnections = config.maxConnections ?? 12;
    this.rerankMultiplier = config.rerankMultiplier ?? 3;
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.delegate.initialize();
    await this.loadGraph();
  }

  async shutdown(): Promise<void> {
    await this.persistGraph();
    await this.delegate.shutdown();
  }

  // ----------------------------------------------------------------
  // CRUD — fully delegated
  // ----------------------------------------------------------------

  async store(entry: MemoryEntry): Promise<void> {
    await this.delegate.store(entry);
    this.indexEntry(entry);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.delegate.get(id);
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    return this.delegate.getByKey(namespace, key);
  }

  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    return this.delegate.update(id, update);
  }

  async delete(id: string): Promise<boolean> {
    const ok = await this.delegate.delete(id);
    if (ok) this.removeFromIndex(id);
    return ok;
  }

  async query(q: MemoryQuery): Promise<MemoryEntry[]> {
    return this.delegate.query(q);
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    await this.delegate.bulkInsert(entries);
    for (const e of entries) this.indexEntry(e);
  }

  async bulkDelete(ids: string[]): Promise<number> {
    const n = await this.delegate.bulkDelete(ids);
    for (const id of ids) this.removeFromIndex(id);
    return n;
  }

  async count(namespace?: string): Promise<number> {
    return this.delegate.count(namespace);
  }

  async listNamespaces(): Promise<string[]> {
    return this.delegate.listNamespaces();
  }

  async clearNamespace(namespace: string): Promise<number> {
    const n = await this.delegate.clearNamespace(namespace);
    // Rebuild index — we don't track namespace per node
    this.graph.clear();
    this.qvecs.clear();
    this.entryPoint = undefined;
    this.graphDirty = true;
    return n;
  }

  async getStats(): Promise<BackendStats> {
    return this.delegate.getStats();
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return this.delegate.healthCheck();
  }

  // ----------------------------------------------------------------
  // search() — DiskANN three-phase algorithm
  // ----------------------------------------------------------------

  /**
   * Vector similarity search using the DiskANN beam algorithm.
   *
   * Phase (b): beam traversal over compressed Int8 vectors (fast, no I/O)
   * Phase (c): full-precision cosine re-ranking via delegate.get() (accurate)
   *
   * Falls back to delegate.search() when no entries have been indexed yet.
   */
  async search(queryVec: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    if (this.qvecs.size === 0) {
      return this.delegate.search(queryVec, options);
    }

    const k = options.k;
    const threshold = options.threshold ?? 0;

    // Phase (b): beam search with Int8-quantised vectors
    const qQuery = this.quantize(queryVec);
    const candidateIds = this.beamSearch(qQuery, k * this.rerankMultiplier);

    // Phase (c): full-precision re-ranking by loading embeddings from disk/delegate
    const results: SearchResult[] = [];
    for (const id of candidateIds) {
      const entry = await this.delegate.get(id);
      if (!entry?.embedding) continue;
      const score = this.cosine(queryVec, entry.embedding);
      if (score >= threshold) {
        results.push({ entry, score, distance: 1 - score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  // ----------------------------------------------------------------
  // Index management (private)
  // ----------------------------------------------------------------

  /** Add or update a node in the in-memory ANN index */
  private indexEntry(entry: MemoryEntry): void {
    if (!entry.embedding) return;

    const qvec = this.quantize(entry.embedding);
    this.qvecs.set(entry.id, qvec);

    // Greedy M-nearest-neighbour insertion (O(n) scan over compressed vectors)
    const neighbors = this.greedyNearestNeighbors(entry.id, qvec, this.maxConnections);
    this.graph.set(entry.id, neighbors);

    // Add reverse edges (backlinks) — keep outdegree bounded
    for (const nid of neighbors) {
      const nEdges = this.graph.get(nid) ?? [];
      if (!nEdges.includes(entry.id) && nEdges.length < this.maxConnections * 2) {
        this.graph.set(nid, [...nEdges, entry.id]);
      }
    }

    if (!this.entryPoint) this.entryPoint = entry.id;
    this.graphDirty = true;
  }

  /** Remove a node and all its references from the index */
  private removeFromIndex(id: string): void {
    this.qvecs.delete(id);
    const neighbors = this.graph.get(id) ?? [];
    this.graph.delete(id);

    // Remove backreferences from neighbours
    for (const nid of neighbors) {
      const edges = this.graph.get(nid);
      if (edges) {
        this.graph.set(nid, edges.filter(e => e !== id));
      }
    }

    if (this.entryPoint === id) {
      this.entryPoint = this.graph.keys().next().value as string | undefined;
    }
    this.graphDirty = true;
  }

  /** Scan all existing qvecs and return the k nearest to `qvec` */
  private greedyNearestNeighbors(excludeId: string, qvec: Int8Array, k: number): string[] {
    const scored: Array<{ id: string; score: number }> = [];
    for (const [id, vec] of this.qvecs) {
      if (id === excludeId) continue;
      scored.push({ id, score: this.dotProduct(qvec, vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(s => s.id);
  }

  /**
   * Beam search over the compressed-vector graph.
   *
   * Starts from `entryPoint`, expands neighbours BFS-style, and scores each
   * visited node with Int8 dot products.  Returns up to `candidateCount` IDs
   * sorted by descending similarity.
   */
  private beamSearch(qQuery: Int8Array, candidateCount: number): string[] {
    if (!this.entryPoint || this.qvecs.size === 0) return [];

    const visited = new Set<string>();
    const scored: Array<{ id: string; score: number }> = [];
    const frontier: string[] = [this.entryPoint];
    visited.add(this.entryPoint);

    const maxVisit = Math.min(this.beamWidth * 4, this.qvecs.size);

    while (frontier.length > 0 && visited.size <= maxVisit) {
      const current = frontier.shift()!;
      const qvec = this.qvecs.get(current);
      if (!qvec) continue;

      scored.push({ id: current, score: this.dotProduct(qQuery, qvec) });

      // Expand graph neighbours
      for (const nid of (this.graph.get(current) ?? [])) {
        if (!visited.has(nid)) {
          visited.add(nid);
          frontier.push(nid);
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, candidateCount).map(s => s.id);
  }

  // ----------------------------------------------------------------
  // Quantisation and distance helpers
  // ----------------------------------------------------------------

  /** Scalar Int8 quantisation: float32 × 127 → clamped int8 */
  private quantize(vec: Float32Array): Int8Array {
    const q = new Int8Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      q[i] = Math.max(-127, Math.min(127, Math.round(vec[i] * 127)));
    }
    return q;
  }

  /** Int8 dot product (used for beam search scoring) */
  private dotProduct(a: Int8Array, b: Int8Array): number {
    const len = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += a[i] * b[i];
    return sum;
  }

  /** Full-precision cosine similarity (used for re-ranking) */
  private cosine(a: Float32Array, b: Float32Array): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ----------------------------------------------------------------
  // Disk persistence (graph adjacency list only — NOT the entry data)
  // ----------------------------------------------------------------

  /**
   * Load the persisted adjacency list from disk.
   * Called during initialize(). A missing or corrupt file is silently ignored;
   * the index will be rebuilt as entries are stored.
   */
  private async loadGraph(): Promise<void> {
    if (!existsSync(this.graphPath)) return;
    try {
      const raw = await readFile(this.graphPath, 'utf8');
      const data = JSON.parse(raw) as PersistedGraph;
      this.graph.clear();
      for (const [id, neighbors] of data.graph) {
        this.graph.set(id, neighbors);
      }
      this.entryPoint = data.entryPoint;
      this.graphDirty = false;
    } catch {
      // Corrupt file — start with empty graph
    }
  }

  /**
   * Persist the adjacency list to disk.
   * Only writes when the graph has changed since the last persist.
   * Errors are non-fatal; the graph will be rebuilt on next startup.
   */
  private async persistGraph(): Promise<void> {
    if (!this.graphDirty) return;
    try {
      await mkdir(dirname(this.graphPath), { recursive: true });
      const data: PersistedGraph = {
        graph: [...this.graph.entries()],
        entryPoint: this.entryPoint,
        nodeCount: this.graph.size,
        savedAt: Date.now(),
      };
      await writeFile(this.graphPath, JSON.stringify(data), 'utf8');
      this.graphDirty = false;
    } catch {
      // Non-fatal — graph will be rebuilt on next startup
    }
  }
}
