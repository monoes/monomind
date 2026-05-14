/**
 * RuVector Training Service
 * Real WASM-accelerated neural training using @ruvector packages
 *
 * Features:
 * - MicroLoRA: <1µs adaptation with rank-2 LoRA (2.3M ops/s)
 * - SONA: Self-Optimizing Neural Architecture (624k learn/s, 60k search/s)
 * - Flash Attention: 2.49x-7.47x speedup (9k ops/s)
 * - Trajectory Buffer: Learning from success/failure
 * - Contrastive Learning: InfoNCE loss
 *
 * Backward Compatible: All v1 APIs preserved, SONA adds new capabilities
 *
 * github.com/nokhodian/monomind
 */
type BenchmarkResult = any;
/**
 * Get which backend is active for training
 */
export declare function getActiveBackend(): 'wasm' | 'js-fallback';
export interface TrainingConfig {
    dim?: number;
    learningRate?: number;
    alpha?: number;
    trajectoryCapacity?: number;
    useFlashAttention?: boolean;
    useMoE?: boolean;
    useHyperbolic?: boolean;
    totalSteps?: number;
    warmupSteps?: number;
    useSona?: boolean;
    sonaRank?: number;
}
export interface TrainingResult {
    success: boolean;
    adaptationCount: bigint;
    forwardCount: bigint;
    deltaNorm: number;
    trajectoryStats?: {
        successRate: number;
        meanImprovement: number;
        bestImprovement: number;
        totalCount: bigint;
    };
    benchmark?: BenchmarkResult[];
}
/**
 * Initialize the RuVector training system.
 * Attempts to load @ruvector/learning-wasm for WASM-accelerated training.
 * Falls back to a pure-JS implementation if WASM is unavailable.
 */
export declare function initializeTraining(config?: TrainingConfig): Promise<{
    success: boolean;
    features: string[];
    backend: 'wasm' | 'js-fallback';
    error?: string;
}>;
/**
 * Operator types for scoped LoRA (0-16)
 */
export declare const OperatorType: {
    readonly GENERAL: 0;
    readonly ATTENTION: 1;
    readonly MLP: 2;
    readonly EMBEDDING: 3;
    readonly NORMALIZATION: 4;
    readonly PROJECTION: 5;
    readonly POOLING: 6;
    readonly CONVOLUTION: 7;
    readonly RECURRENT: 8;
    readonly ROUTING: 9;
    readonly MEMORY: 10;
    readonly REASONING: 11;
    readonly COORDINATION: 12;
    readonly OPTIMIZATION: 13;
    readonly SECURITY: 14;
    readonly TESTING: 15;
    readonly DEBUGGING: 16;
};
/**
 * Train a pattern with MicroLoRA
 */
export declare function trainPattern(embedding: Float32Array, gradient: Float32Array, operatorType?: number): Promise<{
    deltaNorm: number;
    adaptCount: bigint;
}>;
/**
 * Forward pass through LoRA
 */
export declare function forward(input: Float32Array, operatorType?: number): Float32Array;
/**
 * Reward-based adaptation (reinforcement learning)
 */
export declare function adaptWithReward(improvement: number, operatorType?: number): void;
/**
 * Record a learning trajectory
 */
export declare function recordTrajectory(embedding: Float32Array, operatorType: number, attentionType: number, executionMs: number, baselineMs: number): void;
/**
 * Get trajectory statistics
 */
export declare function getTrajectoryStats(): {
    successRate: number;
    meanImprovement: number;
    bestImprovement: number;
    totalCount: bigint;
    highQualityCount: number;
    variance: number;
} | null;
/**
 * Compute attention with Flash Attention (2.49x-7.47x faster)
 */
export declare function computeFlashAttention(query: Float32Array, keys: Float32Array[], values: Float32Array[]): Float32Array;
/**
 * Compute MoE routing
 */
export declare function computeMoEAttention(query: Float32Array, keys: Float32Array[], values: Float32Array[]): Float32Array;
/**
 * Compute hyperbolic attention (for hierarchical patterns)
 */
export declare function computeHyperbolicAttention(query: Float32Array, keys: Float32Array[], values: Float32Array[]): Float32Array;
/**
 * Compute contrastive loss for training
 */
export declare function computeContrastiveLoss(anchor: Float32Array, positives: Float32Array[], negatives: Float32Array[]): {
    loss: number;
    gradient: Float32Array;
};
/**
 * Optimizer step
 */
export declare function optimizerStep(params: Float32Array, gradients: Float32Array): Float32Array;
/**
 * Get curriculum difficulty for current step
 */
export declare function getCurriculumDifficulty(step: number): number;
/**
 * Mine hard negatives for better training
 */
export declare function mineHardNegatives(anchor: Float32Array, candidates: Float32Array[]): number[];
/**
 * Benchmark the training system
 */
export declare function benchmarkTraining(dim?: number, iterations?: number): Promise<BenchmarkResult[]>;
/**
 * Check if SONA is available
 */
export declare function isSonaAvailable(): boolean;
/**
 * Force-learn a pattern with SONA (1.6μs, 624k ops/s)
 * This is a one-shot learning mechanism for immediate pattern storage
 */
export declare function sonaForceLearn(embedding: Float32Array, reward: number): void;
/**
 * Search for similar patterns with SONA (16.7μs, 60k searches/s)
 * Returns the k most similar patterns from the pattern bank
 */
export declare function sonaFindPatterns(embedding: Float32Array, k?: number): unknown[];
/**
 * Process SONA background tasks (0.13μs, 7.5M ticks/s)
 * Call periodically to process background learning and consolidation
 */
export declare function sonaTick(): void;
/**
 * Get SONA statistics
 */
export declare function getSonaStats(): {
    available: boolean;
    enabled: boolean;
    stats: Record<string, unknown> | null;
    totalLearns: number;
    totalSearches: number;
};
/**
 * Enable/disable SONA learning
 */
export declare function setSonaEnabled(enabled: boolean): void;
/**
 * Flush SONA buffers (persist any pending patterns)
 */
export declare function sonaFlush(): void;
/**
 * Get training statistics
 */
export declare function getTrainingStats(): {
    initialized: boolean;
    backend: 'wasm' | 'js-fallback';
    totalAdaptations: number;
    totalForwards: number;
    microLoraStats?: {
        paramCount: number;
        adaptCount: bigint;
        forwardCount: bigint;
        deltaNorm: number;
    };
    scopedLoraStats?: {
        totalAdaptCount: bigint;
        totalForwardCount: bigint;
    };
    trajectoryStats?: ReturnType<typeof getTrajectoryStats>;
    sonaStats?: ReturnType<typeof getSonaStats>;
    lastBenchmark?: BenchmarkResult[];
};
/**
 * Reset the training system
 */
export declare function resetTraining(): void;
/**
 * Export trained weights
 */
export declare function exportWeights(): {
    dim: number;
    deltaNorm: number;
    adaptCount: bigint;
    trajectoryStats: ReturnType<typeof getTrajectoryStats>;
} | null;
/**
 * Cleanup resources
 */
export declare function cleanup(): void;
export {};
//# sourceMappingURL=ruvector-training.d.ts.map