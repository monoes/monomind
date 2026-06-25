/**
 * HNSW Operations + INT8 Quantization + Flash Attention
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/hnsw-operations
 */

import * as fs from 'fs';
import * as path from 'path';

// ADR-053: Lazy import of LanceDB memory bridge
let _bridge: typeof import('./memory-bridge.js') | null | undefined;
async function getBridge(): Promise<typeof import('./memory-bridge.js') | null> {
  if (_bridge === null) return null;
  if (_bridge) return _bridge;
  try {
    _bridge = await import('./memory-bridge.js');
    return _bridge;
  } catch {
    _bridge = null;
    return null;
  }
}

// ============================================================================
// HNSW INDEX SINGLETON (150x faster vector search)
// LanceDB bridge provides ANN search; getHNSWIndex() returns null → pure-JS fallback
// ============================================================================

interface HNSWEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
}

interface HNSWIndex {
  db: any;
  entries: Map<string, HNSWEntry>;
  dimensions: number;
  initialized: boolean;
}

let hnswIndex: HNSWIndex | null = null;
let hnswInitializing = false;

/**
 * Get or create the HNSW index singleton
 * Lazily initializes from SQLite data on first use
 */
export async function getHNSWIndex(options?: {
  dbPath?: string;
  dimensions?: number;
  forceRebuild?: boolean;
}): Promise<HNSWIndex | null> {
  const dimensions = options?.dimensions ?? 384;

  // Return existing index if already initialized
  if (hnswIndex?.initialized && !options?.forceRebuild) {
    return hnswIndex;
  }

  // Prevent concurrent initialization
  if (hnswInitializing) {
    // Wait for initialization to complete (max 5s)
    let waitIterations = 0;
    while (hnswInitializing && waitIterations < 500) {
      await new Promise(resolve => setTimeout(resolve, 10));
      waitIterations++;
    }
    if (hnswInitializing) {
      throw new Error('HNSW initialization timed out after 5s');
    }
    // Init may have failed — return null rather than a non-initialized index object
    return hnswIndex?.initialized ? hnswIndex : null;
  }

  hnswInitializing = true;

  try {
    // Native @monoes/core HNSW (WASM VectorDb) was removed in the lean teardown.
    // This function is kept for callers that check its return value — all callers
    // already handle null by falling back to the pure-JS / brute-force path.
    // The memory bridge (memory-bridge.ts) provides ANN search via LanceDB.

    // Native backend removed — return null so callers use the pure-JS fallback.
    hnswInitializing = false;
    return null;
  } catch {
    hnswInitializing = false;
    return null;
  }
}

/**
 * Save HNSW metadata to disk for persistence
 */
function saveHNSWMetadata(): void {
  if (!hnswIndex?.entries) return;

  try {
    const swarmDir = path.join(process.cwd(), '.swarm');
    const metadataPath = path.join(swarmDir, 'hnsw.metadata.json');
    const metadata = Array.from(hnswIndex.entries.entries());
    const tmp = metadataPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(metadata));
    fs.renameSync(tmp, metadataPath);
  } catch {
    // Silently fail - metadata save is best-effort
  }
}

/**
 * Add entry to HNSW index (with automatic persistence)
 */
export async function addToHNSWIndex(
  id: string,
  embedding: number[],
  entry: HNSWEntry
): Promise<boolean> {
  // ADR-053: Try LanceDB memory bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeAddToHNSW(id, embedding, entry);
    if (bridgeResult === true) return true;
  }

  const index = await getHNSWIndex({ dimensions: embedding.length });
  if (!index) return false;

  try {
    const vector = new Float32Array(embedding);
    await index.db.insert({
      id,
      vector
    });
    index.entries.set(id, entry);

    // Save metadata for persistence (debounced would be better for high-volume)
    saveHNSWMetadata();
    return true;
  } catch {
    return false;
  }
}

/**
 * Search HNSW index (150x faster than brute-force)
 * Returns results sorted by similarity (highest first)
 */
export async function searchHNSWIndex(
  queryEmbedding: number[],
  options?: {
    k?: number;
    namespace?: string;
  }
): Promise<Array<{ id: string; key: string; content: string; score: number; namespace: string }> | null> {
  // ADR-053: Try LanceDB memory bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeSearchHNSW(queryEmbedding, options);
    if (bridgeResult) return bridgeResult;
  }

  const index = await getHNSWIndex({ dimensions: queryEmbedding.length });
  if (!index) return null;

  try {
    const vector = new Float32Array(queryEmbedding);
    const k = options?.k ?? 10;

    // HNSW search returns results with cosine distance (lower = more similar)
    const results = await index.db.search({ vector, k: k * 2 }); // Get extra for filtering

    const filtered: Array<{ id: string; key: string; content: string; score: number; namespace: string }> = [];

    for (const result of results) {
      const entry = index.entries.get(result.id);
      if (!entry) continue;

      // Filter by namespace if specified
      if (options?.namespace && options.namespace !== 'all' && entry.namespace !== options.namespace) {
        continue;
      }

      // Convert cosine distance to similarity score (1 - distance)
      // Cosine distance convention: 0 = identical, 2 = opposite
      const score = 1 - (result.score / 2);

      filtered.push({
        id: entry.id.substring(0, 12),
        key: entry.key || entry.id.substring(0, 15),
        content: entry.content.substring(0, 60) + (entry.content.length > 60 ? '...' : ''),
        score,
        namespace: entry.namespace
      });

      if (filtered.length >= k) break;
    }

    // Sort by score descending (highest similarity first)
    filtered.sort((a, b) => b.score - a.score);

    return filtered;
  } catch {
    return null;
  }
}

/**
 * Get HNSW index status
 */
export function getHNSWStatus(): {
  available: boolean;
  initialized: boolean;
  entryCount: number;
  dimensions: number;
} {
  // ADR-053: If bridge was previously loaded, report availability
  if (_bridge && _bridge !== null) {
    // Bridge is loaded — HNSW-equivalent is available via LanceDB
    return {
      available: true,
      initialized: true,
      entryCount: hnswIndex?.entries.size ?? 0,
      dimensions: hnswIndex?.dimensions ?? 384
    };
  }

  return {
    available: hnswIndex !== null,
    initialized: hnswIndex?.initialized ?? false,
    entryCount: hnswIndex?.entries.size ?? 0,
    dimensions: hnswIndex?.dimensions ?? 384
  };
}

/**
 * Clear the HNSW index (for rebuilding)
 */
export function clearHNSWIndex(): void {
  hnswIndex = null;
}

/**
 * Invalidate the in-memory HNSW cache so the next search rebuilds from DB.
 * Call this after deleting entries that had embeddings to prevent ghost
 * vectors from appearing in search results.
 */
export function rebuildSearchIndex(): void {
  hnswIndex = null;
  hnswInitializing = false;
}

// ============================================================================
// INT8 VECTOR QUANTIZATION (4x memory reduction)
// ============================================================================

/**
 * Quantize a Float32 embedding to Int8 (4x memory reduction)
 * Uses symmetric quantization with scale factor stored per-vector
 *
 * @param embedding - Float32 embedding array
 * @returns Quantized Int8 array with scale factor
 */
export function quantizeInt8(embedding: number[] | Float32Array): {
  quantized: Int8Array;
  scale: number;
  zeroPoint: number;
} {
  const arr = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);

  // Find min/max for symmetric quantization
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }

  // Symmetric quantization: scale = max(|min|, |max|) / 127
  const absMax = Math.max(Math.abs(min), Math.abs(max));
  const scale = absMax / 127 || 1e-10; // Avoid division by zero
  const zeroPoint = 0; // Symmetric quantization

  // Quantize
  const quantized = new Int8Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    // Clamp to [-127, 127] to leave room for potential rounding
    const q = Math.round(arr[i] / scale);
    quantized[i] = Math.max(-127, Math.min(127, q));
  }

  return { quantized, scale, zeroPoint };
}

/**
 * Dequantize Int8 back to Float32
 *
 * @param quantized - Int8 quantized array
 * @param scale - Scale factor from quantization
 * @param zeroPoint - Zero point (usually 0 for symmetric)
 * @returns Float32Array
 */
export function dequantizeInt8(
  quantized: Int8Array,
  scale: number,
  zeroPoint: number = 0
): Float32Array {
  const result = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    result[i] = (quantized[i] - zeroPoint) * scale;
  }
  return result;
}

/**
 * Compute cosine similarity between quantized vectors
 * Faster than dequantizing first
 */
export function quantizedCosineSim(
  a: Int8Array, aScale: number,
  b: Int8Array, bScale: number
): number {
  if (a.length !== b.length) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // Scales cancel out in cosine similarity for normalized vectors
  const mag = Math.sqrt(normA * normB);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * Get quantization statistics for an embedding
 */
export function getQuantizationStats(embedding: number[] | Float32Array): {
  originalBytes: number;
  quantizedBytes: number;
  compressionRatio: number;
} {
  const len = embedding.length;
  const originalBytes = len * 4; // Float32 = 4 bytes
  const quantizedBytes = len + 8; // Int8 = 1 byte + 8 bytes for scale/zeroPoint
  const compressionRatio = originalBytes / quantizedBytes;

  return { originalBytes, quantizedBytes, compressionRatio };
}

// ============================================================================
// FLASH ATTENTION-STYLE BATCH OPERATIONS (V8-Optimized)
// ============================================================================

/**
 * Batch cosine similarity - compute query against multiple vectors
 * Optimized for V8 JIT with typed arrays
 * ~50μs per 1000 vectors (384-dim)
 */
export function batchCosineSim(
  query: Float32Array | number[],
  vectors: (Float32Array | number[])[],
): Float32Array {
  const n = vectors.length;
  const scores = new Float32Array(n);

  if (n === 0 || query.length === 0) return scores;

  // Pre-compute query norm
  let queryNorm = 0;
  for (let i = 0; i < query.length; i++) {
    queryNorm += query[i] * query[i];
  }
  queryNorm = Math.sqrt(queryNorm);
  if (queryNorm === 0) return scores;

  // Compute similarities
  for (let v = 0; v < n; v++) {
    const vec = vectors[v];
    const len = Math.min(query.length, vec.length);
    let dot = 0, vecNorm = 0;

    for (let i = 0; i < len; i++) {
      dot += query[i] * vec[i];
      vecNorm += vec[i] * vec[i];
    }

    vecNorm = Math.sqrt(vecNorm);
    scores[v] = vecNorm === 0 ? 0 : dot / (queryNorm * vecNorm);
  }

  return scores;
}

/**
 * Softmax normalization for attention scores
 * Numerically stable implementation
 */
export function softmaxAttention(scores: Float32Array, temperature: number = 1.0): Float32Array {
  const n = scores.length;
  const result = new Float32Array(n);
  if (n === 0) return result;

  // Find max for numerical stability
  let max = scores[0];
  for (let i = 1; i < n; i++) {
    if (scores[i] > max) max = scores[i];
  }

  // Compute exp and sum
  let sum = 0;
  for (let i = 0; i < n; i++) {
    result[i] = Math.exp((scores[i] - max) / temperature);
    sum += result[i];
  }

  // Normalize
  if (sum > 0) {
    for (let i = 0; i < n; i++) {
      result[i] /= sum;
    }
  }

  return result;
}

/**
 * Top-K selection with partial sort (O(n + k log k))
 * More efficient than full sort for small k
 */
export function topKIndices(scores: Float32Array, k: number): number[] {
  const n = scores.length;
  if (k >= n) {
    // Return all indices sorted by score
    return Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => scores[b] - scores[a]);
  }

  // Build min-heap of size k
  const heap: { idx: number; score: number }[] = [];

  for (let i = 0; i < n; i++) {
    if (heap.length < k) {
      heap.push({ idx: i, score: scores[i] });
      // Bubble up
      let j = heap.length - 1;
      while (j > 0) {
        const parent = Math.floor((j - 1) / 2);
        if (heap[j].score < heap[parent].score) {
          [heap[j], heap[parent]] = [heap[parent], heap[j]];
          j = parent;
        } else break;
      }
    } else if (scores[i] > heap[0].score) {
      // Replace min and heapify down
      heap[0] = { idx: i, score: scores[i] };
      let j = 0;
      while (true) {
        const left = 2 * j + 1, right = 2 * j + 2;
        let smallest = j;
        if (left < k && heap[left].score < heap[smallest].score) smallest = left;
        if (right < k && heap[right].score < heap[smallest].score) smallest = right;
        if (smallest === j) break;
        [heap[j], heap[smallest]] = [heap[smallest], heap[j]];
        j = smallest;
      }
    }
  }

  // Extract and sort descending
  return heap.sort((a, b) => b.score - a.score).map(h => h.idx);
}

/**
 * Flash Attention-style search
 * Combines batch similarity, softmax, and top-k in one pass.
 * Returns indices and attention weights.
 */
export function flashAttentionSearch(
  query: Float32Array | number[],
  vectors: (Float32Array | number[])[],
  options: { k?: number; temperature?: number; threshold?: number } = {}
): { indices: number[]; scores: Float32Array; weights: Float32Array } {
  const { k = 10, temperature = 1.0, threshold = 0 } = options;
  const scores = batchCosineSim(query, vectors);
  const indices = topKIndices(scores, k).filter(i => scores[i] >= threshold);
  const topScores = new Float32Array(indices.map(i => scores[i]));
  const weights = softmaxAttention(topScores, temperature);
  return { indices, scores: topScores, weights };
}
