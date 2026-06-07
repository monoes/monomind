/**
 * Memory Bridge — Routes CLI memory operations through ControllerRegistry + AgentDB v1
 *
 * Per ADR-053 Phases 1-6: Full controller activation pipeline.
 * CLI → ControllerRegistry → AgentDB v1 controllers.
 *
 * Phase 1: Core CRUD + embeddings + HNSW + controller access (complete)
 * Phase 2: BM25 hybrid search, TieredCache read/write, MutationGuard validation
 * Phase 3: ReasoningBank pattern store, recordFeedback, CausalMemoryGraph edges
 * Phase 4: SkillLibrary promotion, ExplainableRecall provenance, AttestationLog
 * Phase 5: ReflexionMemory session lifecycle, WitnessChain attestation
 * Phase 6: AgentDB MCP tools (separate file), COW branching
 *
 * Uses better-sqlite3 API (synchronous .all()/.get()/.run()) since that's
 * what AgentDB v1 uses internally.
 *
 * @module v1/cli/memory-bridge
 */
export declare function safeParseEmbedding(raw: string | null | undefined): number[] | null;
/**
 * Store an entry via AgentDB v1.
 * Phase 2-5: Routes through MutationGuard → TieredCache → DB → AttestationLog.
 * Returns null to signal fallback to sql.js.
 */
export declare function bridgeStoreEntry(options: {
    key: string;
    value: string;
    namespace?: string;
    generateEmbeddingFlag?: boolean;
    tags?: string[];
    ttl?: number;
    dbPath?: string;
    upsert?: boolean;
}): Promise<{
    success: boolean;
    id: string;
    embedding?: {
        dimensions: number;
        model: string;
    };
    guarded?: boolean;
    cached?: boolean;
    attested?: boolean;
    error?: string;
} | null>;
/**
 * Search entries via AgentDB v1.
 * Phase 2: BM25 hybrid scoring replaces naive String.includes() keyword fallback.
 * Combines cosine similarity (semantic) with BM25 (lexical) via reciprocal rank fusion.
 */
export declare function bridgeSearchEntries(options: {
    query: string;
    namespace?: string;
    limit?: number;
    threshold?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    results: {
        id: string;
        key: string;
        content: string;
        score: number;
        namespace: string;
        provenance?: string;
    }[];
    searchTime: number;
    searchMethod?: string;
    error?: string;
} | null>;
/**
 * List entries via AgentDB v1.
 */
export declare function bridgeListEntries(options: {
    namespace?: string;
    limit?: number;
    offset?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    entries: {
        id: string;
        key: string;
        namespace: string;
        size: number;
        accessCount: number;
        createdAt: string;
        updatedAt: string;
        hasEmbedding: boolean;
    }[];
    total: number;
    error?: string;
} | null>;
/**
 * Get a specific entry via AgentDB v1.
 * Phase 2: TieredCache consulted before DB hit.
 */
export declare function bridgeGetEntry(options: {
    key: string;
    namespace?: string;
    dbPath?: string;
    /** Agent identifier for collaborative memory promotion tracking */
    agentId?: string;
}): Promise<{
    success: boolean;
    found: boolean;
    entry?: {
        id: string;
        key: string;
        namespace: string;
        content: string;
        accessCount: number;
        createdAt: string;
        updatedAt: string;
        hasEmbedding: boolean;
        tags: string[];
    };
    cacheHit?: boolean;
    error?: string;
} | null>;
/**
 * Delete an entry via AgentDB v1.
 * Phase 5: MutationGuard validation, cache invalidation, attestation logging.
 */
export declare function bridgeDeleteEntry(options: {
    key: string;
    namespace?: string;
    dbPath?: string;
}): Promise<{
    success: boolean;
    deleted: boolean;
    key: string;
    namespace: string;
    remainingEntries: number;
    guarded?: boolean;
    error?: string;
} | null>;
/**
 * Generate embedding via AgentDB v1's embedder.
 * Returns null if bridge unavailable — caller falls back to own ONNX/hash.
 */
export declare function bridgeGenerateEmbedding(text: string, dbPath?: string): Promise<{
    embedding: number[];
    dimensions: number;
    model: string;
} | null>;
/**
 * Load embedding model via AgentDB v1 (it loads on init).
 * Returns null if unavailable.
 */
export declare function bridgeLoadEmbeddingModel(dbPath?: string): Promise<{
    success: boolean;
    dimensions: number;
    modelName: string;
    loadTime?: number;
} | null>;
/**
 * Get HNSW status from AgentDB v1's vector backend or HNSW index.
 * Returns null if unavailable.
 */
export declare function bridgeGetHNSWStatus(dbPath?: string): Promise<{
    available: boolean;
    initialized: boolean;
    entryCount: number;
    dimensions: number;
} | null>;
/**
 * Search using AgentDB v1's embedder + SQLite entries.
 * This is the HNSW-equivalent search through the bridge.
 * Returns null if unavailable.
 */
export declare function bridgeSearchHNSW(queryEmbedding: number[], options?: {
    k?: number;
    namespace?: string;
    threshold?: number;
}, dbPath?: string): Promise<Array<{
    id: string;
    key: string;
    content: string;
    score: number;
    namespace: string;
}> | null>;
/**
 * Add entry to the bridge's database with embedding.
 * Returns null if unavailable.
 */
export declare function bridgeAddToHNSW(id: string, embedding: number[], entry: {
    id: string;
    key: string;
    namespace: string;
    content: string;
}, dbPath?: string): Promise<boolean | null>;
/**
 * Get a named controller from AgentDB v1 via ControllerRegistry.
 * Returns null if unavailable.
 */
export declare function bridgeGetController(name: string, dbPath?: string): Promise<any | null>;
/**
 * Check if a controller is available.
 */
export declare function bridgeHasController(name: string, dbPath?: string): Promise<boolean>;
/**
 * List all controllers and their status.
 */
export declare function bridgeListControllers(dbPath?: string): Promise<Array<{
    name: string;
    enabled: boolean;
    level: number;
}> | null>;
/**
 * Check if the AgentDB v1 bridge is available.
 */
export declare function isBridgeAvailable(dbPath?: string): Promise<boolean>;
/**
 * Get the ControllerRegistry instance (for advanced consumers).
 */
export declare function getControllerRegistry(dbPath?: string): Promise<any | null>;
/**
 * Shutdown the bridge and release resources.
 */
export declare function shutdownBridge(): Promise<void>;
/**
 * Store a pattern via ReasoningBank controller.
 * Falls back to raw SQL if ReasoningBank unavailable.
 */
export declare function bridgeStorePattern(options: {
    pattern: string;
    type: string;
    confidence: number;
    metadata?: Record<string, unknown>;
    dbPath?: string;
}): Promise<{
    success: boolean;
    patternId: string;
    controller: string;
} | null>;
/**
 * Search patterns via ReasoningBank controller.
 */
export declare function bridgeSearchPatterns(options: {
    query: string;
    topK?: number;
    minConfidence?: number;
    dbPath?: string;
}): Promise<{
    results: Array<{
        id: string;
        content: string;
        score: number;
    }>;
    controller: string;
} | null>;
/**
 * Record task feedback for learning via ReasoningBank or LearningSystem.
 * Wired into hooks_post-task handler.
 */
export declare function bridgeRecordFeedback(options: {
    taskId: string;
    success: boolean;
    quality: number;
    agent?: string;
    duration?: number;
    patterns?: string[];
    /**
     * Real task description text. When present it is embedded into the SONA
     * trajectory instead of the opaque `task:${taskId}` ID, so the MiniLM embedder
     * encodes meaningful semantics rather than a meaningless identifier.
     */
    task?: string;
    description?: string;
    /**
     * Whether the success/quality reflects a real, measured outcome rather than an
     * unverified caller assertion. When false, the SONA LoRA update is skipped so the
     * learning engine is never fed a fabricated label. Defaults to true to preserve
     * existing callers that pass an explicit, intentional success flag.
     */
    outcomeKnown?: boolean;
    dbPath?: string;
}): Promise<{
    success: boolean;
    controller: string;
    updated: number;
} | null>;
/**
 * Record a causal edge between two entries (e.g., task → result).
 */
export declare function bridgeRecordCausalEdge(options: {
    sourceId: string;
    targetId: string;
    relation: string;
    weight?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    controller: string;
} | null>;
/**
 * Start a session with ReflexionMemory episodic replay.
 * Loads relevant past session patterns for the new session.
 */
export declare function bridgeSessionStart(options: {
    sessionId: string;
    context?: string;
    dbPath?: string;
}): Promise<{
    success: boolean;
    controller: string;
    restoredPatterns: number;
    sessionId: string;
} | null>;
/**
 * End a session and persist episodic summary to ReflexionMemory.
 */
export declare function bridgeSessionEnd(options: {
    sessionId: string;
    summary?: string;
    tasksCompleted?: number;
    patternsLearned?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    controller: string;
    persisted: boolean;
} | null>;
/**
 * Route a task via AgentDB's SemanticRouter.
 * Returns null to fall back to local monovector router.
 */
export declare function bridgeRouteTask(options: {
    task: string;
    context?: string;
    dbPath?: string;
}): Promise<{
    route: string;
    confidence: number;
    agents: string[];
    controller: string;
} | null>;
/**
 * Get comprehensive bridge health including all controller statuses.
 */
export declare function bridgeHealthCheck(dbPath?: string): Promise<{
    available: boolean;
    controllers: Array<{
        name: string;
        enabled: boolean;
        level: number;
    }>;
    attestationCount?: number;
    cacheStats?: {
        size: number;
        hits: number;
        misses: number;
    };
    sonaErrorCount?: number;
} | null>;
/**
 * Store to hierarchical memory with tier.
 * Valid tiers: working, episodic, semantic
 *
 * Real HierarchicalMemory API (agentdb alpha.10+):
 *   store(content, importance?, tier?, options?) → Promise<string>
 * Stub API (fallback):
 *   store(key, value, tier) — synchronous
 */
export declare function bridgeHierarchicalStore(params: {
    key: string;
    value: string;
    tier?: string;
    importance?: number;
}): Promise<any>;
/**
 * Recall from hierarchical memory.
 *
 * Real HierarchicalMemory API (agentdb alpha.10+):
 *   recall(query: MemoryQuery) → Promise<MemoryItem[]>
 *   where MemoryQuery = { query, tier?, k?, threshold?, context?, includeDecayed? }
 * Stub API (fallback):
 *   recall(query: string, topK: number) → synchronous array
 */
export declare function bridgeHierarchicalRecall(params: {
    query: string;
    tier?: string;
    topK?: number;
}): Promise<any>;
/**
 * Run memory consolidation.
 *
 * Real MemoryConsolidation API (agentdb alpha.10+):
 *   consolidate() → Promise<ConsolidationReport>
 *   ConsolidationReport = { episodicProcessed, semanticCreated, memoriesForgotten, ... }
 * Stub API (fallback):
 *   consolidate() → { promoted, pruned, timestamp }
 */
export declare function bridgeConsolidate(params: {
    minAge?: number;
    maxEntries?: number;
}): Promise<any>;
/**
 * Batch operations (insert, update, delete).
 * - insert: calls insertEpisodes(entries) where entries are {content, metadata?}
 * - delete: calls bulkDelete(table, conditions) on episodes table
 * - update: calls bulkUpdate(table, updates, conditions) on episodes table
 */
export declare function bridgeBatchOperation(params: {
    operation: string;
    entries: any[];
}): Promise<any>;
/**
 * Synthesize context from memories.
 * ContextSynthesizer.synthesize is a static method that takes MemoryPattern[] (not a string).
 */
export declare function bridgeContextSynthesize(params: {
    query: string;
    maxEntries?: number;
}): Promise<any>;
/**
 * Route via SemanticRouter.
 * Available since agentdb 3.0.0-alpha.10 — semantic matching with keyword fallback.
 */
export declare function bridgeSemanticRoute(params: {
    input: string;
}): Promise<any>;
//# sourceMappingURL=memory-bridge.d.ts.map