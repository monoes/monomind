/**
 * Memory Initializer
 * Properly initializes the memory database with sql.js (WASM SQLite)
 * Includes pattern tables, vector embeddings, migration state tracking
 *
 * ADR-053: Routes through ControllerRegistry → LanceDB when available,
 * falls back to raw sql.js for backwards compatibility.
 *
 * @module v1/cli/memory-initializer
 */
export { MEMORY_SCHEMA } from './memory-schema.js';
export { getHNSWIndex, addToHNSWIndex, searchHNSWIndex, getHNSWStatus, clearHNSWIndex, rebuildSearchIndex, quantizeInt8, dequantizeInt8, quantizedCosineSim, getQuantizationStats, batchCosineSim, softmaxAttention, topKIndices, flashAttentionSearch, } from './hnsw-operations.js';
export { ensureSchemaColumns, checkAndMigrateLegacy, } from './memory-migrations.js';
export { loadEmbeddingModel, generateEmbedding, generateBatchEmbeddings, generateHashEmbedding, } from './embedding-operations.js';
export { verifyMemoryInit, storeEntry, searchEntries, listEntries, getEntry, deleteEntry, } from './memory-crud.js';
import { checkAndMigrateLegacy, ensureSchemaColumns } from './memory-migrations.js';
import { rebuildSearchIndex } from './hnsw-operations.js';
import { verifyMemoryInit, storeEntry, searchEntries, listEntries, getEntry, deleteEntry } from './memory-crud.js';
import { loadEmbeddingModel, generateEmbedding } from './embedding-operations.js';
/**
 * Initial metadata to insert after schema creation
 */
export declare function getInitialMetadata(backend: string): string;
/**
 * Memory initialization result
 */
export interface MemoryInitResult {
    success: boolean;
    backend: string;
    dbPath: string;
    schemaVersion: string;
    tablesCreated: string[];
    indexesCreated: string[];
    features: {
        vectorEmbeddings: boolean;
        patternLearning: boolean;
        temporalDecay: boolean;
        hnswIndexing: boolean;
        migrationTracking: boolean;
    };
    /** ADR-053: Controllers activated via ControllerRegistry */
    controllers?: {
        activated: string[];
        failed: string[];
        initTimeMs: number;
    };
    error?: string;
}
/**
 * Initialize the memory database properly using sql.js
 */
export declare function initializeMemoryDatabase(options: {
    backend?: string;
    dbPath?: string;
    force?: boolean;
    verbose?: boolean;
    migrate?: boolean;
}): Promise<MemoryInitResult>;
/**
 * Check if memory database is properly initialized
 */
export declare function checkMemoryInitialization(dbPath?: string): Promise<{
    initialized: boolean;
    version?: string;
    backend?: string;
    features?: {
        vectorEmbeddings: boolean;
        patternLearning: boolean;
        temporalDecay: boolean;
    };
    tables?: string[];
}>;
/**
 * Apply temporal decay to patterns
 * Reduces confidence of patterns that haven't been used recently
 */
export declare function applyTemporalDecay(dbPath?: string): Promise<{
    success: boolean;
    patternsDecayed: number;
    error?: string;
}>;
declare const _default: {
    initializeMemoryDatabase: typeof initializeMemoryDatabase;
    checkMemoryInitialization: typeof checkMemoryInitialization;
    checkAndMigrateLegacy: typeof checkAndMigrateLegacy;
    ensureSchemaColumns: typeof ensureSchemaColumns;
    applyTemporalDecay: typeof applyTemporalDecay;
    loadEmbeddingModel: typeof loadEmbeddingModel;
    generateEmbedding: typeof generateEmbedding;
    verifyMemoryInit: typeof verifyMemoryInit;
    storeEntry: typeof storeEntry;
    searchEntries: typeof searchEntries;
    listEntries: typeof listEntries;
    getEntry: typeof getEntry;
    deleteEntry: typeof deleteEntry;
    rebuildSearchIndex: typeof rebuildSearchIndex;
    MEMORY_SCHEMA: string;
    getInitialMetadata: typeof getInitialMetadata;
};
export default _default;
//# sourceMappingURL=memory-initializer.d.ts.map