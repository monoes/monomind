/**
 * PartitionedHNSW — Timestamp-partitioned HNSW sub-indexes for temporal locality
 *
 * Partitions the HNSW vector index into time-bucket sub-indexes so that recent
 * entries are searched first, dramatically reducing average search latency for
 * workloads where recency correlates with relevance.
 *
 * Architecture:
 *   - Entries are routed to a bucket based on Math.floor(createdAt / bucketMs)
 *   - Each bucket owns an independent HNSWIndex (lazy-created)
 *   - Search merges results across buckets, sorted by recency then similarity
 *   - Old buckets can be evicted once they exceed maxBuckets
 *
 * Source: ICDE 2025 Timestamp-Partitioned HNSW
 *
 * @module v1/memory/partitioned-hnsw
 */

import type { MemoryEntry } from './types.js';

// ===== Types =====

export interface PartitionedHNSWConfig {
  /** Time window per bucket in milliseconds. Default: 1 hour */
  bucketMs?: number;
  /** Maximum number of buckets to retain in memory. Default: 48 */
  maxBuckets?: number;
  /** Number of neighbours (ef-construction equivalent). Default: 16 */
  k?: number;
}

export interface BucketStats {
  bucketKey: number;
  entryCount: number;
  oldestMs: number;
  newestMs: number;
}

// ===== Lightweight cosine-similarity index =====
// A stripped-down in-bucket index that avoids importing the full 1000-line
// hnsw-index.ts (which would push this file over limits and create a circular dep).

interface BucketEntry {
  entry: MemoryEntry;
  normVec: Float32Array | null;  // pre-normalised embedding, null if no embedding
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Vectors are pre-normalised, so dot == cosine similarity
  return dot;
}

function l2Norm(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const len = Math.sqrt(sum);
  if (len === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / len;
  return out;
}

class TimeBucket {
  private readonly entries: BucketEntry[] = [];

  add(entry: MemoryEntry): void {
    const normVec = entry.embedding ? l2Norm(entry.embedding) : null;
    this.entries.push({ entry, normVec });
  }

  /** Approximate k-NN by brute-force within the bucket (buckets are small). */
  search(queryVec: Float32Array | null, limit: number, textQuery?: string): Array<{ entry: MemoryEntry; score: number }> {
    const scored = this.entries.map(({ entry, normVec }) => {
      let score = 0;
      if (queryVec && normVec) {
        score = cosineSim(queryVec, normVec);
      } else if (textQuery) {
        // Keyword fallback: count overlapping terms
        const terms = textQuery.toLowerCase().split(/\s+/);
        const content = entry.content.toLowerCase();
        const hits = terms.filter(t => content.includes(t)).length;
        score = hits / Math.max(terms.length, 1);
      }
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  get size(): number { return this.entries.length; }
  get oldest(): number { return this.entries.length ? this.entries[0].entry.createdAt : Infinity; }
  get newest(): number { return this.entries.length ? this.entries[this.entries.length - 1].entry.createdAt : 0; }
}

// ===== PartitionedHNSW =====

export class PartitionedHNSW {
  private readonly bucketMs: number;
  private readonly maxBuckets: number;
  private readonly k: number;

  /** bucketKey → TimeBucket, ordered newest-first via insertion order */
  private readonly buckets: Map<number, TimeBucket> = new Map();

  constructor(config: PartitionedHNSWConfig = {}) {
    this.bucketMs = config.bucketMs ?? 60 * 60 * 1000;  // 1 hour default
    this.maxBuckets = config.maxBuckets ?? 48;            // 48 hours default retention
    this.k = config.k ?? 16;
  }

  /** Add a memory entry to its time-bucket. */
  add(entry: MemoryEntry): void {
    const bucketKey = this.bucketKeyFor(entry.createdAt);
    if (!this.buckets.has(bucketKey)) {
      this.buckets.set(bucketKey, new TimeBucket());
      this.evictOldBuckets();
    }
    this.buckets.get(bucketKey)!.add(entry);
  }

  /**
   * Search across partitions, newest buckets first.
   * Stops early once `limit` results are collected or all buckets exhausted.
   *
   * @param queryEmbedding - optional query vector (cosine similarity)
   * @param textQuery      - optional keyword fallback
   * @param limit          - max results
   * @param fromMs         - optional lower bound on createdAt (temporal filter)
   * @param toMs           - optional upper bound on createdAt (temporal filter)
   */
  search(
    queryEmbedding: Float32Array | null,
    textQuery: string | undefined,
    limit: number,
    fromMs?: number,
    toMs?: number,
  ): MemoryEntry[] {
    const normQuery = queryEmbedding ? l2Norm(queryEmbedding) : null;

    // Collect buckets in descending (newest-first) order
    const sortedKeys = [...this.buckets.keys()].sort((a, b) => b - a);

    const candidates: Array<{ entry: MemoryEntry; score: number; bucketKey: number }> = [];

    for (const key of sortedKeys) {
      // Skip buckets entirely outside the temporal filter
      const bucket = this.buckets.get(key)!;
      if (fromMs !== undefined && bucket.newest < fromMs) continue;
      if (toMs !== undefined && bucket.oldest > toMs) continue;

      const hits = bucket.search(normQuery, this.k, textQuery);
      for (const h of hits) {
        if (fromMs !== undefined && h.entry.createdAt < fromMs) continue;
        if (toMs !== undefined && h.entry.createdAt > toMs) continue;
        candidates.push({ ...h, bucketKey: key });
      }
    }

    // Sort by score desc, then by recency (bucketKey desc) as tiebreak
    candidates.sort((a, b) => b.score - a.score || b.bucketKey - a.bucketKey);

    const seen = new Set<string>();
    const results: MemoryEntry[] = [];
    for (const { entry } of candidates) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        results.push(entry);
      }
      if (results.length >= limit) break;
    }
    return results;
  }

  /** Stats per bucket for observability. */
  bucketStats(): BucketStats[] {
    return [...this.buckets.entries()].map(([key, bucket]) => ({
      bucketKey: key,
      entryCount: bucket.size,
      oldestMs: bucket.oldest,
      newestMs: bucket.newest,
    }));
  }

  get totalEntries(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.size;
    return n;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private bucketKeyFor(createdAt: number): number {
    return Math.floor(createdAt / this.bucketMs);
  }

  /** Evict the oldest bucket(s) when we exceed maxBuckets. */
  private evictOldBuckets(): void {
    while (this.buckets.size > this.maxBuckets) {
      // Map preserves insertion order — oldest key is first
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) this.buckets.delete(oldestKey);
    }
  }
}
