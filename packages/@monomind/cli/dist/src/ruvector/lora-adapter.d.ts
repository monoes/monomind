/**
 * LoRA (Low-Rank Adaptation) Implementation
 *
 * Enables efficient fine-tuning by decomposing weight updates into low-rank matrices.
 * Dramatically reduces memory requirements while maintaining adaptation quality.
 *
 * Features:
 * - Rank decomposition (r << d) for memory efficiency
 * - Additive weight updates: W' = W + BA (where B ∈ R^{d×r}, A ∈ R^{r×k})
 * - Support for multiple adaptation heads
 * - Persistence to .swarm/lora-weights.json
 *
 * Memory savings:
 * - Original: d × k parameters
 * - LoRA: r × (d + k) parameters
 * - For d=384, k=384, r=8: 786,432 → 6,144 (128x reduction)
 *
 * @module lora-adapter
 */
/**
 * Default LoRA rank (determines memory/quality tradeoff)
 */
export declare const DEFAULT_RANK = 8;
/**
 * Input dimension (384 from ONNX MiniLM-L6-v2)
 */
export declare const INPUT_DIM = 384;
/**
 * Default output dimension (same as input for adapter)
 */
export declare const OUTPUT_DIM = 384;
/**
 * Default alpha scaling factor
 */
export declare const DEFAULT_ALPHA = 16;
/**
 * LoRA configuration
 */
export interface LoRAConfig {
    /** Rank of decomposition (lower = more compression) */
    rank: number;
    /** Alpha scaling factor for output */
    alpha: number;
    /** Input dimension */
    inputDim: number;
    /** Output dimension */
    outputDim: number;
    /** Learning rate for updates */
    learningRate: number;
    /** Path for weight persistence */
    weightsPath: string;
    /** Enable dropout for regularization */
    enableDropout: boolean;
    /** Dropout probability */
    dropoutProb: number;
    /** Auto-save interval in updates */
    autoSaveInterval: number;
}
/**
 * LoRA adapter weights
 */
export interface LoRAWeights {
    /** A matrix (rank × inputDim) - down projection */
    A: Float32Array;
    /** B matrix (outputDim × rank) - up projection */
    B: Float32Array;
    /** Scaling factor (alpha / rank) */
    scaling: number;
}
/**
 * Adaptation result
 */
export interface AdaptationResult {
    /** Adapted embedding */
    adapted: Float32Array;
    /** Magnitude of adaptation */
    adaptationNorm: number;
    /** Time taken in ms */
    timeMs: number;
}
/**
 * LoRA statistics
 */
export interface LoRAStats {
    /** Total adaptations performed */
    totalAdaptations: number;
    /** Total training updates */
    totalUpdates: number;
    /** Current rank */
    rank: number;
    /** Memory savings ratio */
    compressionRatio: number;
    /** Average adaptation norm */
    avgAdaptationNorm: number;
    /** Last update timestamp */
    lastUpdate: number | null;
}
/**
 * Low-Rank Adaptation module for efficient embedding fine-tuning
 */
export declare class LoRAAdapter {
    private config;
    private weights;
    private totalAdaptations;
    private totalUpdates;
    private adaptationNormSum;
    private lastUpdate;
    private updatesSinceLastSave;
    constructor(config?: Partial<LoRAConfig>);
    /**
     * Initialize weights with Kaiming/He initialization
     */
    private initializeWeights;
    /**
     * Box-Muller transform for Gaussian random numbers
     */
    private gaussianRandom;
    /**
     * Initialize adapter and load persisted weights
     */
    initialize(): Promise<{
        success: boolean;
        weightsLoaded: boolean;
    }>;
    /**
     * Apply LoRA adaptation to an embedding
     * output = input + scaling * (B @ A @ input)
     */
    adapt(input: Float32Array): AdaptationResult;
    /**
     * Train the adapter with a gradient signal
     * Uses simplified update: A += lr * hidden^T @ grad, B += lr * grad @ hidden^T
     */
    train(input: Float32Array, gradOutput: Float32Array, reward?: number): {
        updated: boolean;
        loss: number;
    };
    /**
     * Merge LoRA weights into base weights (for deployment)
     * Returns: W' = W + scaling * B @ A
     */
    merge(baseWeights: Float32Array): Float32Array;
    /**
     * Get current statistics
     */
    getStats(): LoRAStats;
    /**
     * Reset adapter to initial state
     */
    reset(): void;
    /**
     * Save weights to disk
     */
    saveWeights(): boolean;
    /**
     * Load weights from disk
     */
    loadWeights(): boolean;
    /**
     * Export weights as JSON
     */
    exportWeights(): {
        A: number[];
        B: number[];
        scaling: number;
        config: Partial<LoRAConfig>;
    };
    /**
     * Import weights from JSON
     */
    importWeights(data: {
        A: number[];
        B: number[];
        scaling: number;
    }): boolean;
}
/**
 * Get or create singleton LoRA adapter instance
 */
export declare function getLoRAAdapter(): Promise<LoRAAdapter>;
/**
 * Reset singleton instance (for testing)
 */
export declare function resetLoRAAdapter(): void;
/**
 * Create new LoRA adapter instance (factory)
 */
export declare function createLoRAAdapter(config?: Partial<LoRAConfig>): LoRAAdapter;
/**
 * Quick adaptation (convenience function)
 */
export declare function adaptEmbedding(input: Float32Array): Promise<AdaptationResult>;
/**
 * Quick training (convenience function)
 */
export declare function trainLoRA(input: Float32Array, gradOutput: Float32Array, reward?: number): Promise<{
    updated: boolean;
    loss: number;
}>;
/**
 * Get LoRA statistics (convenience function)
 */
export declare function getLoRAStats(): Promise<LoRAStats>;
declare const _default: {
    LoRAAdapter: typeof LoRAAdapter;
    getLoRAAdapter: typeof getLoRAAdapter;
    resetLoRAAdapter: typeof resetLoRAAdapter;
    createLoRAAdapter: typeof createLoRAAdapter;
    adaptEmbedding: typeof adaptEmbedding;
    trainLoRA: typeof trainLoRA;
    getLoRAStats: typeof getLoRAStats;
    DEFAULT_RANK: number;
    DEFAULT_ALPHA: number;
    INPUT_DIM: number;
    OUTPUT_DIM: number;
};
export default _default;
//# sourceMappingURL=lora-adapter.d.ts.map