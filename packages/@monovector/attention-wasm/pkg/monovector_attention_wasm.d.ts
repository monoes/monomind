/* tslint:disable */
/* eslint-disable */

/**
 * Adam optimizer
 */
export class WasmAdam {
    free(): void;
    [Symbol.dispose](): void;
    constructor(param_count: number, learning_rate: number);
    reset(): void;
    step(params: Float32Array, gradients: Float32Array): void;
    learning_rate: number;
}

/**
 * AdamW optimizer (Adam with decoupled weight decay)
 */
export class WasmAdamW {
    free(): void;
    [Symbol.dispose](): void;
    constructor(param_count: number, learning_rate: number, weight_decay: number);
    reset(): void;
    step(params: Float32Array, gradients: Float32Array): void;
    learning_rate: number;
    readonly weight_decay: number;
}

/**
 * Flash attention mechanism
 */
export class WasmFlashAttention {
    free(): void;
    [Symbol.dispose](): void;
    compute(query: Float32Array, keys: any, values: any): Float32Array;
    constructor(dim: number, block_size: number);
}

/**
 * Hyperbolic attention mechanism
 */
export class WasmHyperbolicAttention {
    free(): void;
    [Symbol.dispose](): void;
    compute(query: Float32Array, keys: any, values: any): Float32Array;
    constructor(dim: number, curvature: number);
    readonly curvature: number;
}

/**
 * InfoNCE contrastive loss for training
 */
export class WasmInfoNCELoss {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Compute InfoNCE loss
     */
    compute(anchor: Float32Array, positive: Float32Array, negatives: any): number;
    /**
     * Create a new InfoNCE loss instance
     */
    constructor(temperature: number);
}

/**
 * Learning rate scheduler
 */
export class WasmLRScheduler {
    free(): void;
    [Symbol.dispose](): void;
    get_lr(): number;
    constructor(initial_lr: number, warmup_steps: number, total_steps: number);
    reset(): void;
    step(): void;
}

/**
 * Linear attention (Performer-style)
 */
export class WasmLinearAttention {
    free(): void;
    [Symbol.dispose](): void;
    compute(query: Float32Array, keys: any, values: any): Float32Array;
    constructor(dim: number, num_features: number);
}

/**
 * Local-global attention mechanism
 */
export class WasmLocalGlobalAttention {
    free(): void;
    [Symbol.dispose](): void;
    compute(query: Float32Array, keys: any, values: any): Float32Array;
    constructor(dim: number, local_window: number, global_tokens: number);
}

/**
 * Mixture of Experts (MoE) attention
 */
export class WasmMoEAttention {
    free(): void;
    [Symbol.dispose](): void;
    compute(query: Float32Array, keys: any, values: any): Float32Array;
    constructor(dim: number, num_experts: number, top_k: number);
}

/**
 * Multi-head attention mechanism
 */
export class WasmMultiHeadAttention {
    free(): void;
    [Symbol.dispose](): void;
    compute(query: Float32Array, keys: any, values: any): Float32Array;
    constructor(dim: number, num_heads: number);
    readonly dim: number;
    readonly num_heads: number;
}

/**
 * SGD optimizer with momentum
 */
export class WasmSGD {
    free(): void;
    [Symbol.dispose](): void;
    constructor(param_count: number, learning_rate: number, momentum?: number | null);
    reset(): void;
    step(params: Float32Array, gradients: Float32Array): void;
    learning_rate: number;
}

/**
 * Compute attention weights from scores
 */
export function attention_weights(scores: Float32Array, temperature?: number | null): void;

/**
 * Get information about available attention mechanisms
 */
export function available_mechanisms(): any;

/**
 * Batch normalize vectors
 */
export function batch_normalize(vectors: any, epsilon?: number | null): Float32Array;

/**
 * Compute cosine similarity between two vectors
 */
export function cosine_similarity(a: Float32Array, b: Float32Array): number;

/**
 * Initialize the WASM module with panic hook
 */
export function init(): void;

/**
 * Compute L2 norm of a vector
 */
export function l2_norm(vec: Float32Array): number;

/**
 * Log a message to the browser console
 */
export function log(message: string): void;

/**
 * Log an error to the browser console
 */
export function log_error(message: string): void;

/**
 * Normalize a vector to unit length
 */
export function normalize(vec: Float32Array): void;

/**
 * Compute pairwise distances between vectors
 */
export function pairwise_distances(vectors: any): Float32Array;

/**
 * Generate random orthogonal matrix (for initialization)
 */
export function random_orthogonal_matrix(dim: number): Float32Array;

/**
 * Compute scaled dot-product attention
 */
export function scaled_dot_attention(query: Float32Array, keys: any, values: any, scale?: number | null): Float32Array;

/**
 * Compute softmax of a vector
 */
export function softmax(vec: Float32Array): void;

/**
 * Get the version of the ruvector-attention-wasm crate
 */
export function version(): string;
