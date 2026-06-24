/**
 * Memory Write Operations
 * Verify initialization, store, and delete entries.
 * Read operations (search, list, get) live in memory-read.ts (ARCH-4b split).
 *
 * @module v1/cli/memory-crud
 */
export { searchEntries, listEntries, getEntry } from './memory-read.js';
/**
 * Verify memory initialization works correctly
 * Tests: write, read, search, patterns
 */
export declare function verifyMemoryInit(dbPath: string, options?: {
    verbose?: boolean;
}): Promise<{
    success: boolean;
    tests: {
        name: string;
        passed: boolean;
        details?: string;
        duration?: number;
    }[];
    summary: {
        passed: number;
        failed: number;
        total: number;
    };
}>;
/**
 * Store an entry directly using sql.js
 * This bypasses MCP and writes directly to the database
 */
export declare function storeEntry(options: {
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
    error?: string;
}>;
/**
 * Delete a memory entry by key and namespace
 * Issue #980: Properly supports namespaced entries
 */
export declare function deleteEntry(options: {
    key: string;
    namespace?: string;
    dbPath?: string;
}): Promise<{
    success: boolean;
    deleted: boolean;
    key: string;
    namespace: string;
    remainingEntries: number;
    error?: string;
}>;
//# sourceMappingURL=memory-crud.d.ts.map