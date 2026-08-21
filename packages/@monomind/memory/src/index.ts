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
  // Memory Entry Types
  MemoryType,
  AccessLevel,
  ConsistencyLevel,
  DistanceMetric,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,

  // Query Types
  QueryType,
  MemoryQuery,
  SearchResult,
  SearchOptions,

  // HNSW Types
  HNSWConfig,
  HNSWStats,
  QuantizationConfig,

  // Backend Types
  IMemoryBackend,
  BackendStats,
  HealthCheckResult,
  ComponentHealth,

  // Cache Types
  CacheConfig,
  CacheStats,
  CachedEntry,

  // Migration Types
  MigrationSource,
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  MigrationError,

  // Event Types
  MemoryEventType,
  MemoryEvent,
  MemoryEventHandler,

  // SONA Types
  SONAMode,
  LearningPattern,

  // Utility Types
  EmbeddingGenerator,
} from './types.js';

// Utility Functions and Constants
export {
  generateMemoryId,
  createDefaultEntry,
  PERFORMANCE_TARGETS,
} from './types.js';

// ===== Core Components =====
import { SQLiteBackend } from './sqlite-backend.js';
export { SQLiteBackend };
export type { SQLiteBackendConfig } from './sqlite-backend.js';
export { SqlJsBackend } from './sqljs-backend.js';
export type { SqlJsBackendConfig } from './sqljs-backend.js';
export { HNSWIndex } from './hnsw-index.js';
export type { HNSWSerialized } from './hnsw-index.js';
export { CacheManager } from './cache-manager.js';
export { QueryBuilder, query, QueryTemplates } from './query-builder.js';
export type { SortDirection, SortField } from './query-builder.js';
export { MemoryMigrator, createMigrator, migrateMultipleSources } from './migration.js';

// ===== Graph Checkpointing =====
export { MonoswarmCheckpointer } from './checkpointer.js';
export type { AgentState, SwarmCheckpoint, CheckpointMeta } from './types/checkpoint.js';

// ===== Document Chunker & Knowledge Base =====
export { chunkDocument, KnowledgeStore, KnowledgeRetriever } from './knowledge/index.js';
export type {
  TextChunk,
  MetadataRecord,
  ChunkRecord,
  KnowledgeExcerpt,
  RetrievalResult,
  SearchFn,
} from './knowledge/index.js';

// ===== Prompt Version Management =====
export { PromptVersionStore } from './prompt-version-store.js';
export type {
  PromptVersion,
  PromptExperiment,
  DiffResult,
} from './prompt-version-store.js';

// Default export
export default SQLiteBackend;
