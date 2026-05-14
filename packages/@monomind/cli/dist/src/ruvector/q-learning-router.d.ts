/**
 * Q-Learning Router for Task Routing
 *
 * Uses reinforcement learning to optimize task routing decisions
 * based on historical performance and context.
 *
 * Features:
 * - Caching for repeated task patterns (LRU cache)
 * - Optimized state space with feature hashing
 * - Epsilon decay with exponential annealing
 * - Experience replay buffer for stable learning
 * - Model persistence to .swarm/q-learning-model.json
 *
 * @module q-learning-router
 */
/**
 * Q-Learning Router Configuration
 */
export interface QLearningRouterConfig {
    /** Learning rate (default: 0.1) */
    learningRate: number;
    /** Discount factor (default: 0.99) */
    gamma: number;
    /** Initial exploration rate (default: 1.0) */
    explorationInitial: number;
    /** Final exploration rate (default: 0.01) */
    explorationFinal: number;
    /** Exploration decay steps (default: 10000) */
    explorationDecay: number;
    /** Exploration decay type (default: 'exponential') */
    explorationDecayType: 'linear' | 'exponential' | 'cosine';
    /** Maximum states in Q-table (default: 10000) */
    maxStates: number;
    /** Number of actions/routes (default: 8) */
    numActions: number;
    /** Experience replay buffer size (default: 1000) */
    replayBufferSize: number;
    /** Mini-batch size for replay (default: 32) */
    replayBatchSize: number;
    /** Enable experience replay (default: true) */
    enableReplay: boolean;
    /** Route cache size (default: 256) */
    cacheSize: number;
    /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
    cacheTTL: number;
    /** Model persistence path (default: '.swarm/q-learning-model.json') */
    modelPath: string;
    /** Auto-save interval in updates (default: 100) */
    autoSaveInterval: number;
    /** State space dimensionality for feature hashing (default: 64) */
    stateSpaceDim: number;
}
/**
 * Route decision result
 */
export interface RouteDecision {
    /** Selected route/action */
    route: string;
    /** Confidence score (0-1) */
    confidence: number;
    /** Q-values for all routes */
    qValues: number[];
    /** Was exploration used */
    explored: boolean;
    /** Route alternatives */
    alternatives: Array<{
        route: string;
        score: number;
    }>;
}
/**
 * Q-Learning Router for intelligent task routing
 *
 * Optimized with:
 * - LRU cache for repeated task patterns
 * - Feature hashing for efficient state space
 * - Exponential epsilon decay
 * - Prioritized experience replay
 * - Model persistence
 */
export declare class QLearningRouter {
    private config;
    private qTable;
    private epsilon;
    private stepCount;
    private updateCount;
    private avgTDError;
    private ruvectorEngine;
    private useNative;
    private replayBuffer;
    private replayBufferIdx;
    private totalExperiences;
    private routeCache;
    private cacheOrder;
    private cacheHits;
    private cacheMisses;
    private featureHashCache;
    constructor(config?: Partial<QLearningRouterConfig>);
    /**
     * Initialize the router, attempting to load ruvector native module
     * and restore persisted model if available
     */
    initialize(): Promise<void>;
    /**
     * Load model from persistence file
     */
    loadModel(path?: string): Promise<boolean>;
    /**
     * Save model to persistence file
     */
    saveModel(path?: string): Promise<boolean>;
    /**
     * Route a task based on its context
     * Uses LRU cache for repeated task patterns
     */
    route(taskContext: string, explore?: boolean): RouteDecision;
    /**
     * Get cached route decision (LRU cache)
     */
    private getCachedRoute;
    /**
     * Cache a route decision (LRU eviction)
     */
    private cacheRoute;
    /**
     * Invalidate cache (call after significant Q-table updates)
     */
    invalidateCache(): void;
    /**
     * Update Q-values based on feedback
     * Includes experience replay for stable learning
     */
    update(taskContext: string, action: string, reward: number, nextContext?: string): number;
    /**
     * Internal Q-value update
     */
    private updateQValue;
    /**
     * Add experience to circular replay buffer
     */
    private addToReplayBuffer;
    /**
     * Perform prioritized experience replay
     * Samples mini-batch from buffer and updates Q-values
     */
    private experienceReplay;
    /**
     * Sample a prioritized batch from replay buffer
     * Uses proportional prioritization
     */
    private samplePrioritizedBatch;
    /**
     * Calculate epsilon using configured decay strategy
     */
    private calculateEpsilon;
    /**
     * Get statistics including cache and replay buffer metrics
     */
    getStats(): Record<string, number>;
    /**
     * Reset the router (clears all learned data)
     */
    reset(): void;
    /**
     * Export Q-table for persistence
     */
    export(): Record<string, {
        qValues: number[];
        visits: number;
    }>;
    /**
     * Import Q-table from persistence with strict validation.
     * SECURITY: a poisoned `.swarm/q-table.json` (co-located process write,
     * malicious test fixture) with `qValues: [Infinity, ...]` would otherwise
     * propagate NaN/Infinity through every argmax + Q-update — the attacker
     * deterministically chooses every routing decision. Mirror the
     * ewc-consolidation.ts:loadFromDisk pattern: per-field shape + finite-numeric
     * + dimension check, drop bad records silently.
     */
    import(data: Record<string, {
        qValues: number[];
        visits: number;
    }>): void;
    /**
     * Legacy hash function (kept for backward compatibility)
     */
    private hashState;
    /**
     * Optimized state hashing using feature extraction
     * Creates a more semantic representation of the task context
     */
    private hashStateOptimized;
    /**
     * Extract feature vector from task context
     * Uses keyword matching and n-gram hashing
     */
    private extractFeatures;
    /**
     * Convert feature vector to state key
     * Uses locality-sensitive hashing for similar contexts
     */
    private featureVectorToKey;
    /**
     * MurmurHash3 32-bit implementation for n-gram hashing
     */
    private murmurhash3;
    private getQValues;
    private getOrCreateEntry;
    private argmax;
    private softmaxConfidence;
    private pruneQTable;
}
/**
 * Factory function
 */
export declare function createQLearningRouter(config?: Partial<QLearningRouterConfig>): QLearningRouter;
//# sourceMappingURL=q-learning-router.d.ts.map