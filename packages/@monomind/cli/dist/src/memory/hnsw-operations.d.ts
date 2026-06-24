/**
 * HNSW Operations + INT8 Quantization + Flash Attention
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/hnsw-operations
 */
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
/**
 * Get or create the HNSW index singleton
 * Lazily initializes from SQLite data on first use
 */
export declare function getHNSWIndex(options?: {
    dbPath?: string;
    dimensions?: number;
    forceRebuild?: boolean;
}): Promise<HNSWIndex | null>;
/**
 * Add entry to HNSW index (with automatic persistence)
 */
export declare function addToHNSWIndex(id: string, embedding: number[], entry: HNSWEntry): Promise<boolean>;
/**
 * Search HNSW index (150x faster than brute-force)
 * Returns results sorted by similarity (highest first)
 */
export declare function searchHNSWIndex(queryEmbedding: number[], options?: {
    k?: number;
    namespace?: string;
}): Promise<Array<{
    id: string;
    key: string;
    content: string;
    score: number;
    namespace: string;
}> | null>;
/**
 * Get HNSW index status
 */
export declare function getHNSWStatus(): {
    available: boolean;
    initialized: boolean;
    entryCount: number;
    dimensions: number;
};
/**
 * Clear the HNSW index (for rebuilding)
 */
export declare function clearHNSWIndex(): void;
/**
 * Invalidate the in-memory HNSW cache so the next search rebuilds from DB.
 * Call this after deleting entries that had embeddings to prevent ghost
 * vectors from appearing in search results.
 */
export declare function rebuildSearchIndex(): void;
/**
 * Quantize a Float32 embedding to Int8 (4x memory reduction)
 * Uses symmetric quantization with scale factor stored per-vector
 *
 * @param embedding - Float32 embedding array
 * @returns Quantized Int8 array with scale factor
 */
export declare function quantizeInt8(embedding: number[] | Float32Array): {
    quantized: Int8Array;
    scale: number;
    zeroPoint: number;
};
/**
 * Dequantize Int8 back to Float32
 *
 * @param quantized - Int8 quantized array
 * @param scale - Scale factor from quantization
 * @param zeroPoint - Zero point (usually 0 for symmetric)
 * @returns Float32Array
 */
export declare function dequantizeInt8(quantized: Int8Array, scale: number, zeroPoint?: number): Float32Array;
/**
 * Compute cosine similarity between quantized vectors
 * Faster than dequantizing first
 */
export declare function quantizedCosineSim(a: Int8Array, aScale: number, b: Int8Array, bScale: number): number;
/**
 * Get quantization statistics for an embedding
 */
export declare function getQuantizationStats(embedding: number[] | Float32Array): {
    originalBytes: number;
    quantizedBytes: number;
    compressionRatio: number;
};
/**
 * Batch cosine similarity - compute query against multiple vectors
 * Optimized for V8 JIT with typed arrays
 * ~50μs per 1000 vectors (384-dim)
 */
export declare function batchCosineSim(query: Float32Array | number[], vectors: (Float32Array | number[])[]): Float32Array;
/**
 * Softmax normalization for attention scores
 * Numerically stable implementation
 */
export declare function softmaxAttention(scores: Float32Array, temperature?: number): Float32Array;
/**
 * Top-K selection with partial sort (O(n + k log k))
 * More efficient than full sort for small k
 */
export declare function topKIndices(scores: Float32Array, k: number): number[];
/**
 * Flash Attention-style search
 * Combines batch similarity, softmax, and top-k in one pass.
 * Returns indices and attention weights.
 */
export declare function flashAttentionSearch(query: Float32Array | number[], vectors: (Float32Array | number[])[], options?: {
    k?: number;
    temperature?: number;
    threshold?: number;
}): {
    indices: number[];
    scores: Float32Array;
    weights: Float32Array;
};
export {};
//# sourceMappingURL=hnsw-operations.d.ts.map