/**
 * Memory Initializer
 * Properly initializes the memory database with sql.js (WASM SQLite)
 * Includes pattern tables, vector embeddings, migration state tracking
 *
 * ADR-053: Routes through ControllerRegistry → AgentDB v1 when available,
 * falls back to raw sql.js for backwards compatibility.
 *
 * @module v1/cli/memory-initializer
 */
/**
 * Enhanced schema with pattern confidence, temporal decay, versioning
 * Vector embeddings enabled for semantic search
 */
export declare const MEMORY_SCHEMA = "\n-- Monomind Memory Database\n-- Version: 3.0.0\n-- Features: Pattern learning, vector embeddings, temporal decay, migration tracking\n\nPRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;\nPRAGMA foreign_keys = ON;\n\n-- ============================================\n-- CORE MEMORY TABLES\n-- ============================================\n\n-- Memory entries (main storage)\nCREATE TABLE IF NOT EXISTS memory_entries (\n  id TEXT PRIMARY KEY,\n  key TEXT NOT NULL,\n  namespace TEXT DEFAULT 'default',\n  content TEXT NOT NULL,\n  type TEXT DEFAULT 'semantic' CHECK(type IN ('semantic', 'episodic', 'procedural', 'working', 'pattern')),\n\n  -- Vector embedding for semantic search (stored as JSON array)\n  embedding TEXT,\n  embedding_model TEXT DEFAULT 'local',\n  embedding_dimensions INTEGER,\n\n  -- Metadata\n  tags TEXT, -- JSON array\n  metadata TEXT, -- JSON object\n  owner_id TEXT,\n\n  -- Timestamps\n  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  expires_at INTEGER,\n  last_accessed_at INTEGER,\n\n  -- Access tracking for hot/cold detection\n  access_count INTEGER DEFAULT 0,\n\n  -- Status\n  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),\n\n  UNIQUE(namespace, key)\n);\n\n-- Indexes for memory entries\nCREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries(namespace);\nCREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(key);\nCREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);\nCREATE INDEX IF NOT EXISTS idx_memory_status ON memory_entries(status);\nCREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at);\nCREATE INDEX IF NOT EXISTS idx_memory_accessed ON memory_entries(last_accessed_at);\nCREATE INDEX IF NOT EXISTS idx_memory_owner ON memory_entries(owner_id);\n\n-- ============================================\n-- PATTERN LEARNING TABLES\n-- ============================================\n\n-- Learned patterns with confidence scoring and versioning\nCREATE TABLE IF NOT EXISTS patterns (\n  id TEXT PRIMARY KEY,\n\n  -- Pattern identification\n  name TEXT NOT NULL,\n  pattern_type TEXT NOT NULL CHECK(pattern_type IN (\n    'task-routing', 'error-recovery', 'optimization', 'learning',\n    'coordination', 'prediction', 'code-pattern', 'workflow'\n  )),\n\n  -- Pattern definition\n  condition TEXT NOT NULL, -- Regex or semantic match\n  action TEXT NOT NULL, -- What to do when pattern matches\n  description TEXT,\n\n  -- Confidence scoring (0.0 - 1.0)\n  confidence REAL DEFAULT 0.5,\n  success_count INTEGER DEFAULT 0,\n  failure_count INTEGER DEFAULT 0,\n\n  -- Temporal decay\n  decay_rate REAL DEFAULT 0.01, -- How fast confidence decays\n  half_life_days INTEGER DEFAULT 30, -- Days until confidence halves without use\n\n  -- Vector embedding for semantic pattern matching\n  embedding TEXT,\n  embedding_dimensions INTEGER,\n\n  -- Versioning\n  version INTEGER DEFAULT 1,\n  parent_id TEXT REFERENCES patterns(id),\n\n  -- Metadata\n  tags TEXT, -- JSON array\n  metadata TEXT, -- JSON object\n  source TEXT, -- Where the pattern was learned from\n\n  -- Timestamps\n  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  last_matched_at INTEGER,\n  last_success_at INTEGER,\n  last_failure_at INTEGER,\n\n  -- Status\n  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deprecated', 'experimental'))\n);\n\n-- Indexes for patterns\nCREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);\nCREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC);\nCREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);\nCREATE INDEX IF NOT EXISTS idx_patterns_last_matched ON patterns(last_matched_at);\n\n-- Pattern evolution history (for versioning)\nCREATE TABLE IF NOT EXISTS pattern_history (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  pattern_id TEXT NOT NULL REFERENCES patterns(id),\n  version INTEGER NOT NULL,\n\n  -- Snapshot of pattern state\n  confidence REAL,\n  success_count INTEGER,\n  failure_count INTEGER,\n  condition TEXT,\n  action TEXT,\n\n  -- What changed\n  change_type TEXT CHECK(change_type IN ('created', 'updated', 'success', 'failure', 'decay', 'merged', 'split')),\n  change_reason TEXT,\n\n  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)\n);\n\nCREATE INDEX IF NOT EXISTS idx_pattern_history_pattern ON pattern_history(pattern_id);\n\n-- ============================================\n-- LEARNING & TRAJECTORY TABLES\n-- ============================================\n\n-- Learning trajectories (SONA integration)\nCREATE TABLE IF NOT EXISTS trajectories (\n  id TEXT PRIMARY KEY,\n  session_id TEXT,\n\n  -- Trajectory state\n  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed', 'abandoned')),\n  verdict TEXT CHECK(verdict IN ('success', 'failure', 'partial', NULL)),\n\n  -- Context\n  task TEXT,\n  context TEXT, -- JSON object\n\n  -- Metrics\n  total_steps INTEGER DEFAULT 0,\n  total_reward REAL DEFAULT 0,\n\n  -- Timestamps\n  started_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  ended_at INTEGER,\n\n  -- Reference to extracted pattern (if any)\n  extracted_pattern_id TEXT REFERENCES patterns(id)\n);\n\n-- Trajectory steps\nCREATE TABLE IF NOT EXISTS trajectory_steps (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  trajectory_id TEXT NOT NULL REFERENCES trajectories(id),\n  step_number INTEGER NOT NULL,\n\n  -- Step data\n  action TEXT NOT NULL,\n  observation TEXT,\n  reward REAL DEFAULT 0,\n\n  -- Metadata\n  metadata TEXT, -- JSON object\n\n  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)\n);\n\nCREATE INDEX IF NOT EXISTS idx_steps_trajectory ON trajectory_steps(trajectory_id);\n\n-- ============================================\n-- MIGRATION STATE TRACKING\n-- ============================================\n\n-- Migration state (for resume capability)\nCREATE TABLE IF NOT EXISTS migration_state (\n  id TEXT PRIMARY KEY,\n  migration_type TEXT NOT NULL, -- 'v2-to-v1', 'pattern', 'memory', etc.\n\n  -- Progress tracking\n  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'rolled_back')),\n  total_items INTEGER DEFAULT 0,\n  processed_items INTEGER DEFAULT 0,\n  failed_items INTEGER DEFAULT 0,\n  skipped_items INTEGER DEFAULT 0,\n\n  -- Current position (for resume)\n  current_batch INTEGER DEFAULT 0,\n  last_processed_id TEXT,\n\n  -- Source/destination info\n  source_path TEXT,\n  source_type TEXT,\n  destination_path TEXT,\n\n  -- Backup info\n  backup_path TEXT,\n  backup_created_at INTEGER,\n\n  -- Error tracking\n  last_error TEXT,\n  errors TEXT, -- JSON array of errors\n\n  -- Timestamps\n  started_at INTEGER,\n  completed_at INTEGER,\n  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)\n);\n\n-- ============================================\n-- SESSION MANAGEMENT\n-- ============================================\n\n-- Sessions for context persistence\nCREATE TABLE IF NOT EXISTS sessions (\n  id TEXT PRIMARY KEY,\n\n  -- Session state\n  state TEXT NOT NULL, -- JSON object with full session state\n  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'expired')),\n\n  -- Context\n  project_path TEXT,\n  branch TEXT,\n\n  -- Metrics\n  tasks_completed INTEGER DEFAULT 0,\n  patterns_learned INTEGER DEFAULT 0,\n\n  -- Timestamps\n  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  expires_at INTEGER\n);\n\n-- ============================================\n-- VECTOR INDEX METADATA (for HNSW)\n-- ============================================\n\n-- Track HNSW index state\nCREATE TABLE IF NOT EXISTS vector_indexes (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n\n  -- Index configuration\n  dimensions INTEGER NOT NULL,\n  metric TEXT DEFAULT 'cosine' CHECK(metric IN ('cosine', 'euclidean', 'dot')),\n\n  -- HNSW parameters\n  hnsw_m INTEGER DEFAULT 16,\n  hnsw_ef_construction INTEGER DEFAULT 200,\n  hnsw_ef_search INTEGER DEFAULT 100,\n\n  -- Quantization\n  quantization_type TEXT CHECK(quantization_type IN ('none', 'scalar', 'product')),\n  quantization_bits INTEGER DEFAULT 8,\n\n  -- Statistics\n  total_vectors INTEGER DEFAULT 0,\n  last_rebuild_at INTEGER,\n\n  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),\n  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)\n);\n\n-- ============================================\n-- SYSTEM METADATA\n-- ============================================\n\nCREATE TABLE IF NOT EXISTS metadata (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL,\n  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)\n);\n";
interface HNSWEntry {
    id: string;
    key: string;
    namespace: string;
    content: string;
}
interface HNSWIndex {
    db: any;
    entries: Map<string, HNSWEntry>;
    dimensions: number;
    initialized: boolean;
}
/**
 * Get or create the HNSW index singleton
 * Lazily initializes from SQLite data on first use
 */
export declare function getHNSWIndex(options?: {
    dbPath?: string;
    dimensions?: number;
    forceRebuild?: boolean;
}): Promise<HNSWIndex | null>;
/**
 * Add entry to HNSW index (with automatic persistence)
 */
export declare function addToHNSWIndex(id: string, embedding: number[], entry: HNSWEntry): Promise<boolean>;
/**
 * Search HNSW index (150x faster than brute-force)
 * Returns results sorted by similarity (highest first)
 */
export declare function searchHNSWIndex(queryEmbedding: number[], options?: {
    k?: number;
    namespace?: string;
}): Promise<Array<{
    id: string;
    key: string;
    content: string;
    score: number;
    namespace: string;
}> | null>;
/**
 * Get HNSW index status
 */
export declare function getHNSWStatus(): {
    available: boolean;
    initialized: boolean;
    entryCount: number;
    dimensions: number;
};
/**
 * Clear the HNSW index (for rebuilding)
 */
export declare function clearHNSWIndex(): void;
/**
 * Invalidate the in-memory HNSW cache so the next search rebuilds from DB.
 * Call this after deleting entries that had embeddings to prevent ghost
 * vectors from appearing in search results.
 */
export declare function rebuildSearchIndex(): void;
/**
 * Quantize a Float32 embedding to Int8 (4x memory reduction)
 * Uses symmetric quantization with scale factor stored per-vector
 *
 * @param embedding - Float32 embedding array
 * @returns Quantized Int8 array with scale factor
 */
export declare function quantizeInt8(embedding: number[] | Float32Array): {
    quantized: Int8Array;
    scale: number;
    zeroPoint: number;
};
/**
 * Dequantize Int8 back to Float32
 *
 * @param quantized - Int8 quantized array
 * @param scale - Scale factor from quantization
 * @param zeroPoint - Zero point (usually 0 for symmetric)
 * @returns Float32Array
 */
export declare function dequantizeInt8(quantized: Int8Array, scale: number, zeroPoint?: number): Float32Array;
/**
 * Compute cosine similarity between quantized vectors
 * Faster than dequantizing first
 */
export declare function quantizedCosineSim(a: Int8Array, aScale: number, b: Int8Array, bScale: number): number;
/**
 * Get quantization statistics for an embedding
 */
export declare function getQuantizationStats(embedding: number[] | Float32Array): {
    originalBytes: number;
    quantizedBytes: number;
    compressionRatio: number;
};
/**
 * Batch cosine similarity - compute query against multiple vectors
 * Optimized for V8 JIT with typed arrays
 * ~50μs per 1000 vectors (384-dim)
 */
export declare function batchCosineSim(query: Float32Array | number[], vectors: (Float32Array | number[])[]): Float32Array;
/**
 * Softmax normalization for attention scores
 * Numerically stable implementation
 */
export declare function softmaxAttention(scores: Float32Array, temperature?: number): Float32Array;
/**
 * Top-K selection with partial sort (O(n + k log k))
 * More efficient than full sort for small k
 */
export declare function topKIndices(scores: Float32Array, k: number): number[];
/**
 * Flash Attention-style search
 * Combines batch similarity, softmax, and top-k in one pass
 * Returns indices and attention weights
 */
export declare function flashAttentionSearch(query: Float32Array | number[], vectors: (Float32Array | number[])[], options?: {
    k?: number;
    temperature?: number;
    threshold?: number;
}): {
    indices: number[];
    scores: Float32Array;
    weights: Float32Array;
};
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
 * Ensure memory_entries table has all required columns
 * Adds missing columns for older databases (e.g., 'content' column)
 */
export declare function ensureSchemaColumns(dbPath: string): Promise<{
    success: boolean;
    columnsAdded: string[];
    error?: string;
}>;
/**
 * Check for legacy database installations and migrate if needed
 */
export declare function checkAndMigrateLegacy(options: {
    dbPath: string;
    verbose?: boolean;
}): Promise<{
    needsMigration: boolean;
    legacyVersion?: string;
    legacyEntries?: number;
    migrated?: boolean;
    migratedCount?: number;
}>;
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
/**
 * Lazy load ONNX embedding model
 * Only loads when first embedding is requested
 */
export declare function loadEmbeddingModel(options?: {
    modelPath?: string;
    verbose?: boolean;
}): Promise<{
    success: boolean;
    dimensions: number;
    modelName: string;
    loadTime?: number;
    error?: string;
}>;
/**
 * Generate real embedding for text
 * Uses ONNX model if available, falls back to deterministic hash
 */
export declare function generateEmbedding(text: string): Promise<{
    embedding: number[];
    dimensions: number;
    model: string;
}>;
/**
 * Generate embeddings for multiple texts
 * Uses parallel execution for API-based providers (2-4x faster)
 * Note: Local ONNX inference is CPU-bound, so parallelism has limited benefit
 *
 * @param texts - Array of texts to embed
 * @param options - Batch options
 * @returns Array of embedding results with timing info
 */
export declare function generateBatchEmbeddings(texts: string[], options?: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
}): Promise<{
    results: Array<{
        text: string;
        embedding: number[];
        dimensions: number;
        model: string;
    }>;
    totalTime: number;
    avgTime: number;
}>;
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