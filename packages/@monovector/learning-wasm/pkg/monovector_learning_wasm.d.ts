/* tslint:disable */
/* eslint-disable */

/**
 * WASM-exposed MicroLoRA engine
 */
export class WasmMicroLoRA {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adapt using input buffer as gradient
     */
    adapt(): void;
    /**
     * Adapt with typed array gradient
     */
    adapt_array(gradient: Float32Array): void;
    /**
     * Get adaptation count
     */
    adapt_count(): bigint;
    /**
     * Adapt with improvement reward using input buffer as gradient
     */
    adapt_with_reward(improvement: number): void;
    /**
     * Get delta norm (weight change magnitude)
     */
    delta_norm(): number;
    /**
     * Get embedding dimension
     */
    dim(): number;
    /**
     * Forward pass using internal buffers (zero-allocation)
     *
     * Write input to get_input_ptr(), call forward(), read from get_output_ptr()
     */
    forward(): void;
    /**
     * Forward pass with typed array input (allocates output)
     */
    forward_array(input: Float32Array): Float32Array;
    /**
     * Get forward pass count
     */
    forward_count(): bigint;
    /**
     * Get pointer to input buffer for direct memory access
     */
    get_input_ptr(): number;
    /**
     * Get pointer to output buffer for direct memory access
     */
    get_output_ptr(): number;
    /**
     * Create a new MicroLoRA engine
     *
     * @param dim - Embedding dimension (default 256, max 256)
     * @param alpha - Scaling factor (default 0.1)
     * @param learning_rate - Learning rate (default 0.01)
     */
    constructor(dim?: number | null, alpha?: number | null, learning_rate?: number | null);
    /**
     * Get parameter count
     */
    param_count(): number;
    /**
     * Reset the engine
     */
    reset(): void;
}

/**
 * WASM-exposed Scoped LoRA manager
 */
export class WasmScopedLoRA {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adapt for operator type using input buffer as gradient
     */
    adapt(op_type: number): void;
    /**
     * Adapt with typed array
     */
    adapt_array(op_type: number, gradient: Float32Array): void;
    /**
     * Get adapt count for operator
     */
    adapt_count(op_type: number): bigint;
    /**
     * Adapt with improvement reward
     */
    adapt_with_reward(op_type: number, improvement: number): void;
    /**
     * Get delta norm for operator
     */
    delta_norm(op_type: number): number;
    /**
     * Forward pass for operator type (uses internal buffers)
     *
     * @param op_type - Operator type (0-16)
     */
    forward(op_type: number): void;
    /**
     * Forward pass with typed array
     */
    forward_array(op_type: number, input: Float32Array): Float32Array;
    /**
     * Get forward count for operator
     */
    forward_count(op_type: number): bigint;
    /**
     * Get input buffer pointer
     */
    get_input_ptr(): number;
    /**
     * Get output buffer pointer
     */
    get_output_ptr(): number;
    /**
     * Create a new scoped LoRA manager
     *
     * @param dim - Embedding dimension (max 256)
     * @param alpha - Scaling factor (default 0.1)
     * @param learning_rate - Learning rate (default 0.01)
     */
    constructor(dim?: number | null, alpha?: number | null, learning_rate?: number | null);
    /**
     * Reset all adapters
     */
    reset_all(): void;
    /**
     * Reset specific operator adapter
     */
    reset_scope(op_type: number): void;
    /**
     * Get operator scope name
     */
    static scope_name(op_type: number): string;
    /**
     * Enable/disable category fallback
     */
    set_category_fallback(enabled: boolean): void;
    /**
     * Get total adapt count
     */
    total_adapt_count(): bigint;
    /**
     * Get total forward count
     */
    total_forward_count(): bigint;
}

/**
 * WASM-exposed trajectory buffer
 */
export class WasmTrajectoryBuffer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get best attention type
     */
    best_attention(): number;
    /**
     * Get best improvement
     */
    best_improvement(): number;
    /**
     * Get trajectory count for operator
     */
    count_by_operator(op_type: number): number;
    /**
     * Get high quality trajectory count
     */
    high_quality_count(threshold: number): number;
    /**
     * Check if empty
     */
    is_empty(): boolean;
    /**
     * Get buffer length
     */
    len(): number;
    /**
     * Get mean improvement
     */
    mean_improvement(): number;
    /**
     * Create a new trajectory buffer
     *
     * @param capacity - Maximum number of trajectories to store
     * @param embedding_dim - Dimension of embeddings (default 256)
     */
    constructor(capacity?: number | null, embedding_dim?: number | null);
    /**
     * Record a trajectory
     *
     * @param embedding - Embedding vector (Float32Array)
     * @param op_type - Operator type (0-16)
     * @param attention_type - Attention mechanism used
     * @param execution_ms - Actual execution time
     * @param baseline_ms - Baseline execution time
     */
    record(embedding: Float32Array, op_type: number, attention_type: number, execution_ms: number, baseline_ms: number): void;
    /**
     * Reset buffer
     */
    reset(): void;
    /**
     * Get success rate
     */
    success_rate(): number;
    /**
     * Get total count
     */
    total_count(): bigint;
    /**
     * Get variance
     */
    variance(): number;
}
