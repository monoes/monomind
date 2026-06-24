/**
 * Memory Read Operations
 * Search, list, and get entries from the memory database.
 * Split from memory-crud.ts (ARCH-4b).
 *
 * @module v1/cli/memory-read
 */
/**
 * Search entries using sql.js with vector similarity
 * Uses HNSW index for 150x faster search when available
 */
export declare function searchEntries(options: {
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
    }[];
    searchTime: number;
    error?: string;
}>;
/**
 * List all entries from the memory database
 */
export declare function listEntries(options: {
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
}>;
/**
 * Get a specific entry from the memory database
 */
export declare function getEntry(options: {
    key: string;
    namespace?: string;
    dbPath?: string;
    /** Agent ID for collaborative memory promotion tracking */
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
    error?: string;
}>;
//# sourceMappingURL=memory-read.d.ts.map