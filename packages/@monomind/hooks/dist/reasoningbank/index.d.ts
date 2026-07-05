/**
 * V1 ReasoningBank - Pattern Learning with LanceDB
 *
 * Connects hooks to persistent vector storage using LanceDB.
 * No JSON - all patterns stored as vectors in memory.db
 *
 * Features:
 * - Real HNSW indexing (M=16, efConstruction=200) for 150x+ faster search
 * - Embeddings via backend embedder; deterministic hash fallback otherwise
 * - LanceDB backend for persistence
 * - Pattern promotion from short-term to long-term memory
 *
 * @module @monomind/hooks/reasoningbank
 */
import { EventEmitter } from 'node:events';
import type { HookContext } from '../types.js';
/**
 * Pattern stored in memory backend
 */
export interface GuidancePattern {
    id: string;
    strategy: string;
    domain: string;
    embedding: Float32Array;
    quality: number;
    usageCount: number;
    successCount: number;
    createdAt: number;
    updatedAt: number;
    metadata: Record<string, unknown>;
}
/**
 * Guidance result from pattern search
 */
export interface GuidanceResult {
    patterns: Array<{
        pattern: GuidancePattern;
        similarity: number;
    }>;
    context: string;
    recommendations: string[];
    agentSuggestion?: {
        agent: string;
        confidence: number;
        reasoning: string;
    };
    searchTimeMs: number;
}
/**
 * Agent routing result
 */
export interface RoutingResult {
    agent: string;
    confidence: number;
    alternatives: Array<{
        agent: string;
        confidence: number;
    }>;
    reasoning: string;
    historicalPerformance?: {
        successRate: number;
        avgQuality: number;
        taskCount: number;
    };
}
/**
 * ReasoningBank configuration
 */
export interface ReasoningBankConfig {
    /** Vector dimensions (384 for MiniLM, 1536 for OpenAI) */
    dimensions: number;
    /** HNSW M parameter */
    hnswM: number;
    /** HNSW ef construction */
    hnswEfConstruction: number;
    /** HNSW ef search */
    hnswEfSearch: number;
    /** Maximum patterns in short-term memory */
    maxShortTerm: number;
    /** Maximum patterns in long-term memory */
    maxLongTerm: number;
    /** Promotion threshold (usage count) */
    promotionThreshold: number;
    /** Quality threshold for promotion */
    qualityThreshold: number;
    /** Deduplication similarity threshold */
    dedupThreshold: number;
    /** Database path */
    dbPath: string;
    /** Use mock embeddings (for testing) */
    useMockEmbeddings?: boolean;
}
/**
 * ReasoningBank metrics
 */
export interface ReasoningBankMetrics {
    patternsStored: number;
    patternsRetrieved: number;
    searchCount: number;
    totalSearchTime: number;
    promotions: number;
    hnswSearchTime: number;
    bruteForceSearchTime: number;
}
/**
 * ReasoningBank - Vector-based pattern storage and retrieval
 *
 * Uses LanceDB for ANN-indexed pattern storage.
 * Provides guidance generation from learned patterns.
 */
export declare class ReasoningBank extends EventEmitter {
    private config;
    private memoryBackend;
    private hnswIndex;
    private embeddingService;
    private initialized;
    private useRealBackend;
    private shortTermPatterns;
    private longTermPatterns;
    private metrics;
    constructor(config?: Partial<ReasoningBankConfig>);
    /**
     * Initialize ReasoningBank with memory backend and ANN search
     */
    initialize(): Promise<void>;
    /**
     * Load optional dependencies
     */
    private loadDependencies;
    /**
     * Store a new pattern from hook execution
     */
    storePattern(strategy: string, domain: string, metadata?: Record<string, unknown>): Promise<{
        id: string;
        action: 'created' | 'updated';
    }>;
    /**
     * Convenience wrapper: embed a string query and search for similar patterns.
     *
     * @param query - Plain-text query to embed and search
     * @param options - Optional topK (default 5) and threshold (minimum similarity, default 0)
     * @returns Matching patterns sorted by descending similarity
     */
    search(query: string, options?: {
        topK?: number;
        threshold?: number;
    }): Promise<Array<{
        pattern: GuidancePattern;
        similarity: number;
    }>>;
    /**
     * Search for similar patterns using HNSW (if available) or brute-force
     */
    searchPatterns(query: string | Float32Array, k?: number): Promise<Array<{
        pattern: GuidancePattern;
        similarity: number;
    }>>;
    /**
     * Brute-force search (fallback)
     */
    private bruteForceSearch;
    /**
     * Generate guidance for a given context
     */
    generateGuidance(context: HookContext): Promise<GuidanceResult>;
    /**
     * Route task to optimal agent based on learned patterns
     */
    routeTask(task: string): Promise<RoutingResult>;
    /**
     * Record pattern usage outcome
     */
    recordOutcome(patternId: string, success: boolean): Promise<void>;
    /**
     * Consolidate patterns (dedup, prune, promote)
     * Called by HooksLearningDaemon
     */
    consolidate(): Promise<{
        duplicatesRemoved: number;
        patternsPruned: number;
        patternsPromoted: number;
    }>;
    /**
     * Get statistics
     */
    getStats(): {
        shortTermCount: number;
        longTermCount: number;
        metrics: ReasoningBankMetrics;
        avgSearchTime: number;
        useRealBackend: boolean;
        hnswSpeedup: number;
    };
    /**
     * Export patterns for backup/transfer
     */
    exportPatterns(): Promise<{
        shortTerm: GuidancePattern[];
        longTerm: GuidancePattern[];
    }>;
    /**
     * Import patterns from backup
     */
    importPatterns(data: {
        shortTerm: GuidancePattern[];
        longTerm: GuidancePattern[];
    }): Promise<{
        imported: number;
    }>;
    private ensureInitialized;
    private loadPatterns;
    private storeInMemory;
    private updateInStorage;
    private deleteFromStorage;
    private entryToPattern;
    private buildQueryFromContext;
    private detectDomains;
    private suggestAgent;
    private calculateQuality;
    private shouldPromote;
    private checkPromotion;
    private promotePattern;
    private cosineSimilarity;
}
export declare const reasoningBank: ReasoningBank;
/**
 * Hook handler: session-start → import auto memory, build graph.
 * Called by the session-start hook to hydrate memory backend with previous learnings.
 *
 * @param bridge - An initialized AutoMemoryBridge instance
 */
export declare function onSessionStart(bridge: {
    importFromAutoMemory(): Promise<unknown>;
}): Promise<void>;
/**
 * Hook handler: session-end → consolidate learnings, sync, curate.
 * Called by the session-end hook to persist session discoveries.
 *
 * @param bridge - An initialized AutoMemoryBridge instance
 */
export declare function onSessionEnd(bridge: {
    syncToAutoMemory(): Promise<unknown>;
    curateIndex(): Promise<void>;
}): Promise<void>;
/**
 * Hook handler: post-task → record task learnings as insights.
 * Called by the post-task hook when a task completes successfully.
 *
 * @param bridge - An initialized AutoMemoryBridge instance
 * @param result - Task result with optional learnings array
 */
export declare function onPostTask(bridge: {
    recordInsight(insight: {
        category: string;
        summary: string;
        detail?: string;
        source: string;
        confidence: number;
    }): Promise<void>;
}, result: {
    success: boolean;
    learnings?: Array<{
        summary: string;
        detail?: string;
        confidence?: number;
    }>;
    taskId?: string;
}): Promise<void>;
//# sourceMappingURL=index.d.ts.map