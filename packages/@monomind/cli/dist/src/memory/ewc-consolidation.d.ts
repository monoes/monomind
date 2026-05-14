/**
 * EWC++ (Elastic Weight Consolidation) Implementation
 * Prevents catastrophic forgetting of important patterns during continual learning
 *
 * Algorithm:
 * L_total = L_new + (lambda/2) * sum_i(F_i * (theta_i - theta_old_i)^2)
 *
 * Where:
 * - L_new is the loss on new data
 * - lambda is the importance weight (ewcLambda)
 * - F_i is the Fisher information for parameter i
 * - theta_i is the current parameter value
 * - theta_old_i is the previous parameter value
 *
 * Features:
 * - Fisher Information Matrix computation from gradient history
 * - Online EWC updates for streaming patterns
 * - Selective consolidation based on pattern importance
 * - Persistent storage in .swarm/ewc-fisher.json
 *
 * @module v1/cli/memory/ewc-consolidation
 */
/**
 * Pattern weight vector for EWC consolidation
 */
export interface PatternWeights {
    /** Unique pattern identifier */
    id: string;
    /** Weight vector (embedding or learned parameters) */
    weights: number[];
    /** Fisher information values per weight */
    fisherDiagonal: number[];
    /** Importance score (0-1) */
    importance: number;
    /** Number of successful uses */
    successCount: number;
    /** Number of failed uses */
    failureCount: number;
    /** Timestamp of last update */
    lastUpdated: number;
    /** Pattern type for categorization */
    type: string;
    /** Pattern description */
    description?: string;
}
/**
 * Fisher Information Matrix entry (diagonal approximation)
 */
export interface FisherEntry {
    /** Parameter index */
    index: number;
    /** Fisher information value (importance) */
    value: number;
    /** Number of samples used to compute this value */
    sampleCount: number;
    /** Exponential moving average decay rate */
    decayRate: number;
}
/**
 * EWC consolidation configuration
 */
export interface EWCConfig {
    /** Regularization strength (lambda) */
    lambda: number;
    /** Number of patterns to keep for Fisher computation */
    maxPatterns: number;
    /** Decay rate for online Fisher updates */
    fisherDecayRate: number;
    /** Minimum importance threshold for consolidation */
    importanceThreshold: number;
    /** Path to persist Fisher matrix */
    storagePath: string;
    /** Enable online updates (EWC++) */
    onlineMode: boolean;
    /** Dimensions of weight vectors */
    dimensions: number;
}
/**
 * Consolidation result
 */
export interface ConsolidationResult {
    /** Whether consolidation was successful */
    success: boolean;
    /** Number of patterns consolidated */
    patternsConsolidated: number;
    /** Total penalty applied */
    totalPenalty: number;
    /** Patterns that were modified */
    modifiedPatterns: string[];
    /** Patterns that were protected (high Fisher) */
    protectedPatterns: string[];
    /** Time taken in milliseconds */
    duration: number;
    /** Error message if failed */
    error?: string;
}
/**
 * Statistics about EWC consolidation state
 */
export interface EWCStats {
    /** Total patterns tracked */
    totalPatterns: number;
    /** Patterns with high importance (above threshold) */
    highImportancePatterns: number;
    /** Average Fisher information across all parameters */
    avgFisherValue: number;
    /** Maximum Fisher information value */
    maxFisherValue: number;
    /** Total successful consolidations */
    consolidationCount: number;
    /** Last consolidation timestamp */
    lastConsolidation: number | null;
    /** Average penalty per consolidation */
    avgPenalty: number;
    /** Storage size in bytes */
    storageSizeBytes: number;
}
/**
 * EWC++ Consolidator
 * Implements Elastic Weight Consolidation with online updates
 * for preventing catastrophic forgetting in continual learning
 */
export declare class EWCConsolidator {
    private config;
    private patterns;
    private gradientHistory;
    private globalFisher;
    private consolidationHistory;
    private initialized;
    constructor(config?: Partial<EWCConfig>);
    /**
     * Initialize the consolidator by loading persisted state
     */
    initialize(): Promise<boolean>;
    /**
     * Compute Fisher Information Matrix from gradient history
     * Uses diagonal approximation for efficiency: F_i = E[g_i^2]
     *
     * @param patterns - Array of patterns with their gradients/embeddings
     * @returns Fisher information diagonal
     */
    computeFisherMatrix(patterns: {
        id: string;
        embedding: number[];
        success: boolean;
    }[]): number[];
    /**
     * Consolidate new patterns with old patterns without forgetting
     * Applies EWC penalty to preserve important weights
     *
     * @param newPatterns - New patterns to incorporate
     * @param oldPatterns - Existing patterns to preserve
     * @returns Consolidated patterns with modified weights
     */
    consolidate(newPatterns: {
        id: string;
        embedding: number[];
        type: string;
        description?: string;
    }[], oldPatterns?: PatternWeights[]): ConsolidationResult;
    /**
     * Calculate EWC regularization penalty
     *
     * L_ewc = (lambda/2) * sum_i(F_i * (theta_i - theta_old_i)^2)
     *
     * @param oldWeights - Previous weight values
     * @param newWeights - New weight values
     * @param fisher - Fisher information diagonal (optional, uses global if not provided)
     * @returns Regularization penalty value
     */
    getPenalty(oldWeights: number[], newWeights: number[], fisher?: number[]): number;
    /**
     * Get consolidation statistics
     */
    getConsolidationStats(): EWCStats;
    /**
     * Record a gradient sample for Fisher computation
     */
    recordGradient(patternId: string, gradients: number[], success: boolean): void;
    /**
     * Get pattern weights by ID
     */
    getPatternWeights(id: string): PatternWeights | undefined;
    /**
     * Get all stored patterns
     */
    getAllPatterns(): PatternWeights[];
    /**
     * Update EWC lambda (regularization strength)
     */
    setLambda(lambda: number): void;
    /**
     * Get current lambda value
     */
    getLambda(): number;
    /**
     * Reset Fisher matrix (use with caution - allows forgetting)
     */
    resetFisher(): void;
    /**
     * Update Fisher matrix from pattern confidence changes.
     * Called by SONA after distillLearning to track which patterns
     * are important and should be protected from forgetting.
     *
     * Uses online averaging: F_new = alpha * F_old + (1-alpha) * F_current
     *
     * @param confidenceChanges - Array of {id, embedding, oldConf, newConf}
     */
    updateFisherFromConfidences(confidenceChanges: {
        id: string;
        embedding: number[];
        oldConf: number;
        newConf: number;
    }[]): void;
    /**
     * Compute consolidation penalty for a proposed confidence update.
     * Used by SONA to check whether a pattern update would cause forgetting.
     *
     * @param oldConfidence - Current confidence value
     * @param newConfidence - Proposed new confidence value
     * @returns Penalty value (higher = more forgetting risk)
     */
    computeConfidencePenalty(oldConfidence: number, newConfidence: number): number;
    /**
     * Clear all patterns and history (full reset)
     */
    clear(): void;
    /**
     * Calculate importance score for a pattern based on usage
     */
    private calculateImportance;
    /**
     * Blend old and new weights using Fisher-weighted interpolation
     */
    private blendWeights;
    /**
     * Prune old, low-importance patterns to stay within limit
     */
    private pruneOldPatterns;
    /**
     * Save state to disk
     */
    private saveToDisk;
    /**
     * Load state from disk
     */
    private loadFromDisk;
}
/**
 * Get the singleton EWC Consolidator instance
 *
 * @param config - Optional configuration overrides
 * @returns EWC Consolidator instance
 */
export declare function getEWCConsolidator(config?: Partial<EWCConfig>): Promise<EWCConsolidator>;
/**
 * Reset the singleton instance (for testing)
 */
export declare function resetEWCConsolidator(): void;
/**
 * Quick consolidation helper for common use case
 * Consolidates new patterns with existing ones using EWC
 *
 * @param newPatterns - New patterns to add
 * @returns Consolidation result
 */
export declare function consolidatePatterns(newPatterns: {
    id: string;
    embedding: number[];
    type: string;
    description?: string;
}[]): Promise<ConsolidationResult>;
/**
 * Record pattern usage outcome
 * Updates Fisher information and pattern importance
 *
 * @param patternId - Pattern identifier
 * @param embedding - Pattern embedding (used as gradient proxy)
 * @param success - Whether the pattern was successful
 */
export declare function recordPatternOutcome(patternId: string, embedding: number[], success: boolean): Promise<void>;
/**
 * Get EWC statistics
 */
export declare function getEWCStats(): Promise<EWCStats>;
declare const _default: {
    EWCConsolidator: typeof EWCConsolidator;
    getEWCConsolidator: typeof getEWCConsolidator;
    resetEWCConsolidator: typeof resetEWCConsolidator;
    consolidatePatterns: typeof consolidatePatterns;
    recordPatternOutcome: typeof recordPatternOutcome;
    getEWCStats: typeof getEWCStats;
};
export default _default;
//# sourceMappingURL=ewc-consolidation.d.ts.map