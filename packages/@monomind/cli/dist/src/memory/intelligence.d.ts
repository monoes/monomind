/**
 * V1 Intelligence Module
 * Optimized SONA (Self-Optimizing Neural Architecture) and ReasoningBank
 * for adaptive learning and pattern recognition
 *
 * Performance targets:
 * - Signal recording: <0.05ms (achieved: ~0.01ms)
 * - Pattern search: O(log n) with HNSW
 * - Memory efficient circular buffers
 *
 * @module v1/cli/intelligence
 */
export interface SonaConfig {
    instantLoopEnabled: boolean;
    backgroundLoopEnabled: boolean;
    loraLearningRate: number;
    loraRank: number;
    ewcLambda: number;
    maxTrajectorySize: number;
    patternThreshold: number;
    maxSignals: number;
    maxPatterns: number;
}
export interface TrajectoryStep {
    type: 'observation' | 'thought' | 'action' | 'result';
    content: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    timestamp?: number;
}
export interface Pattern {
    id: string;
    type: string;
    embedding: number[];
    content: string;
    confidence: number;
    usageCount: number;
    createdAt: number;
    lastUsedAt: number;
}
export interface IntelligenceStats {
    sonaEnabled: boolean;
    reasoningBankSize: number;
    patternsLearned: number;
    trajectoriesRecorded: number;
    lastAdaptation: number | null;
    avgAdaptationTime: number;
}
interface Signal {
    type: string;
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
    timestamp: number;
}
interface StoredPattern {
    id: string;
    type: string;
    embedding: number[];
    content: string;
    confidence: number;
    usageCount: number;
    createdAt: number;
    lastUsedAt: number;
    metadata?: Record<string, unknown>;
}
/**
 * Lightweight SONA Coordinator
 * Uses circular buffer for O(1) signal recording
 * Achieves <0.05ms per operation
 */
declare class LocalSonaCoordinator {
    private config;
    private signals;
    private signalHead;
    private signalCount;
    private trajectories;
    private adaptationTimes;
    private currentTrajectorySteps;
    constructor(config: SonaConfig);
    /**
     * Record a signal - O(1) operation
     * Target: <0.05ms
     */
    recordSignal(signal: Signal): void;
    /**
     * Record complete trajectory
     */
    recordTrajectory(trajectory: {
        steps: TrajectoryStep[];
        verdict: string;
        timestamp: number;
    }): void;
    /**
     * Get recent signals
     */
    getRecentSignals(count?: number): Signal[];
    /**
     * Get average adaptation time
     */
    getAvgAdaptationTime(): number;
    /**
     * Add a step to the current in-progress trajectory
     */
    addTrajectoryStep(step: TrajectoryStep): void;
    /**
     * End the current trajectory with a verdict and apply RL updates.
     * Reward mapping: success=1.0, partial=0.5, failure=-0.5
     *
     * For successful/partial trajectories, boosts confidence of similar patterns
     * in the ReasoningBank. For failures, reduces confidence scores.
     */
    endTrajectory(verdict: 'success' | 'failure' | 'partial', bank: LocalReasoningBank): Promise<{
        reward: number;
        patternsUpdated: number;
    }>;
    /**
     * Distill learning from recent successful trajectories.
     * Applies LoRA-style confidence updates and integrates EWC++ consolidation.
     *
     * For each successful trajectory step with high confidence,
     * increases the pattern's stored confidence by loraLearningRate * reward.
     * Before applying updates, checks EWC penalty to prevent catastrophic forgetting.
     */
    distillLearning(bank: LocalReasoningBank): Promise<{
        patternsDistilled: number;
        ewcPenalty: number;
    }>;
    /**
     * Get current trajectory steps (for inspection)
     */
    getCurrentTrajectorySteps(): TrajectoryStep[];
    /**
     * Get statistics
     */
    stats(): {
        signalCount: number;
        trajectoryCount: number;
        avgAdaptationMs: number;
    };
}
/**
 * Lightweight ReasoningBank
 * Uses Map for O(1) storage and array for similarity search
 * Supports persistence to disk
 */
declare class LocalReasoningBank {
    private patterns;
    private patternList;
    private maxSize;
    private persistenceEnabled;
    private dirty;
    private saveTimeout;
    constructor(options: {
        maxSize: number;
        persistence?: boolean;
    });
    /**
     * Load patterns from disk
     */
    private loadFromDisk;
    /**
     * Save patterns to disk (debounced)
     */
    private saveToDisk;
    /**
     * Immediately flush patterns to disk
     */
    flushToDisk(): void;
    /**
     * Store a pattern - O(1)
     */
    store(pattern: Omit<StoredPattern, 'usageCount' | 'createdAt' | 'lastUsedAt'> & Partial<StoredPattern>): void;
    /**
     * Find similar patterns by embedding
     */
    findSimilar(queryEmbedding: number[], options: {
        k?: number;
        threshold?: number;
        type?: string;
    }): StoredPattern[];
    /**
     * Optimized cosine similarity
     */
    private cosineSim;
    /**
     * Get statistics
     */
    stats(): {
        size: number;
        patternCount: number;
    };
    /**
     * Get pattern by ID
     */
    get(id: string): StoredPattern | undefined;
    /**
     * Get all patterns
     */
    getAll(): StoredPattern[];
    /**
     * Get patterns by type
     */
    getByType(type: string): StoredPattern[];
    /**
     * Delete a pattern by ID
     */
    delete(id: string): boolean;
    /**
     * Clear all patterns
     */
    clear(): void;
}
/**
 * Initialize the intelligence system (SONA + ReasoningBank).
 * Promise-based singleton: concurrent callers share a single init flight.
 */
export declare function initializeIntelligence(config?: Partial<SonaConfig>): Promise<{
    success: boolean;
    sonaEnabled: boolean;
    reasoningBankEnabled: boolean;
    error?: string;
}>;
/**
 * Record a trajectory step for learning
 * Performance: <0.05ms without embedding generation
 */
export declare function recordStep(step: TrajectoryStep): Promise<boolean>;
/**
 * Record a complete trajectory with verdict
 */
export declare function recordTrajectory(steps: TrajectoryStep[], verdict: 'success' | 'failure' | 'partial'): Promise<boolean>;
/**
 * Find similar patterns from ReasoningBank
 */
export interface PatternMatch extends Pattern {
    similarity: number;
}
export declare function findSimilarPatterns(query: string, options?: {
    k?: number;
    threshold?: number;
    type?: string;
}): Promise<PatternMatch[]>;
/**
 * Get intelligence system statistics
 */
export declare function getIntelligenceStats(): IntelligenceStats;
/**
 * Get SONA coordinator for advanced operations
 */
export declare function getSonaCoordinator(): LocalSonaCoordinator | null;
/**
 * Get ReasoningBank for advanced operations
 */
export declare function getReasoningBank(): LocalReasoningBank | null;
/**
 * End the current trajectory with a verdict and apply RL updates.
 * This is the public API for the SONA RL loop.
 *
 * @param verdict - 'success' (reward=1.0), 'partial' (0.5), or 'failure' (-0.5)
 * @returns Update statistics or null if not initialized
 */
export declare function endTrajectoryWithVerdict(verdict: 'success' | 'failure' | 'partial'): Promise<{
    reward: number;
    patternsUpdated: number;
} | null>;
/**
 * Distill learning from recent successful trajectories.
 * Applies LoRA-style confidence updates with EWC++ consolidation protection.
 *
 * @returns Distillation statistics or null if not initialized
 */
export declare function distillLearning(): Promise<{
    patternsDistilled: number;
    ewcPenalty: number;
} | null>;
/**
 * Clear intelligence state
 */
export declare function clearIntelligence(): void;
/**
 * Benchmark SONA adaptation time
 */
export declare function benchmarkAdaptation(iterations?: number): {
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    targetMet: boolean;
};
/**
 * Get all patterns from ReasoningBank, merged with SONA routing patterns.
 * Returns persisted patterns even after process restart.
 */
export declare function getAllPatterns(): Promise<Pattern[]>;
/**
 * Get patterns by type from ReasoningBank
 */
export declare function getPatternsByType(type: string): Promise<Pattern[]>;
/**
 * Flush patterns to disk immediately
 * Call this at the end of training to ensure all patterns are saved
 */
export declare function flushPatterns(): void;
/**
 * Compact patterns by removing duplicates/similar patterns
 * @param threshold Similarity threshold (0-1), patterns above this are considered duplicates
 */
export declare function compactPatterns(threshold?: number): Promise<{
    before: number;
    after: number;
    removed: number;
}>;
/**
 * Delete a pattern by ID
 */
export declare function deletePattern(id: string): Promise<boolean>;
/**
 * Clear all patterns (both in memory and on disk)
 */
export declare function clearAllPatterns(): Promise<void>;
/**
 * Get the neural data directory path
 */
export declare function getNeuralDataDir(): string;
/**
 * Get persistence status
 */
export declare function getPersistenceStatus(): {
    enabled: boolean;
    dataDir: string;
    patternsFile: string;
    statsFile: string;
    patternsExist: boolean;
    statsExist: boolean;
};
export {};
//# sourceMappingURL=intelligence.d.ts.map