/**
 * ControllerRegistry - Central controller lifecycle management for memory backend
 *
 * Wraps the LanceDB backend and adds CLI-specific controllers from @monomind/memory.
 * Manages initialization (level-based ordering), health checks, and graceful shutdown.
 *
 * Per ADR-053: Replaces memory-initializer.js's raw sql.js usage with a unified
 * controller ecosystem routing all memory operations through LanceDB.
 *
 * @module @monomind/memory/controller-registry
 */

import { EventEmitter } from 'node:events';
import type {
  IMemoryBackend,
  HealthCheckResult,
  ComponentHealth,
  BackendStats,
  EmbeddingGenerator,
  SONAMode,
} from './types.js';
import { LearningBridge } from './learning-bridge.js';
import type { LearningBridgeConfig } from './learning-bridge.js';
import { MemoryGraph } from './memory-graph.js';
import type { MemoryGraphConfig } from './memory-graph.js';
import { TieredCacheManager } from './cache-manager.js';
import type { CacheConfig } from './types.js';

// ===== Types =====

/**
 * Memory controllers
 */
export type MemoryControllerName =
  | 'reasoningBank'
  | 'skills'
  | 'reflexion'
  | 'causalGraph'
  | 'causalRecall'
  | 'learningSystem'
  | 'explainableRecall'
  | 'nightlyLearner'
  | 'graphTransformer'
  | 'mutationGuard'
  | 'attestationLog'
  | 'vectorBackend'
  | 'graphAdapter';

/**
 * CLI-layer controllers (from @monomind/memory or new)
 */
export type CLIControllerName =
  | 'learningBridge'
  | 'memoryGraph'
  | 'agentMemoryScope'
  | 'tieredCache'
  | 'hybridSearch'
  | 'federatedSession'
  | 'semanticRouter'
  | 'sonaTrajectory'
  | 'hierarchicalMemory'
  | 'memoryConsolidation'
  | 'batchOperations'
  | 'contextSynthesizer'
  | 'gnnService'
  | 'rvfOptimizer'
  | 'mmrDiversityRanker'
  | 'guardedVectorBackend';

/**
 * All controller names
 */
export type ControllerName = MemoryControllerName | CLIControllerName;

/**
 * Initialization level for dependency ordering
 */
export interface InitLevel {
  level: number;
  controllers: ControllerName[];
}

/**
 * Individual controller health status
 */
export interface ControllerHealth {
  name: ControllerName;
  status: 'healthy' | 'degraded' | 'unavailable';
  initTimeMs: number;
  error?: string;
}

/**
 * Aggregated health report for all controllers
 */
export interface RegistryHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  controllers: ControllerHealth[];
  lancedbAvailable: boolean;
  initTimeMs: number;
  timestamp: number;
  activeControllers: number;
  totalControllers: number;
}

/**
 * Runtime configuration for controller activation
 */
export interface RuntimeConfig {
  /** Database path for LanceDB */
  dbPath?: string;

  /** Vector dimension (default: 384 for MiniLM) */
  dimension?: number;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Memory backend config */
  memory?: {
    enableHNSW?: boolean;
    learningBridge?: Partial<LearningBridgeConfig>;
    memoryGraph?: Partial<MemoryGraphConfig>;
    tieredCache?: Partial<CacheConfig>;
  };

  /** Neural config */
  neural?: {
    enabled?: boolean;
    modelPath?: string;
    sonaMode?: SONAMode;
  };

  /** Controllers to explicitly enable/disable */
  controllers?: Partial<Record<ControllerName, boolean>>;

  /** Backend instance to use (if pre-created) */
  backend?: IMemoryBackend;
}

/**
 * Controller instance wrapper
 */
interface ControllerEntry {
  name: ControllerName;
  instance: unknown;
  level: number;
  initTimeMs: number;
  enabled: boolean;
  error?: string;
}

// ===== Initialization Levels =====

/**
 * Level-based initialization order per ADR-053.
 * Controllers at each level can be initialized in parallel.
 * Each level must complete before the next begins.
 */
export const INIT_LEVELS: InitLevel[] = [
  // Level 0: Foundation - already exists
  { level: 0, controllers: [] },
  // Level 1: Core intelligence
  { level: 1, controllers: ['reasoningBank', 'hierarchicalMemory', 'learningBridge', 'hybridSearch', 'tieredCache'] },
  // Level 2: Graph & security
  { level: 2, controllers: ['memoryGraph', 'agentMemoryScope', 'vectorBackend', 'mutationGuard', 'gnnService'] },
  // Level 3: Specialization
  { level: 3, controllers: ['skills', 'explainableRecall', 'reflexion', 'attestationLog', 'batchOperations', 'memoryConsolidation'] },
  // Level 4: Causal & routing
  { level: 4, controllers: ['causalGraph', 'nightlyLearner', 'learningSystem', 'semanticRouter'] },
  // Level 5: Advanced services
  { level: 5, controllers: ['graphTransformer', 'sonaTrajectory', 'contextSynthesizer', 'rvfOptimizer', 'mmrDiversityRanker', 'guardedVectorBackend'] },
  // Level 6: Session management
  { level: 6, controllers: ['federatedSession', 'graphAdapter'] },
];

/** Pre-computed reverse of INIT_LEVELS for shutdown ordering. */
const SHUTDOWN_LEVELS = [...INIT_LEVELS].reverse();

// ===== ControllerRegistry =====

/**
 * Central registry for memory backend controller lifecycle management.
 *
 * Handles:
 * - Level-based initialization ordering (levels 0-6)
 * - Graceful degradation (each controller fails independently)
 * - Config-driven activation (controllers only instantiate when enabled)
 * - Health check aggregation across all controllers
 * - Ordered shutdown (reverse initialization order)
 *
 * @example
 * ```typescript
 * const registry = new ControllerRegistry();
 * await registry.initialize({
 *   dbPath: './data/memory.db',
 *   dimension: 384,
 *   memory: {
 *     enableHNSW: true,
 *     learningBridge: { sonaMode: 'balanced' },
 *     memoryGraph: { pageRankDamping: 0.85 },
 *   },
 * });
 *
 * const reasoning = registry.get<ReasoningBank>('reasoningBank');
 * const graph = registry.get<MemoryGraph>('memoryGraph');
 *
 * await registry.shutdown();
 * ```
 */
export class ControllerRegistry extends EventEmitter {
  private controllers: Map<ControllerName, ControllerEntry> = new Map();
  private backend: IMemoryBackend | null = null;
  private config: RuntimeConfig = {};
  private initialized = false;
  private initTimeMs = 0;

  /**
   * Initialize all controllers in level-based order.
   *
   * Each level's controllers are initialized in parallel within the level.
   * Failures are isolated: a controller that fails to init is marked as
   * unavailable but does not block other controllers.
   */
  async initialize(config: RuntimeConfig = {}): Promise<void> {
    if (this.initialized) return;
    this.initialized = true; // Set early to prevent concurrent re-entry

    this.config = config;
    const startTime = performance.now();

    // Step 1: Set up the backend
    this.backend = config.backend || null;

    // Step 3: Initialize controllers level by level
    for (const level of INIT_LEVELS) {
      const controllersToInit = level.controllers.filter(
        (name) => this.isControllerEnabled(name),
      );

      if (controllersToInit.length === 0) continue;

      // Initialize all controllers in this level in parallel
      const results = await Promise.allSettled(
        controllersToInit.map((name) => this.initController(name, level.level)),
      );

      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const name = controllersToInit[i];

        if (result.status === 'rejected') {
          const errorMsg = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

          this.controllers.set(name, {
            name,
            instance: null,
            level: level.level,
            initTimeMs: 0,
            enabled: false,
            error: errorMsg,
          });

          this.emit('controller:failed', { name, error: errorMsg, level: level.level });
        }
      }
    }

    this.initTimeMs = performance.now() - startTime;
    this.emit('initialized', {
      initTimeMs: this.initTimeMs,
      activeControllers: this.getActiveCount(),
      totalControllers: this.controllers.size,
    });
  }

  /**
   * Shutdown all controllers in reverse initialization order.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Shutdown in reverse level order (SHUTDOWN_LEVELS is pre-computed at module load)

    for (const level of SHUTDOWN_LEVELS) {
      const controllersToShutdown = level.controllers
        .filter((name) => {
          const entry = this.controllers.get(name);
          return entry?.enabled && entry?.instance;
        });

      await Promise.allSettled(
        controllersToShutdown.map((name) => this.shutdownController(name)),
      );
    }

    this.controllers.clear();
    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Get a controller instance by name.
   * Returns null if the controller is not initialized or unavailable.
   */
  get<T>(name: ControllerName): T | null {
    const entry = this.controllers.get(name);
    if (entry?.enabled && entry?.instance) {
      return entry.instance as T;
    }
    return null;
  }

  /**
   * Check if a controller is enabled and initialized.
   */
  isEnabled(name: ControllerName): boolean {
    return this.controllers.get(name)?.enabled ?? false;
  }

  /**
   * Aggregate health check across all controllers.
   */
  async healthCheck(): Promise<RegistryHealthReport> {
    const controllerHealth: ControllerHealth[] = [];

    for (const [name, entry] of this.controllers) {
      controllerHealth.push({
        name,
        status: entry.enabled
          ? 'healthy'
          : entry.error
            ? 'unavailable'
            : 'degraded',
        initTimeMs: entry.initTimeMs,
        error: entry.error,
      });
    }

    const lancedbAvailable = this.backend !== null;

    const active = controllerHealth.filter((c) => c.status === 'healthy').length;
    const unavailable = controllerHealth.filter((c) => c.status === 'unavailable').length;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unavailable > 0 && active === 0) {
      status = 'unhealthy';
    } else if (unavailable > 0) {
      status = 'degraded';
    }

    return {
      status,
      controllers: controllerHealth,
      lancedbAvailable,
      initTimeMs: this.initTimeMs,
      timestamp: Date.now(),
      activeControllers: active,
      totalControllers: controllerHealth.length,
    };
  }

  /**
   * Get the underlying memory backend instance.
   */

  /**
   * Get the memory backend.
   */
  getBackend(): IMemoryBackend | null {
    return this.backend;
  }

  /**
   * Check if the registry is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the number of active (successfully initialized) controllers.
   */
  getActiveCount(): number {
    let count = 0;
    for (const entry of this.controllers.values()) {
      if (entry.enabled) count++;
    }
    return count;
  }

  /**
   * List all registered controller names and their status.
   */
  listControllers(): Array<{ name: ControllerName; enabled: boolean; level: number }> {
    return Array.from(this.controllers.entries()).map(([name, entry]) => ({
      name,
      enabled: entry.enabled,
      level: entry.level,
    }));
  }

  // ===== Private Methods =====

  /**
   * Check whether a controller should be initialized based on config.
   */
  private isControllerEnabled(name: ControllerName): boolean {
    // Explicit enable/disable from config
    if (this.config.controllers) {
      const explicit = this.config.controllers[name];
      if (explicit !== undefined) return explicit;
    }

    // Default behavior: enable based on category
    switch (name) {
      // Core intelligence — enabled by default
      case 'reasoningBank':
      case 'learningBridge':
      case 'tieredCache':
      case 'hierarchicalMemory':
        return true;

      // Graph — enabled if backend available
      case 'memoryGraph':
        return !!(this.config.memory?.memoryGraph || this.backend);

      // Security — enabled if LanceDB available
      case 'mutationGuard':
      case 'attestationLog':
      case 'vectorBackend':
      case 'guardedVectorBackend':
        return this.backend !== null;

      // Memory-internal controllers — only if backend available
      case 'skills':
      case 'reflexion':
      case 'causalGraph':
      case 'causalRecall':
      case 'learningSystem':
      case 'explainableRecall':
      case 'nightlyLearner':
      case 'graphTransformer':
      case 'graphAdapter':
      case 'gnnService':
      case 'memoryConsolidation':
      case 'batchOperations':
      case 'contextSynthesizer':
      case 'rvfOptimizer':
      case 'mmrDiversityRanker':
        return this.backend !== null;

      // SemanticRouter — auto-enable if backend available (exported since alpha.10)
      case 'semanticRouter':
        return this.backend !== null;

      // Optional controllers
      case 'hybridSearch':
      case 'agentMemoryScope':
      case 'sonaTrajectory':
      case 'federatedSession':
        return false; // Require explicit enabling

      default:
        return false;
    }
  }

  /**
   * Initialize a single controller with error isolation.
   */
  private async initController(name: ControllerName, level: number): Promise<void> {
    const startTime = performance.now();

    try {
      const instance = await this.createController(name);

      const initTimeMs = performance.now() - startTime;

      this.controllers.set(name, {
        name,
        instance,
        level,
        initTimeMs,
        enabled: instance !== null,
        error: instance === null ? 'Controller returned null' : undefined,
      });

      if (instance !== null) {
        this.emit('controller:initialized', { name, level, initTimeMs });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const initTimeMs = performance.now() - startTime;

      this.controllers.set(name, {
        name,
        instance: null,
        level,
        initTimeMs,
        enabled: false,
        error: errorMsg,
      });

      throw error;
    }
  }

  /**
   * Factory method to create a controller instance.
   * Handles CLI-layer controllers; internal controllers are
   * accessed via backend.getController().
   */
  private async createController(name: ControllerName): Promise<unknown> {
    switch (name) {
      // ----- CLI-layer controllers -----

      case 'learningBridge': {
        if (!this.backend) return null;
        const config = this.config.memory?.learningBridge || {};
        let embedder = config.embedder;
        const bridge = new LearningBridge(this.backend, {
          sonaMode: config.sonaMode || this.config.neural?.sonaMode || 'balanced',
          confidenceDecayRate: config.confidenceDecayRate,
          accessBoostAmount: config.accessBoostAmount,
          consolidationThreshold: config.consolidationThreshold,
          embedder,
          // Thread the real vector dimension so SONA and the embedder agree
          // (backend MiniLM produces 384-dim vectors, not SONA's 768 hidden width).
          embeddingDim: this.config.dimension ?? config.embeddingDim,
          enabled: true,
        });
        return bridge;
      }

      case 'memoryGraph': {
        const config = this.config.memory?.memoryGraph || {};
        const graph = new MemoryGraph({
          pageRankDamping: config.pageRankDamping,
          maxNodes: config.maxNodes,
          ...config,
        });
        // Build from backend if available
        if (this.backend) {
          try {
            await graph.buildFromBackend(this.backend);
          } catch {
            // Graph build from backend failed — empty graph is still usable
          }
        }
        return graph;
      }

      case 'tieredCache': {
        const config = this.config.memory?.tieredCache || {};
        const cache = new TieredCacheManager({
          maxSize: config.maxSize || 10000,
          ttl: config.ttl || 300000,
          lruEnabled: true,
          writeThrough: false,
          ...config,
        });
        return cache;
      }

      case 'hybridSearch':
        // BM25 hybrid search — placeholder for future implementation
        return null;

      case 'agentMemoryScope':
        // Agent memory scope — placeholder, activated when explicitly enabled
        return null;

      case 'semanticRouter':
        return null;

      case 'sonaTrajectory':
        return null;

      case 'hierarchicalMemory':
        return this.createTieredMemoryStub();

      case 'memoryConsolidation':
        return this.createConsolidationStub();

      case 'federatedSession':
        // Federated session — placeholder for Phase 4
        return null;

      // ----- internal controllers (via getController) -----
      // legacy backend.getController() only supports: reflexion/memory, skills, causalGraph/causal
      case 'reasoningBank':
      case 'skills':
      case 'reflexion':
      case 'causalGraph':
      case 'causalRecall':
      case 'learningSystem':
      case 'explainableRecall':
      case 'nightlyLearner':
      case 'graphTransformer':
      case 'batchOperations':
      case 'contextSynthesizer':
      case 'mmrDiversityRanker':
      case 'mutationGuard':
      case 'attestationLog':
      case 'gnnService':
      case 'rvfOptimizer':
      case 'guardedVectorBackend':
      case 'vectorBackend':
      case 'graphAdapter':
        return null;

      default:
        return null;
    }
  }

  /**
   * Shutdown a single controller gracefully.
   */
  private async shutdownController(name: ControllerName): Promise<void> {
    const entry = this.controllers.get(name);
    if (!entry?.instance) return;

    try {
      const instance = entry.instance as any;

      // Try known shutdown methods (always await for safety)
      if (typeof instance.destroy === 'function') {
        await instance.destroy();
      } else if (typeof instance.shutdown === 'function') {
        await instance.shutdown();
      } else if (typeof instance.close === 'function') {
        await instance.close();
      }
    } catch {
      // Best-effort cleanup
    }

    entry.enabled = false;
    entry.instance = null;
  }

  /**
   * Create an EmbeddingService for controllers that need it.
   * Uses the config's embedding generator or creates a minimal local service.
   */
  private createEmbeddingService(): any {
    // If user provided an embedding generator, wrap it
    if (this.config.embeddingGenerator) {
      return {
        embed: async (text: string) => this.config.embeddingGenerator!(text),
        embedBatch: async (texts: string[]) => Promise.all(texts.map(t => this.config.embeddingGenerator!(t))),
        initialize: async () => {},
      };
    }
    // Return a minimal stub — HierarchicalMemory falls back to manualSearch without embeddings
    return {
      embed: async () => new Float32Array(this.config.dimension || 384),
      embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(this.config.dimension || 384)),
      initialize: async () => {},
    };
  }

  /**
   * Lightweight in-memory tiered store (fallback when HierarchicalMemory
   * cannot be initialized from legacy module).
   * Enforces per-tier size limits to prevent unbounded memory growth.
   */
  private createTieredMemoryStub() {
    const MAX_PER_TIER = 5000;
    const tiers: Record<string, Map<string, { value: string; ts: number }>> = {
      working: new Map(),
      episodic: new Map(),
      semantic: new Map(),
    };
    return {
      store(key: string, value: string, tier = 'working') {
        const t = tiers[tier] || tiers.working;
        // Evict oldest if at capacity
        if (t.size >= MAX_PER_TIER) {
          const oldest = t.keys().next().value;
          if (oldest !== undefined) t.delete(oldest);
        }
        t.set(key, { value: value.substring(0, 100_000), ts: Date.now() });
      },
      recall(query: string, topK = 5) {
        const safeTopK = Math.min(Math.max(1, topK), 100);
        const q = query.toLowerCase().substring(0, 10_000);
        const results: Array<{ key: string; value: string; tier: string; ts: number }> = [];
        for (const [tierName, map] of Object.entries(tiers)) {
          for (const [key, entry] of map) {
            if (key.toLowerCase().includes(q) || entry.value.toLowerCase().includes(q)) {
              results.push({ key, value: entry.value, tier: tierName, ts: entry.ts });
              if (results.length >= safeTopK * 3) break; // Early exit for large stores
            }
          }
        }
        return results.sort((a, b) => b.ts - a.ts).slice(0, safeTopK);
      },
      getTierStats() {
        return Object.fromEntries(
          Object.entries(tiers).map(([name, map]) => [name, map.size]),
        );
      },
    };
  }

  /**
   * No-op consolidation stub (fallback when MemoryConsolidation
   * cannot be initialized from legacy module).
   */
  private createConsolidationStub() {
    return {
      consolidate() {
        return { promoted: 0, pruned: 0, timestamp: Date.now() };
      },
    };
  }
}

export default ControllerRegistry;
