/**
 * Flash Attention Implementation for RuVector Intelligence System
 *
 * Implements block-wise attention computation for faster similarity calculations.
 * Achieves O(N) memory instead of O(N^2) through tiling strategy.
 *
 * Key optimizations:
 * - Block-wise computation to fit in L1 cache
 * - Fused softmax-matmul operations
 * - Float32Array for all operations
 * - Online softmax for numerical stability
 *
 * Target: 2-5x speedup on CPU vs naive attention
 *
 * github.com/nokhodian/monomind
 */
export interface FlashAttentionConfig {
    /** Block size for tiling (32-64 optimal for CPU L1 cache) */
    blockSize: number;
    /** Number of dimensions in embedding vectors */
    dimensions: number;
    /** Temperature for softmax scaling */
    temperature: number;
    /** Enable numerical stability optimizations */
    useStableMode: boolean;
    /** Use optimized CPU path (default: true) */
    useCPUOptimizations: boolean;
}
export interface AttentionResult {
    /** Output vectors after attention */
    output: Float32Array[];
    /** Attention weights (optional, for debugging) */
    weights?: Float32Array[];
    /** Computation time in milliseconds */
    computeTimeMs: number;
}
export interface BenchmarkResult {
    /** Naive attention time in milliseconds */
    naiveTimeMs: number;
    /** Flash attention time in milliseconds */
    flashTimeMs: number;
    /** Speedup factor (naive / flash) */
    speedup: number;
    /** Number of vectors benchmarked */
    numVectors: number;
    /** Dimensions of vectors */
    dimensions: number;
    /** Memory usage estimate for naive (bytes) */
    naiveMemoryBytes: number;
    /** Memory usage estimate for flash (bytes) */
    flashMemoryBytes: number;
    /** Memory reduction factor */
    memoryReduction: number;
}
export declare class FlashAttention {
    private config;
    private lastSpeedup;
    private benchmarkHistory;
    private scoreBuffer;
    private expBuffer;
    private accumBuffer;
    constructor(config?: Partial<FlashAttentionConfig>);
    /**
     * Main attention computation using Flash Attention algorithm
     *
     * @param queries - Query vectors [N x D]
     * @param keys - Key vectors [M x D]
     * @param values - Value vectors [M x D]
     * @returns Attention output [N x D]
     */
    attention(queries: Float32Array[], keys: Float32Array[], values: Float32Array[]): AttentionResult;
    /**
     * CPU-optimized attention with aggressive optimizations
     *
     * Key optimizations:
     * - Blocked score computation (better cache utilization)
     * - Top-K sparse attention (only use most relevant keys)
     * - Pre-allocated buffers to avoid GC pressure
     * - 8x loop unrolling for dot products
     * - Fused max-finding during score computation
     */
    private cpuOptimizedAttention;
    /**
     * Partial dot product using only first N dimensions (for screening)
     */
    private partialDotProduct;
    /**
     * Partial sort to get top-K elements (QuickSelect-like)
     * Only ensures first K elements are the largest, not sorted
     */
    private partialSort;
    /**
     * Swap two indices in array
     */
    private swapIndices;
    /**
     * Fast dot product with 8x unrolling
     */
    private fastDotProduct;
    /**
     * Block-wise attention computation (Flash Attention core algorithm)
     *
     * Algorithm:
     * For each block of queries Q_b:
     *   For each block of keys K_b:
     *     S_b = Q_b @ K_b.T / sqrt(d)  // Block scores
     *     P_b = softmax(S_b)           // Block attention
     *     O_b += P_b @ V_b             // Accumulate output
     *
     * @param Q - Query vectors
     * @param K - Key vectors
     * @param V - Value vectors
     * @param blockSize - Block size for tiling
     */
    blockAttention(Q: Float32Array[], K: Float32Array[], V: Float32Array[], blockSize: number): Float32Array[];
    /**
     * Get the speedup factor from the last benchmark
     */
    getSpeedup(): number;
    /**
     * Run benchmark comparing naive vs CPU-optimized attention
     *
     * @param numVectors - Number of vectors to test
     * @param dimensions - Dimensions per vector
     * @param iterations - Number of iterations for averaging
     */
    benchmark(numVectors?: number, dimensions?: number, iterations?: number): BenchmarkResult;
    /**
     * Get benchmark history
     */
    getBenchmarkHistory(): BenchmarkResult[];
    /**
     * Get configuration
     */
    getConfig(): FlashAttentionConfig;
    /**
     * Update configuration
     */
    setConfig(config: Partial<FlashAttentionConfig>): void;
    /**
     * Naive O(N^2) attention implementation for comparison
     */
    private naiveAttention;
    /**
     * Compute block of attention scores
     */
    private computeBlockScores;
    /**
     * Online softmax with output accumulation (key to Flash Attention)
     *
     * Uses the online softmax trick to maintain numerical stability
     * while processing blocks incrementally.
     */
    private onlineSoftmaxAccumulate;
    /**
     * Compute dot product of two vectors
     */
    private dotProduct;
    /**
     * Stable softmax implementation
     */
    private softmax;
    /**
     * Generate random vectors for benchmarking
     */
    private generateRandomVectors;
    /**
     * Validate input arrays
     */
    private validateInputs;
}
/**
 * Get singleton FlashAttention instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns FlashAttention instance
 */
export declare function getFlashAttention(config?: Partial<FlashAttentionConfig>): FlashAttention;
/**
 * Reset singleton (for testing)
 */
export declare function resetFlashAttention(): void;
/**
 * Compute attention using Flash Attention
 */
export declare function computeAttention(queries: Float32Array[], keys: Float32Array[], values: Float32Array[], config?: Partial<FlashAttentionConfig>): AttentionResult;
/**
 * Run Flash Attention benchmark
 */
export declare function benchmarkFlashAttention(numVectors?: number, dimensions?: number, iterations?: number): BenchmarkResult;
/**
 * Get current speedup from last benchmark
 */
export declare function getFlashAttentionSpeedup(): number;
//# sourceMappingURL=flash-attention.d.ts.map