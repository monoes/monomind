/**
 * TierManager — Routes memory operations to the correct tier (Task 09)
 *
 * Coordinates short-term (in-memory), long-term (persistent backend),
 * entity (JSON-lines KV), and contextual (session summaries) tiers.
 *
 * @module v1/memory/tier-manager
 */

import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryTier,
  TierManagerConfig,
} from './types.js';
import { createDefaultEntry } from './types.js';
import { ShortTermMemory } from './tiers/short-term.js';
import { EntityMemory } from './tiers/entity.js';
import { ContextualMemory } from './tiers/contextual.js';
import { PartitionedHNSW, type PartitionedHNSWConfig } from './partitioned-hnsw.js';
import { DiskAnnBackend, type DiskAnnBackendConfig } from './diskann-backend.js';

export class TierManager {
  readonly shortTerm: ShortTermMemory;
  readonly entity: EntityMemory;
  readonly contextual: ContextualMemory;

  /** Timestamp-partitioned HNSW for temporally-local semantic search.
   *  Source: ICDE 2025 Timestamp-Partitioned HNSW */
  readonly partitionedIndex: PartitionedHNSW;

  /**
   * Optional DiskANN backend for large-scale ANN search (Tier 4).
   * Activated by passing `diskAnnConfig` to the constructor.
   * Wraps the longTermBackend so all CRUD still flows through the delegate;
   * `search()` uses the disk-resident graph + quantised beam search.
   * Source: arXiv:2305.04359
   */
  readonly diskann?: DiskAnnBackend;

  private readonly longTermBackend: IMemoryBackend;
  private readonly config: TierManagerConfig;

  constructor(
    longTermBackend: IMemoryBackend,
    config: Partial<TierManagerConfig> = {},
    partitionedHNSWConfig: PartitionedHNSWConfig = {},
    diskAnnConfig?: DiskAnnBackendConfig,
  ) {
    this.config = {
      shortTermCapacity: config.shortTermCapacity ?? 500,
      entityStorePath: config.entityStorePath ?? './data/memory/entities.jsonl',
      contextualNamespace: config.contextualNamespace ?? 'contextual-summaries',
      autoFlushOnSessionEnd: config.autoFlushOnSessionEnd ?? true,
    };

    // If diskAnnConfig is supplied, wrap longTermBackend in a DiskAnnBackend.
    // All CRUD still delegates to the original backend; search() uses DiskANN.
    if (diskAnnConfig) {
      const diskannBackend = new DiskAnnBackend(longTermBackend, diskAnnConfig);
      (this as { diskann?: DiskAnnBackend }).diskann = diskannBackend;
      this.longTermBackend = diskannBackend;
    } else {
      this.longTermBackend = longTermBackend;
    }

    this.shortTerm = new ShortTermMemory(this.config.shortTermCapacity);
    this.entity = new EntityMemory(this.config.entityStorePath);
    this.contextual = new ContextualMemory(
      this.longTermBackend,
      this.config.contextualNamespace,
    );
    this.partitionedIndex = new PartitionedHNSW(partitionedHNSWConfig);
  }

  /**
   * Store a memory entry, routing to the correct tier.
   *
   * - `short-term` goes to the in-memory buffer
   * - `long-term` (or unspecified) goes to the persistent backend
   *
   * All entries are also indexed in the timestamp-partitioned HNSW for
   * temporally-local search (ICDE 2025).
   *
   * Returns the generated entry ID.
   */
  async store(input: MemoryEntryInput & { tier?: MemoryTier }): Promise<string> {
    const entry = createDefaultEntry(input);
    const tier = input.tier ?? 'long-term';

    if (tier === 'short-term') {
      this.shortTerm.store(entry);
    } else {
      await this.longTermBackend.store(entry);
    }

    // Index in partitioned HNSW for temporal-locality search
    this.partitionedIndex.add(entry);

    return entry.id;
  }

  /**
   * Merged search across partitioned HNSW, short-term buffer, long-term backend,
   * and (when configured) DiskANN beam search.
   *
   * Order of precedence:
   *  1. Partitioned HNSW (newest buckets first — temporal locality)
   *  2. Short-term in-memory buffer
   *  3. Long-term persistent backend (metadata / hybrid query)
   *  4. DiskANN ANN search — only when diskAnnConfig was supplied; uses a
   *     character-frequency proxy embedding as the query vector (approximation)
   *
   * Results are deduplicated by entry ID.
   */
  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    // 1. Partitioned HNSW — nearest neighbours in recent time buckets first
    const partitionedResults = this.partitionedIndex.search(
      null,         // no raw embedding at this call-site; uses text fallback
      query,
      limit,
    );

    // 2. Short-term results (synchronous)
    const shortResults = this.shortTerm.search(query, limit);

    // 3. Long-term results via the backend query interface
    const longResults = await this.longTermBackend.query({
      type: 'hybrid',
      content: query,
      limit,
    });

    // 4. DiskANN ANN search (activated when diskann is configured)
    //    Uses a character-frequency proxy embedding to drive beam search.
    //    Re-ranking in DiskAnnBackend.search() uses the actual stored embeddings.
    let annEntries: MemoryEntry[] = [];
    if (this.diskann) {
      try {
        const proxyVec = TierManager.textToVec(query);
        const annResults = await this.diskann.search(proxyVec, { k: limit });
        annEntries = annResults.map(r => r.entry);
      } catch {
        // Non-fatal; DiskANN is best-effort
      }
    }

    // Deduplicate by id: partitioned > short-term > long-term > diskann
    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];

    for (const entry of [...partitionedResults, ...shortResults, ...longResults, ...annEntries]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
      if (merged.length >= limit) break;
    }

    return merged;
  }

  /**
   * Derive a fixed-length Float32 proxy embedding from plain text.
   *
   * Maps character byte values into a 128-dimensional L2-normalised vector.
   * This is NOT a semantic embedding — it is solely used to drive DiskANN
   * beam traversal when no real embedding generator is available at this
   * call site.  Quality of DiskANN results improves dramatically when entries
   * are stored with real semantic embeddings.
   */
  private static textToVec(text: string, dims = 128): Float32Array {
    const vec = new Float32Array(dims);
    for (let i = 0; i < text.length; i++) {
      vec[i % dims] += text.charCodeAt(i) / 255;
    }
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dims; i++) vec[i] /= norm;
    return vec;
  }

  /**
   * Flush the short-term buffer into the long-term backend.
   * Returns the number of entries promoted.
   */
  async flushShortTerm(): Promise<number> {
    return this.shortTerm.flush(this.longTermBackend);
  }
}
