/**
 * Memory Bridge — Routes CLI memory operations through LanceDB
 *
 * Uses LanceDBBackend from @monoes/memory.
 * All exported function signatures are unchanged.
 *
 * @module v1/cli/memory-bridge
 */
export declare function safeParseEmbedding(raw: string | null | undefined): number[] | null;
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
        content: string;
        accessCount: number;
        createdAt: string;
        updatedAt: string;
        hasEmbedding: boolean;
        tags: string[];
    }[];
    total: number;
    error?: string;
} | null>;
export declare function bridgeGetEntry(options: {
    key: string;
    namespace?: string;
    dbPath?: string;
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
export declare function bridgeDeleteEntry(options: {
    key?: string;
    id?: string;
    namespace?: string;
    dbPath?: string;
}): Promise<{
    success: boolean;
    deleted: boolean;
    error?: string;
} | null>;
export declare function bridgeGenerateEmbedding(text: string, dbPath?: string): Promise<{
    embedding: number[];
    dimensions: number;
    model: string;
} | null>;
export declare function bridgeLoadEmbeddingModel(dbPath?: string): Promise<{
    success: boolean;
    dimensions: number;
    modelName: string;
    loadTime?: number;
} | null>;
export declare function bridgeGetHNSWStatus(dbPath?: string): Promise<{
    built: boolean;
    size: number;
    dimensions: number;
    error?: string;
} | null>;
export declare function bridgeSearchHNSW(options: {
    query: string;
    limit?: number;
    threshold?: number;
    namespace?: string;
    dbPath?: string;
}): Promise<{
    success: boolean;
    results: {
        id: string;
        key: string;
        score: number;
        namespace?: string;
    }[];
    searchTime: number;
    indexSize?: number;
    error?: string;
} | null>;
export declare function bridgeAddToHNSW(options: {
    id: string;
    embedding: number[];
    namespace?: string;
    dbPath?: string;
}): Promise<{
    success: boolean;
    indexSize?: number;
    error?: string;
} | null>;
export declare function bridgeGetController(controllerName: string, dbPath?: string): Promise<any | null>;
export declare function bridgeHasController(controllerName: string, dbPath?: string): Promise<boolean>;
export declare function bridgeListControllers(dbPath?: string): Promise<{
    controllers: string[];
    active: string[];
} | null>;
export declare function isBridgeAvailable(dbPath?: string): Promise<boolean>;
export declare function getControllerRegistry(dbPath?: string): Promise<any | null>;
export declare function shutdownBridge(): Promise<void>;
export declare function bridgeStorePattern(options: {
    pattern: string;
    taskType?: string;
    outcome?: string;
    confidence?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    id: string;
    error?: string;
} | null>;
export declare function bridgeSearchPatterns(options: {
    query: string;
    taskType?: string;
    limit?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    patterns: {
        id: string;
        pattern: string;
        confidence: number;
        taskType?: string;
        score: number;
    }[];
    error?: string;
} | null>;
export declare function bridgeRecordFeedback(options: {
    taskType: string;
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    confidence?: number;
    metadata?: Record<string, unknown>;
    dbPath?: string;
}): Promise<{
    success: boolean;
    id: string;
    error?: string;
} | null>;
export declare function bridgeRecordCausalEdge(options: {
    sourceId: string;
    targetId: string;
    relation: string;
    strength?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    id: string;
    error?: string;
} | null>;
export declare function bridgeSessionStart(options: {
    sessionId: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
    dbPath?: string;
}): Promise<{
    success: boolean;
    id: string;
    error?: string;
} | null>;
export declare function bridgeSessionEnd(options: {
    sessionId: string;
    summary?: string;
    metrics?: Record<string, unknown>;
    dbPath?: string;
}): Promise<{
    success: boolean;
    error?: string;
} | null>;
export declare function bridgeRouteTask(options: {
    task: string;
    topK?: number;
    dbPath?: string;
}): Promise<{
    success: boolean;
    routes: {
        agentType: string;
        confidence: number;
        pattern?: string;
    }[];
    error?: string;
} | null>;
export declare function bridgeHealthCheck(dbPath?: string): Promise<{
    healthy: boolean;
    backend: string;
    stats?: {
        totalEntries: number;
        namespaces: string[];
    };
    error?: string;
} | null>;
export declare function bridgeHierarchicalStore(params: {
    key: string;
    value: string;
    tier?: string;
    importance?: number;
}): Promise<any>;
export declare function bridgeHierarchicalRecall(params: {
    query: string;
    tier?: string;
    topK?: number;
}): Promise<any>;
export declare function bridgeConsolidate(params: {
    minAge?: number;
    maxEntries?: number;
}): Promise<any>;
export declare function bridgeBatchOperation(params: {
    operation: string;
    entries: any[];
}): Promise<any>;
export declare function bridgeContextSynthesize(params: {
    query: string;
    maxEntries?: number;
}): Promise<any>;
export declare function bridgeSemanticRoute(params: {
    input: string;
}): Promise<any>;
//# sourceMappingURL=memory-bridge.d.ts.map