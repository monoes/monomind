/**
 * INT8 Quantization + batched cosine similarity search
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * The HNSW ANN index itself now lives inside @monoes/memory's
 * SqlBackend.search() (size-gated, built from the real memory_embeddings
 * table, persisted to disk next to the SQLite file) — see
 * memory-bridge.ts's bridgeGetHNSWStatus()/bridgeForceBuildHNSW(). This file
 * used to also maintain a second, separate pure-JS HNSW index reaching
 * directly into a `.swarm/memory.db` that nothing writes to post-rename;
 * that layer queried the wrong database with the wrong schema and was
 * removed rather than fixed in place, since the real search path already
 * covers the same need at the correct layer.
 *
 * @module v1/cli/hnsw-operations
 */

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
// BATCHED COSINE SIMILARITY OPERATIONS (V8-Optimized)
//
// Despite the historical function names below, this is plain batched cosine
// similarity + softmax-weighted top-k selection — not an implementation of
// Flash Attention (a specific fused/tiled GPU kernel technique for
// transformer attention). Naming kept for now to avoid a breaking export
// rename across memory-initializer.ts/index.ts/performance.ts; the comments
// here describe what the code actually does.
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
 * Batched cosine similarity search with softmax-weighted scoring.
 * Combines batch similarity, softmax, and top-k in one pass.
 * Returns indices and normalized weights (not a Flash Attention kernel —
 * see the module-level note above).
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
