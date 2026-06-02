/* tslint:disable */
/* eslint-disable */

/**
 * Feedback for per-request adaptation.
 *
 * Provides quality scores and optional gradient estimates to guide
 * LoRA weight updates.
 */
export class AdaptFeedbackWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create new feedback with quality score [0.0, 1.0].
     */
    constructor(quality: number);
    /**
     * Get learning rate.
     */
    learningRate: number;
    /**
     * Get quality score.
     */
    quality: number;
}

/**
 * Buffer pool for efficient memory reuse.
 */
export class BufferPoolWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Clear all pooled buffers.
     */
    clear(): void;
    /**
     * Create a new buffer pool with default settings.
     */
    constructor();
    /**
     * Pre-warm the pool by allocating buffers.
     */
    prewarmAll(count_per_class: number): void;
    /**
     * Get pool statistics as JSON.
     */
    statsJson(): string;
    /**
     * Create with specified max buffers per size class.
     */
    static withCapacity(max_buffers_per_class: number): BufferPoolWasm;
    /**
     * Get the hit rate (0.0 - 1.0).
     */
    readonly hitRate: number;
}

/**
 * Chat message for instruction-tuned models.
 *
 * Used to construct conversations for chat-based inference.
 */
export class ChatMessageWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create an assistant message.
     */
    static assistant(content: string): ChatMessageWasm;
    /**
     * Create a system message.
     */
    static system(content: string): ChatMessageWasm;
    /**
     * Create a user message.
     */
    static user(content: string): ChatMessageWasm;
    /**
     * Get the message content.
     */
    readonly content: string;
    /**
     * Get the role as a string.
     */
    readonly role: string;
}

/**
 * Chat template for formatting conversations.
 */
export class ChatTemplateWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a Qwen/ChatML chat template.
     */
    static chatml(): ChatTemplateWasm;
    /**
     * Create a custom chat template.
     */
    static custom(template: string): ChatTemplateWasm;
    /**
     * Detect template from model ID.
     */
    static detectFromModelId(model_id: string): ChatTemplateWasm;
    /**
     * Format messages using this template.
     */
    format(messages: ChatMessageWasm[]): string;
    /**
     * Create a Gemma chat template.
     */
    static gemma(): ChatTemplateWasm;
    /**
     * Create a Llama 3 chat template.
     */
    static llama3(): ChatTemplateWasm;
    /**
     * Create a Mistral chat template.
     */
    static mistral(): ChatTemplateWasm;
    /**
     * Create a Phi chat template.
     */
    static phi(): ChatTemplateWasm;
    /**
     * Get the template name.
     */
    readonly name: string;
}

/**
 * Generation configuration for text generation.
 *
 * Controls sampling parameters and output constraints.
 * TypeScript-friendly with getter/setter methods.
 */
export class GenerateConfig {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a stop sequence.
     */
    addStopSequence(sequence: string): void;
    /**
     * Clear all stop sequences.
     */
    clearStopSequences(): void;
    /**
     * Create from JSON string.
     */
    static fromJson(json: string): GenerateConfig;
    /**
     * Create a new GenerateConfig with default values.
     */
    constructor();
    /**
     * Convert to JSON string.
     */
    toJson(): string;
    /**
     * Get maximum tokens.
     */
    maxTokens: number;
    /**
     * Get repetition penalty.
     */
    repetitionPenalty: number;
    /**
     * Get temperature.
     */
    temperature: number;
    /**
     * Get top-k value.
     */
    topK: number;
    /**
     * Get top-p value.
     */
    topP: number;
}

/**
 * HNSW Semantic Router for browser-compatible pattern routing
 *
 * Provides approximate nearest neighbor search over pattern embeddings
 * using the HNSW (Hierarchical Navigable Small World) algorithm.
 *
 * ## Memory Efficiency
 *
 * The router enforces a maximum number of patterns to prevent unbounded
 * memory growth in browser environments. When the limit is reached, adding
 * new patterns will fail.
 *
 * ## Thread Safety
 *
 * This implementation is single-threaded and designed for use in browser
 * main thread or Web Workers.
 */
export class HnswRouterWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a pattern to the router
     *
     * # Parameters
     *
     * - `embedding`: Float32Array of embedding values (must match dimensions)
     * - `name`: Pattern name/identifier
     * - `metadata`: JSON string with additional metadata
     *
     * # Returns
     *
     * `true` if pattern was added, `false` if max_patterns limit reached
     *
     * # Example
     *
     * ```javascript
     * const embedding = new Float32Array([0.1, 0.2, 0.3, ...]); // 384 dims
     * const success = router.addPattern(
     *   embedding,
     *   "rust-expert",
     *   JSON.stringify({ domain: "rust", expertise: "high" })
     * );
     * ```
     */
    addPattern(embedding: Float32Array, name: string, metadata: string): boolean;
    /**
     * Clear all patterns from the router
     *
     * Resets the router to empty state.
     */
    clear(): void;
    /**
     * Deserialize a router from JSON string
     *
     * # Example
     *
     * ```javascript
     * const json = localStorage.getItem('router');
     * const router = HnswRouterWasm.fromJson(json);
     * ```
     */
    static fromJson(json: string): HnswRouterWasm;
    /**
     * Get pattern by index
     *
     * # Parameters
     *
     * - `index`: Pattern index (0 to patternCount - 1)
     *
     * # Returns
     *
     * PatternWasm or null if index out of bounds
     */
    getPattern(index: number): PatternWasm | undefined;
    /**
     * Create a new HNSW router
     *
     * # Parameters
     *
     * - `dimensions`: Size of embedding vectors (e.g., 384 for all-MiniLM-L6-v2)
     * - `max_patterns`: Maximum number of patterns to store (memory limit)
     *
     * # Example
     *
     * ```javascript
     * const router = HnswRouterWasm.new(384, 1000);
     * ```
     */
    constructor(dimensions: number, max_patterns: number);
    /**
     * Route a query to find similar patterns
     *
     * # Parameters
     *
     * - `query`: Float32Array of query embedding (must match dimensions)
     * - `top_k`: Number of top results to return
     *
     * # Returns
     *
     * Array of RouteResultWasm ordered by similarity (highest first)
     *
     * # Example
     *
     * ```javascript
     * const query = new Float32Array([0.15, 0.18, ...]); // 384 dims
     * const results = router.route(query, 5);
     * results.forEach(result => {
     *   console.log(`${result.name}: ${result.score}`);
     * });
     * ```
     */
    route(query: Float32Array, top_k: number): RouteResultWasm[];
    /**
     * Set efSearch parameter for query-time accuracy tuning
     *
     * Higher values = more accurate but slower search.
     * Recommended range: 10-200.
     *
     * # Parameters
     *
     * - `ef_search`: Number of neighbors to explore during search
     */
    setEfSearch(ef_search: number): void;
    /**
     * Serialize the router to JSON string
     *
     * Useful for persisting to IndexedDB or localStorage.
     *
     * # Example
     *
     * ```javascript
     * const json = router.toJson();
     * localStorage.setItem('router', json);
     * ```
     */
    toJson(): string;
    /**
     * Get embedding dimensions
     */
    readonly dimensions: number;
    /**
     * Get current efSearch parameter
     */
    readonly efSearch: number;
    /**
     * Get maximum patterns limit
     */
    readonly maxPatterns: number;
    /**
     * Get current number of patterns
     */
    readonly patternCount: number;
}

/**
 * Arena allocator for inference buffers.
 *
 * Provides fast bump allocation with O(1) reset for
 * generation-step temporaries.
 */
export class InferenceArenaWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create an arena sized for model dimensions.
     */
    static forModel(hidden_dim: number, vocab_size: number, batch_size: number): InferenceArenaWasm;
    /**
     * Create a new arena with the specified capacity in bytes.
     */
    constructor(capacity: number);
    /**
     * Reset the arena, making all memory available for reuse.
     */
    reset(): void;
    /**
     * Get statistics as JSON.
     */
    statsJson(): string;
    /**
     * Get total capacity.
     */
    readonly capacity: number;
    /**
     * Get high water mark (maximum bytes ever used).
     */
    readonly highWaterMark: number;
    /**
     * Get remaining available bytes.
     */
    readonly remaining: number;
    /**
     * Get current bytes used.
     */
    readonly used: number;
}

/**
 * KV cache configuration for WASM.
 */
export class KvCacheConfigWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a new KV cache configuration.
     */
    constructor();
    /**
     * Get head dimension.
     */
    headDim: number;
    /**
     * Get max tokens.
     */
    maxTokens: number;
    /**
     * Get number of KV heads.
     */
    numKvHeads: number;
    /**
     * Get tail length.
     */
    tailLength: number;
}

/**
 * KV cache statistics.
 */
export class KvCacheStatsWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Convert to JSON.
     */
    toJson(): string;
    /**
     * Get compression ratio.
     */
    readonly compressionRatio: number;
    /**
     * Get store tokens.
     */
    readonly storeTokens: number;
    /**
     * Get tail tokens.
     */
    readonly tailTokens: number;
    /**
     * Get total tokens.
     */
    readonly totalTokens: number;
}

/**
 * Two-tier KV cache for WASM.
 *
 * Provides memory-efficient caching with a high-precision tail
 * and quantized store for older tokens.
 */
export class KvCacheWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Append KV pairs to the cache.
     */
    append(keys: Float32Array, values: Float32Array): void;
    /**
     * Clear the cache.
     */
    clear(): void;
    /**
     * Get all cached KV pairs.
     */
    getAllKv(): any;
    /**
     * Create a new KV cache with the given configuration.
     */
    constructor(config: KvCacheConfigWasm);
    /**
     * Get cache statistics.
     */
    stats(): KvCacheStatsWasm;
    /**
     * Create with default configuration.
     */
    static withDefaults(): KvCacheWasm;
    /**
     * Get the total number of cached tokens.
     */
    readonly tokenCount: number;
}

/**
 * Configuration for MicroLoRA adapter.
 *
 * Controls the rank, scaling, and dimensions of the LoRA adapter.
 * TypeScript-friendly with getter/setter methods.
 */
export class MicroLoraConfigWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get computed scaling factor (alpha / rank).
     */
    computeScaling(): number;
    /**
     * Calculate memory footprint in bytes.
     */
    memoryBytes(): number;
    /**
     * Create a new config with default values (rank=2, alpha=4.0, 768x768).
     */
    constructor();
    /**
     * Get alpha scaling factor.
     */
    alpha: number;
    /**
     * Get input feature dimension.
     */
    inFeatures: number;
    /**
     * Get output feature dimension.
     */
    outFeatures: number;
    /**
     * Get rank.
     */
    rank: number;
}

/**
 * Statistics for MicroLoRA adapter.
 */
export class MicroLoraStatsWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Convert to JSON string.
     */
    toJson(): string;
    /**
     * Get average quality score.
     */
    readonly avgQuality: number;
    /**
     * Get memory usage in bytes.
     */
    readonly memoryBytes: number;
    /**
     * Get parameter count.
     */
    readonly paramCount: number;
    /**
     * Get number of samples seen.
     */
    readonly samplesSeen: number;
}

/**
 * MicroLoRA adapter for browser-based real-time adaptation.
 *
 * Provides lightweight LoRA (Low-Rank Adaptation) with minimal memory footprint
 * suitable for browser environments. Supports per-request adaptation with
 * quality-based feedback.
 */
export class MicroLoraWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adapt the LoRA weights based on feedback.
     *
     * Accumulates gradients based on the quality score. Call `applyUpdates()`
     * to actually apply the accumulated gradients.
     */
    adapt(input: Float32Array, feedback: AdaptFeedbackWasm): void;
    /**
     * Apply LoRA transformation to input.
     *
     * Returns a new Float32Array with the transformed output.
     * The output is added to (not replaced) so you can combine with base model output.
     */
    apply(input: Float32Array): Float32Array;
    /**
     * Apply accumulated gradients with the given learning rate.
     *
     * Should be called after one or more `adapt()` calls to update the weights.
     */
    applyUpdates(learning_rate: number): void;
    /**
     * Deserialize from JSON string.
     */
    static fromJson(json: string): MicroLoraWasm;
    /**
     * Get configuration.
     */
    getConfig(): MicroLoraConfigWasm;
    /**
     * Create a new MicroLoRA adapter with the given configuration.
     */
    constructor(config: MicroLoraConfigWasm);
    /**
     * Get number of pending gradient updates.
     */
    pendingUpdates(): number;
    /**
     * Reset the adapter to its initial state.
     *
     * Clears B weights and all statistics.
     */
    reset(): void;
    /**
     * Get adapter statistics.
     */
    stats(): MicroLoraStatsWasm;
    /**
     * Serialize to JSON string for persistence.
     */
    toJson(): string;
}

/**
 * Main parallel inference interface for WASM.
 *
 * Provides high-level API for parallel compute operations in the browser.
 * Automatically manages worker pool and shared memory.
 */
export class ParallelInference {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Perform parallel multi-head attention.
     *
     * Computes softmax(Q * K^T / sqrt(d_k)) * V for each attention head.
     *
     * # Arguments
     * * `q` - Query tensor (batch_size, num_heads, seq_len, head_dim)
     * * `k` - Key tensor (batch_size, num_heads, seq_len, head_dim)
     * * `v` - Value tensor (batch_size, num_heads, seq_len, head_dim)
     * * `num_heads` - Number of attention heads
     * * `head_dim` - Dimension of each head
     * * `seq_len` - Sequence length
     *
     * # Returns
     * Output tensor (batch_size, num_heads, seq_len, head_dim)
     */
    attention(q: Float32Array, k: Float32Array, v: Float32Array, num_heads: number, head_dim: number, seq_len: number): Promise<Float32Array>;
    /**
     * Get statistics about worker pool.
     */
    getStats(): string;
    /**
     * Check if Atomics API is available.
     */
    isAtomicsAvailable(): boolean;
    /**
     * Check if the page is cross-origin isolated.
     */
    isCrossOriginIsolated(): boolean;
    /**
     * Check if SharedArrayBuffer is available.
     */
    isSharedMemoryAvailable(): boolean;
    /**
     * Perform parallel layer normalization.
     *
     * # Arguments
     * * `input` - Input tensor
     * * `gamma` - Scale parameter
     * * `beta` - Shift parameter
     * * `epsilon` - Small constant for numerical stability
     *
     * # Returns
     * Normalized tensor
     */
    layerNorm(input: Float32Array, gamma: Float32Array, beta: Float32Array, epsilon: number): Promise<Float32Array>;
    /**
     * Perform parallel matrix multiplication.
     *
     * Computes C = A * B where:
     * - A is m x k
     * - B is k x n
     * - C is m x n
     *
     * # Arguments
     * * `a` - Matrix A as flat array (row-major)
     * * `b` - Matrix B as flat array (row-major)
     * * `m` - Number of rows in A
     * * `n` - Number of columns in B
     * * `k` - Number of columns in A / rows in B
     *
     * # Returns
     * Result matrix C as Float32Array
     */
    matmul(a: Float32Array, b: Float32Array, m: number, n: number, k: number): Promise<Float32Array>;
    /**
     * Create a new ParallelInference instance.
     *
     * # Arguments
     * * `num_workers` - Number of workers to spawn. If None, uses optimal count.
     *
     * # Returns
     * A Promise that resolves to ParallelInference instance.
     *
     * # Example (JavaScript)
     * ```javascript
     * const inference = await ParallelInference.new(4);
     * ```
     */
    constructor(num_workers?: number | null);
    /**
     * Get optimal worker count for the current hardware.
     */
    static optimalWorkerCount(): number;
    /**
     * Terminate all workers and clean up resources.
     */
    terminate(): void;
    /**
     * Get the number of active workers.
     */
    workerCount(): number;
}

/**
 * A stored pattern with embedding and metadata
 *
 * Represents a routing pattern that can be matched against queries.
 * Each pattern has a name, embedding vector, and optional metadata.
 */
export class PatternWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a new pattern
     *
     * # Parameters
     *
     * - `embedding`: Float32Array of embedding values
     * - `name`: Pattern name/identifier
     * - `metadata`: JSON string with additional metadata
     */
    constructor(embedding: Float32Array, name: string, metadata: string);
    /**
     * Get pattern embedding as Float32Array
     */
    readonly embedding: Float32Array;
    /**
     * Get pattern metadata JSON string
     */
    metadata: string;
    /**
     * Get pattern name
     */
    name: string;
}

/**
 * A routing search result with similarity score
 *
 * Represents a matched pattern from a semantic search query.
 */
export class RouteResultWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get result embedding as Float32Array
     */
    readonly embedding: Float32Array;
    /**
     * Get result metadata JSON string
     */
    readonly metadata: string;
    /**
     * Get result pattern name
     */
    readonly name: string;
    /**
     * Get similarity score (higher is better, 0.0-1.0 for cosine)
     */
    readonly score: number;
}

/**
 * Main RuvLLM WASM interface.
 *
 * Provides the primary entry point for LLM inference in the browser.
 * Manages KV cache, memory pools, and inference state.
 */
export class RuvLLMWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Format a chat conversation using a template.
     */
    static formatChat(template: ChatTemplateWasm, messages: ChatMessageWasm[]): string;
    /**
     * Get buffer pool statistics.
     */
    getPoolStats(): string;
    /**
     * Initialize the engine with default configuration.
     */
    initialize(): void;
    /**
     * Initialize with custom KV cache configuration.
     */
    initializeWithConfig(config: KvCacheConfigWasm): void;
    /**
     * Create a new RuvLLM WASM instance.
     */
    constructor();
    /**
     * Clear all caches and reset state.
     */
    reset(): void;
    /**
     * Get version information.
     */
    static version(): string;
    /**
     * Check if the engine is initialized.
     */
    readonly isInitialized: boolean;
}

/**
 * Result of instant adaptation
 */
export class SonaAdaptResultWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Convert to JSON
     */
    toJson(): string;
    /**
     * Get applied status
     */
    readonly applied: boolean;
    /**
     * Get current rank
     */
    readonly currentRank: number;
    /**
     * Get latency in microseconds
     */
    readonly latencyUs: bigint;
    /**
     * Get quality delta
     */
    readonly qualityDelta: number;
    /**
     * Get quality EMA
     */
    readonly qualityEma: number;
}

/**
 * Configuration for SONA Instant Loop (WASM)
 */
export class SonaConfigWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create from JSON
     */
    static fromJson(json: string): SonaConfigWasm;
    /**
     * Create new config with defaults
     */
    constructor();
    /**
     * Convert to JSON
     */
    toJson(): string;
    /**
     * Get EMA decay
     */
    emaDecay: number;
    /**
     * Get EWC lambda
     */
    ewcLambda: number;
    /**
     * Get hidden dimension
     */
    hiddenDim: number;
    /**
     * Get learning rate
     */
    learningRate: number;
    /**
     * Get micro-LoRA rank
     */
    microLoraRank: number;
    /**
     * Get pattern capacity
     */
    patternCapacity: number;
}

/**
 * SONA Instant Loop for WASM
 */
export class SonaInstantWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Import state from JSON (partial - doesn't restore patterns)
     */
    static fromJson(json: string): SonaInstantWasm;
    /**
     * Get number of important weights tracked (EWC-lite)
     */
    importantWeightCount(): number;
    /**
     * Instant adaptation based on quality signal
     *
     * Target: <1ms latency
     */
    instantAdapt(quality: number): SonaAdaptResultWasm;
    /**
     * Create new SONA instant loop
     */
    constructor(config: SonaConfigWasm);
    /**
     * Record a pattern outcome for future reference
     */
    recordPattern(embedding: Float32Array, success: boolean): void;
    /**
     * Reset all learning state
     */
    reset(): void;
    /**
     * Get current statistics
     */
    stats(): SonaStatsWasm;
    /**
     * Suggest action based on learned patterns
     *
     * Uses simple cosine similarity search (HNSW integration point for future)
     */
    suggestAction(context: Float32Array): string | undefined;
    /**
     * Export state to JSON
     */
    toJson(): string;
}

/**
 * Learning statistics
 */
export class SonaStatsWasm {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Success rate
     */
    successRate(): number;
    /**
     * Convert to JSON
     */
    toJson(): string;
    /**
     * Get adaptations count
     */
    readonly adaptations: bigint;
    /**
     * Get average latency
     */
    readonly avgLatencyUs: number;
    /**
     * Get average quality
     */
    readonly avgQuality: number;
    /**
     * Get buffer size
     */
    readonly bufferSize: number;
    /**
     * Get current rank
     */
    readonly currentRank: number;
    /**
     * Get patterns recorded
     */
    readonly patternsRecorded: bigint;
    /**
     * Get successful patterns
     */
    readonly successfulPatterns: bigint;
}

/**
 * Simple timer for measuring elapsed time in WASM.
 */
export class Timer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get elapsed time in milliseconds.
     */
    elapsed_ms(): number;
    /**
     * Create a new timer with the given label.
     *
     * # Arguments
     *
     * * `label` - A descriptive label for the timer
     */
    constructor(label: string);
    /**
     * Reset the timer.
     */
    reset(): void;
    /**
     * Log elapsed time to console and return the duration.
     */
    stop(): number;
}

/**
 * Check if the page is cross-origin isolated.
 *
 * Cross-origin isolation is required for SharedArrayBuffer to work.
 * The page must be served with:
 * - `Cross-Origin-Opener-Policy: same-origin`
 * - `Cross-Origin-Embedder-Policy: require-corp`
 *
 * # Returns
 * `true` if cross-origin isolated, `false` otherwise.
 */
export function cross_origin_isolated(): boolean;

/**
 * Detect chat template from model ID.
 */
export function detectChatTemplate(model_id: string): ChatTemplateWasm;

/**
 * Determine the capability level for parallel inference.
 *
 * # Returns
 * The capability level based on available features.
 */
export function detect_capability_level(): string;

/**
 * Log an error to the browser console.
 *
 * # Arguments
 *
 * * `message` - The error message
 */
export function error(message: string): void;

/**
 * Get a summary of all available features.
 *
 * # Returns
 * JSON string with feature availability.
 */
export function feature_summary(): string;

/**
 * Get the WASM module version.
 */
export function getVersion(): string;

/**
 * Perform a simple health check.
 *
 * Returns true if the WASM module is functioning correctly.
 */
export function healthCheck(): boolean;

/**
 * Initialize the WASM module.
 *
 * This should be called once at application startup to set up
 * panic hooks and any other initialization.
 */
export function init(): void;

/**
 * Check if the WASM module is ready.
 */
export function isReady(): boolean;

/**
 * Check if Atomics API is available.
 *
 * Atomics provides atomic operations for synchronization between
 * the main thread and Web Workers.
 *
 * # Returns
 * `true` if Atomics is available, `false` otherwise.
 */
export function is_atomics_available(): boolean;

/**
 * Check if BigInt is available.
 *
 * BigInt is useful for 64-bit integer operations.
 *
 * # Returns
 * `true` if BigInt is available, `false` otherwise.
 */
export function is_bigint_available(): boolean;

/**
 * Check if SharedArrayBuffer is available.
 *
 * SharedArrayBuffer is required for zero-copy memory sharing between
 * the main thread and Web Workers.
 *
 * # Notes
 * - SharedArrayBuffer was temporarily disabled in all browsers after
 *   Spectre/Meltdown vulnerabilities were discovered.
 * - It's now available again, but requires cross-origin isolation:
 *   - `Cross-Origin-Opener-Policy: same-origin`
 *   - `Cross-Origin-Embedder-Policy: require-corp`
 *
 * # Returns
 * `true` if SharedArrayBuffer is available, `false` otherwise.
 */
export function is_shared_array_buffer_available(): boolean;

/**
 * Check if SIMD (WebAssembly SIMD) is available.
 *
 * # Returns
 * `true` if WASM SIMD is available, `false` otherwise.
 */
export function is_simd_available(): boolean;

/**
 * Check if Transferable objects are available.
 *
 * Transferable objects (ArrayBuffer, MessagePort, etc.) can be
 * transferred to workers without copying.
 *
 * # Returns
 * `true` if Transferable objects are available, `false` otherwise.
 */
export function is_transferable_available(): boolean;

/**
 * Check if Web Workers are available.
 *
 * # Returns
 * `true` if Web Workers are available, `false` otherwise.
 */
export function is_web_workers_available(): boolean;

/**
 * Log a message to the browser console.
 *
 * # Arguments
 *
 * * `message` - The message to log
 */
export function log(message: string): void;

/**
 * Get current timestamp in milliseconds using Performance API.
 *
 * Returns high-resolution timestamp for performance measurements.
 */
export function now_ms(): number;

/**
 * Get the optimal number of workers based on hardware concurrency.
 *
 * Uses `navigator.hardwareConcurrency` if available, otherwise falls
 * back to a reasonable default.
 *
 * # Notes
 * - Caps the result at MAX_WORKERS to prevent resource exhaustion.
 * - Leaves at least 1 core for the main thread.
 * - Falls back to 4 if hardware concurrency is not available.
 *
 * # Returns
 * Recommended number of workers.
 */
export function optimal_worker_count(): number;

/**
 * Get a message explaining why parallel inference is not available.
 *
 * # Returns
 * Explanation string, or empty string if parallel inference is available.
 */
export function parallel_inference_unavailable_reason(): string;

/**
 * Check if the environment supports parallel inference.
 *
 * # Arguments
 * * `require_shared_memory` - Whether to require SharedArrayBuffer
 *
 * # Returns
 * `true` if parallel inference is supported, `false` otherwise.
 */
export function supports_parallel_inference(require_shared_memory: boolean): boolean;

/**
 * Log a warning to the browser console.
 *
 * # Arguments
 *
 * * `message` - The warning message
 */
export function warn(message: string): void;
