/**
 * Vector Database Module
 *
 * Provides optional ruvector WASM-accelerated vector operations for:
 * - Semantic similarity search
 * - HNSW indexing (150x faster)
 * - Embedding generation
 *
 * Gracefully degrades when ruvector is not installed.
 *
 * github.com/nokhodian/monomind
 */
export interface VectorDB {
    insert(embedding: Float32Array, id: string, metadata?: Record<string, unknown>): void | Promise<void>;
    search(query: Float32Array, k?: number): Array<{
        id: string;
        score: number;
        metadata?: Record<string, unknown>;
    }> | Promise<Array<{
        id: string;
        score: number;
        metadata?: Record<string, unknown>;
    }>>;
    remove(id: string): boolean | Promise<boolean>;
    size(): number | Promise<number>;
    clear(): void | Promise<void>;
}
export interface RuVectorModule {
    createVectorDB(dimensions: number): Promise<VectorDB>;
    generateEmbedding(text: string, dimensions?: number): Float32Array;
    cosineSimilarity(a: Float32Array, b: Float32Array): number;
    isWASMAccelerated(): boolean;
}
/**
 * Attempt to load the ruvector module
 * Returns true if successfully loaded, false otherwise
 */
export declare function loadRuVector(): Promise<boolean>;
/**
 * Check if ruvector is available
 */
export declare function isRuVectorAvailable(): boolean;
/**
 * Check if WASM acceleration is enabled
 */
export declare function isWASMAccelerated(): boolean;
/**
 * Create a vector database
 * Uses ruvector HNSW if available, falls back to brute-force search
 */
export declare function createVectorDB(dimensions?: number): Promise<VectorDB>;
/**
 * Generate an embedding for text
 * Uses ruvector if available, falls back to hash-based embedding
 */
export declare function generateEmbedding(text: string, dimensions?: number): Float32Array;
/**
 * Compute cosine similarity between two vectors
 */
export declare function computeSimilarity(a: Float32Array, b: Float32Array): number;
/**
 * Get status information about the ruvector module
 */
export declare function getStatus(): {
    available: boolean;
    wasmAccelerated: boolean;
    backend: 'ruvector-wasm' | 'ruvector' | 'fallback';
};
//# sourceMappingURL=vector-db.d.ts.map