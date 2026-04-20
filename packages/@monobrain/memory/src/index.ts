/**
 * @monobrain/memory - V1 Unified Memory System
 *
 * Provides a unified memory interface backed by AgentDB with HNSW indexing
 * for 150x-12,500x faster vector search compared to brute-force approaches.
 *
 * @module @monobrain/memory
 */

// ===== Core Types =====
export * from './types.js';

// ===== Auto Memory Bridge (ADR-048) =====
export { AutoMemoryBridge, resolveAutoMemoryDir, findGitRoot } from './auto-memory-bridge.js';
export type {
  AutoMemoryBridgeConfig,
  MemoryInsight,
  InsightCategory,
  SyncDirection,
  SyncMode,
  PruneStrategy,
  SyncResult,
  ImportResult,
} from './auto-memory-bridge.js';

// ===== Learning Bridge =====
export { LearningBridge } from './learning-bridge.js';
export type {
  LearningBridgeConfig,
  LearningStats,
  ConsolidateResult,
  PatternMatch,
} from './learning-bridge.js';

// ===== RVF Learning Persistence (ADR-057 Phase 6) =====
export { RvfLearningStore } from './rvf-learning-store.js';
export type {
  RvfLearningStoreConfig,
  PatternRecord,
  LoraRecord,
  EwcRecord,
  TrajectoryRecord,
} from './rvf-learning-store.js';
export { PersistentSonaCoordinator } from './persistent-sona.js';
export type { PersistentSonaConfig } from './persistent-sona.js';

// ===== RVF Migration (Bidirectional) =====
export { RvfMigrator } from './rvf-migration.js';
export type { RvfMigrationOptions, RvfMigrationResult } from './rvf-migration.js';

// ===== Knowledge Graph =====
export { MemoryGraph } from './memory-graph.js';
export type {
  MemoryGraphConfig,
  GraphNode,
  GraphEdge,
  GraphStats,
  RankedResult,
  EdgeType,
} from './memory-graph.js';

// ===== Controller Registry (ADR-053) =====
export { ControllerRegistry, INIT_LEVELS } from './controller-registry.js';
export type {
  AgentDBControllerName,
  CLIControllerName,
  ControllerName,
  InitLevel,
  ControllerHealth,
  RegistryHealthReport,
  RuntimeConfig,
} from './controller-registry.js';

// ===== Core Components =====
export { AgentDBAdapter } from './agentdb-adapter.js';
export type { AgentDBAdapterConfig } from './agentdb-adapter.js';
export { RvfBackend } from './rvf-backend.js';
export type { RvfBackendConfig } from './rvf-backend.js';
export { HnswLite, cosineSimilarity } from './hnsw-lite.js';
export type { HnswSearchResult } from './hnsw-lite.js';
export { HNSWIndex } from './hnsw-index.js';
export { createDatabase, getPlatformInfo, getAvailableProviders } from './database-provider.js';
export type { DatabaseProvider, DatabaseOptions } from './database-provider.js';

// ===== Graph Checkpointing (Task 08) =====
export { SwarmCheckpointer } from './checkpointer.js';
export type { AgentState, SwarmCheckpoint, CheckpointMeta } from './types/checkpoint.js';

// ===== Multi-Tier Memory (Task 09) =====
export { TierManager } from './tier-manager.js';
export { ShortTermMemory, EntityMemory } from './tiers/index.js';
export type { EntityFact, SessionSummary } from './tiers/index.js';
export type { MemoryTier, TierManagerConfig } from './types.js';

// ===== Episodic Memory (Task 11) =====
export { EpisodicStore } from './episodic-store.js';
export type { Episode, EpisodicStoreConfig } from './types.js';

// ===== Per-Agent Knowledge Base (Task 28) =====
export { chunkDocument, KnowledgeStore, KnowledgeRetriever } from './knowledge/index.js';
export type {
  TextChunk,
  MetadataRecord,
  ChunkRecord,
  KnowledgeExcerpt,
  RetrievalResult,
  SearchFn,
} from './knowledge/index.js';

// ===== Unified Memory Service =====
import { EventEmitter } from 'node:events';
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchResult,
  SearchOptions,
  BackendStats,
  HealthCheckResult,
  EmbeddingGenerator,
  MigrationSource,
  MigrationConfig,
  MigrationResult,
} from './types.js';
import { AgentDBAdapter, AgentDBAdapterConfig } from './agentdb-adapter.js';
import { MemoryMigrator } from './migration.js';

/**
 * Configuration for UnifiedMemoryService
 */
export interface UnifiedMemoryServiceConfig extends Partial<AgentDBAdapterConfig> {
  /** Enable automatic embedding generation */
  autoEmbed?: boolean;

  /** Default embedding dimensions */
  dimensions?: number;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;
}

/**
 * Unified Memory Service
 *
 * High-level interface for the V1 memory system that provides:
 * - Simple API for common operations
 * - Automatic embedding generation
 * - Cross-agent memory sharing
 * - SONA integration for learning
 * - Event-driven notifications
 * - Performance monitoring
 */
export class UnifiedMemoryService extends EventEmitter implements IMemoryBackend {
  private adapter: AgentDBAdapter;
  private config: UnifiedMemoryServiceConfig;
  private initialized: boolean = false;

  constructor(config: UnifiedMemoryServiceConfig = {}) {
    super();
    this.config = {
      dimensions: 1536,
      cacheEnabled: true,
      autoEmbed: true,
      ...config,
    };

    this.adapter = new AgentDBAdapter({
      dimensions: this.config.dimensions,
      cacheEnabled: this.config.cacheEnabled,
      cacheSize: this.config.cacheSize,
      cacheTtl: this.config.cacheTtl,
      hnswM: this.config.hnswM,
      hnswEfConstruction: this.config.hnswEfConstruction,
      defaultNamespace: this.config.defaultNamespace,
      embeddingGenerator: this.config.embeddingGenerator,
      persistenceEnabled: this.config.persistenceEnabled,
      persistencePath: this.config.persistencePath,
      maxEntries: this.config.maxEntries,
    });

    // Forward adapter events
    this.adapter.on('entry:stored', (data) => this.emit('entry:stored', data));
    this.adapter.on('entry:updated', (data) => this.emit('entry:updated', data));
    this.adapter.on('entry:deleted', (data) => this.emit('entry:deleted', data));
    this.adapter.on('cache:hit', (data) => this.emit('cache:hit', data));
    this.adapter.on('cache:miss', (data) => this.emit('cache:miss', data));
    this.adapter.on('index:added', (data) => this.emit('index:added', data));
  }

  // ===== Lifecycle =====

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.adapter.initialize();
    this.initialized = true;
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await this.adapter.shutdown();
    this.initialized = false;
    this.emit('shutdown');
  }

  // ===== IMemoryBackend Implementation =====

  async store(entry: MemoryEntry): Promise<void> {
    return this.adapter.store(entry);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.adapter.get(id);
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    return this.adapter.getByKey(namespace, key);
  }

  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    return this.adapter.update(id, update);
  }

  async delete(id: string): Promise<boolean> {
    return this.adapter.delete(id);
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.adapter.query(query);
  }

  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    return this.adapter.search(embedding, options);
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    return this.adapter.bulkInsert(entries);
  }

  async bulkDelete(ids: string[]): Promise<number> {
    return this.adapter.bulkDelete(ids);
  }

  async count(namespace?: string): Promise<number> {
    return this.adapter.count(namespace);
  }

  async listNamespaces(): Promise<string[]> {
    return this.adapter.listNamespaces();
  }

  async clearNamespace(namespace: string): Promise<number> {
    return this.adapter.clearNamespace(namespace);
  }

  async getStats(): Promise<BackendStats> {
    return this.adapter.getStats();
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return this.adapter.healthCheck();
  }

  // ===== Convenience Methods =====

  /**
   * Store an entry from simple input
   */
  async storeEntry(input: MemoryEntryInput): Promise<MemoryEntry> {
    return this.adapter.storeEntry(input);
  }

  /**
   * Semantic search by content string
   */
  async semanticSearch(
    content: string,
    k: number = 10,
    threshold?: number
  ): Promise<SearchResult[]> {
    return this.adapter.semanticSearch(content, k, threshold);
  }

  /**
   * Find similar entries to a given entry
   */
  async findSimilar(id: string, k: number = 5): Promise<SearchResult[]> {
    const entry = await this.get(id);
    if (!entry || !entry.embedding) {
      return [];
    }

    const results = await this.search(entry.embedding, { k: k + 1 });

    // Filter out the source entry
    return results.filter((r) => r.entry.id !== id).slice(0, k);
  }

  /**
   * Get or create an entry
   */
  async getOrCreate(
    namespace: string,
    key: string,
    creator: () => MemoryEntryInput | Promise<MemoryEntryInput>
  ): Promise<MemoryEntry> {
    const existing = await this.getByKey(namespace, key);
    if (existing) return existing;

    const input = await creator();
    return this.storeEntry({ ...input, namespace, key });
  }

  /**
   * Append content to an existing entry
   */
  async appendContent(id: string, content: string): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    return this.update(id, {
      content: entry.content + '\n' + content,
    });
  }

  /**
   * Add tags to an existing entry
   */
  async addTags(id: string, tags: string[]): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const newTags = [...new Set([...entry.tags, ...tags])];
    return this.update(id, { tags: newTags });
  }

  /**
   * Remove tags from an existing entry
   */
  async removeTags(id: string, tags: string[]): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const newTags = entry.tags.filter((t) => !tags.includes(t));
    return this.update(id, { tags: newTags });
  }

  // ===== Migration =====

  /**
   * Migrate from a legacy memory source
   */
  async migrateFrom(
    source: MigrationSource,
    sourcePath: string,
    options: Partial<MigrationConfig> = {}
  ): Promise<MigrationResult> {
    const migrator = new MemoryMigrator(
      this.adapter,
      { source, sourcePath, ...options },
      this.config.embeddingGenerator
    );

    // Forward migration events
    migrator.on('migration:started', (data) => this.emit('migration:started', data));
    migrator.on('migration:progress', (data) => this.emit('migration:progress', data));
    migrator.on('migration:completed', (data) => this.emit('migration:completed', data));
    migrator.on('migration:failed', (data) => this.emit('migration:failed', data));
    migrator.on('migration:error', (data) => this.emit('migration:error', data));
    migrator.on('migration:warning', (data) => this.emit('migration:warning', data));

    return migrator.migrate();
  }

  // ===== Cross-Agent Memory Sharing =====

  /**
   * Share an entry with another agent
   */
  async shareWith(id: string, agentId: string): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const sharedWith = (entry.metadata.sharedWith as string[]) || [];
    if (!sharedWith.includes(agentId)) {
      sharedWith.push(agentId);
    }

    return this.update(id, {
      metadata: { ...entry.metadata, sharedWith },
    });
  }

  /**
   * Get entries shared with a specific agent
   */
  async getSharedWith(agentId: string): Promise<MemoryEntry[]> {
    const all = await this.query({ type: 'hybrid', limit: 10000 });
    return all.filter((entry) => {
      const sharedWith = (entry.metadata.sharedWith as string[]) || [];
      return sharedWith.includes(agentId);
    });
  }

  // ===== Utility =====

  /**
   * Get the underlying adapter for advanced operations
   */
  getAdapter(): AgentDBAdapter {
    return this.adapter;
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// ===== Factory Functions =====


/**
 * Create a persistent memory service
 */
export function createPersistentService(path: string): UnifiedMemoryService {
  return new UnifiedMemoryService({
    persistenceEnabled: true,
    persistencePath: path,
    cacheEnabled: true,
  });
}


// ===== Prompt Version Management (Task 24) =====
export { PromptVersionStore } from './prompt-version-store.js';
export type {
  PromptVersion,
  PromptExperiment,
  DiffResult,
} from './prompt-version-store.js';

// ===== Procedural Memory (Task 45) =====
export type {
  ActionOutcome,
  ActionRecord,
  ExtractionConfig,
  SkillTrigger,
  LearnedSkill,
  ActionSequenceGroup,
} from './procedural/index.js';
export { ActionRecordStore } from './procedural/index.js';
export { ActionSequenceExtractor } from './procedural/index.js';
export { LearnedSkillSerializer } from './procedural/index.js';
export { SkillRegistry } from './procedural/index.js';

