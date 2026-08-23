/**
 * @monomind/memory - Persistent Memory Backends for Monomind
 *
 * Provides SQLite-backed memory engines (better-sqlite3 native driver with
 * sql.js WASM fallback), dense vector embeddings storage, pure-JS HNSW indexing,
 * document chunking/retrieval, and cross-session checkpointers.
 *
 * @module @monomind/memory
 */

// ===== Core Types =====
export type {
  AccessLevel,
  BackendStats,
  // Cache Types
  CacheConfig,
  CachedEntry,
  CacheStats,
  ComponentHealth,
  ConsistencyLevel,
  DistanceMetric,
  // Utility Types
  EmbeddingGenerator,
  HealthCheckResult,
  // HNSW Types
  HNSWConfig,
  HNSWStats,
  // Backend Types
  IMemoryBackend,
  LearningPattern,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,
  MemoryEvent,
  MemoryEventHandler,
  // Event Types
  MemoryEventType,
  MemoryQuery,
  // Memory Entry Types
  MemoryType,
  MigrationConfig,
  MigrationError,
  MigrationProgress,
  MigrationResult,
  // Migration Types
  MigrationSource,
  QuantizationConfig,
  // Query Types
  QueryType,
  SearchOptions,
  SearchResult,
  // SONA Types
  SONAMode,
} from './types.js';

// Utility Functions and Constants
export {
  createDefaultEntry,
  generateMemoryId,
  PERFORMANCE_TARGETS,
} from './types.js';

// ===== Core Components =====
import { SQLiteBackend } from './sqlite-backend.js';

export { CacheManager } from './cache-manager.js';
// ===== Graph Checkpointing =====
export { MonoswarmCheckpointer } from './checkpointer.js';
export type { HNSWSerialized } from './hnsw-index.js';
export { HNSWIndex } from './hnsw-index.js';
export type {
  ChunkRecord,
  KnowledgeExcerpt,
  MetadataRecord,
  RetrievalResult,
  SearchFn,
  TextChunk,
} from './knowledge/index.js';
// ===== Document Chunker & Knowledge Base =====
export { chunkDocument, KnowledgeRetriever, KnowledgeStore } from './knowledge/index.js';
export { createMigrator, MemoryMigrator, migrateMultipleSources } from './migration.js';
export type {
  DiffResult,
  PromptExperiment,
  PromptVersion,
} from './prompt-version-store.js';
// ===== Prompt Version Management =====
export { PromptVersionStore } from './prompt-version-store.js';
export type { SortDirection, SortField } from './query-builder.js';
export { QueryBuilder, QueryTemplates, query } from './query-builder.js';
export type { SQLiteBackendConfig } from './sqlite-backend.js';
export type { SqlJsBackendConfig } from './sqljs-backend.js';
export { SqlJsBackend } from './sqljs-backend.js';
export type { AgentState, CheckpointMeta, SwarmCheckpoint } from './types/checkpoint.js';
export { SQLiteBackend };

// Default export
export default SQLiteBackend;
