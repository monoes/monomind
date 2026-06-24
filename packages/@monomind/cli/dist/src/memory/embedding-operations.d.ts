/**
 * Embedding Operations
 * ONNX model loading, embedding generation, and hash-based fallback.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/embedding-operations
 */
/**
 * Lazy load ONNX embedding model
 * Only loads when first embedding is requested
 */
export declare function loadEmbeddingModel(options?: {
    modelPath?: string;
    verbose?: boolean;
}): Promise<{
    success: boolean;
    dimensions: number;
    modelName: string;
    loadTime?: number;
    error?: string;
}>;
/**
 * Generate real embedding for text
 * Uses ONNX model if available, falls back to deterministic hash
 */
export declare function generateEmbedding(text: string): Promise<{
    embedding: number[];
    dimensions: number;
    model: string;
}>;
/**
 * Generate embeddings for multiple texts
 * Uses parallel execution for API-based providers (2-4x faster)
 * Note: Local ONNX inference is CPU-bound, so parallelism has limited benefit
 *
 * @param texts - Array of texts to embed
 * @param options - Batch options
 * @returns Array of embedding results with timing info
 */
export declare function generateBatchEmbeddings(texts: string[], options?: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
}): Promise<{
    results: Array<{
        text: string;
        embedding: number[];
        dimensions: number;
        model: string;
    }>;
    totalTime: number;
    avgTime: number;
}>;
/**
 * Generate deterministic hash-based embedding
 * Not semantic, but deterministic and useful for testing
 */
export declare function generateHashEmbedding(text: string, dimensions: number): number[];
//# sourceMappingURL=embedding-operations.d.ts.map