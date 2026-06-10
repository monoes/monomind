/**
 * Prime Radiant Plugin - Main Plugin Class
 *
 * PrimeRadiantPlugin class implementing the IPlugin interface:
 * - register(): Register with monomind plugin system
 * - initialize(): Load WASM bundle, set up engines
 * - shutdown(): Cleanup WASM resources
 *
 * Integrates the 92KB WASM bundle for mathematical AI interpretability.
 *
 * @module prime-radiant/plugin
 * @version 0.1.3
 */

import type {
  IPlugin,
  IPrimeRadiantBridge,
  ICoherenceGate,
  PluginContext,
  PluginMCPTool,
  PluginHook,
  HookPriority,
  IResultCache,
} from './interfaces.js';

import type {
  PrimeRadiantConfig,
  CoherenceCheckResult,
  SpectralAnalysisResult,
  CausalInferenceResult,
  TopologyResult,
  ConsensusResult,
  MemoryEntry,
  MemoryCoherenceValidation,
  CoherenceThresholds,
  CoherenceAction,
  CausalGraph,
} from './types.js';

import { DEFAULT_CONFIG, PrimeRadiantErrorCodes } from './types.js';
import type { WasmModule } from './types.js';

import {
  CohomologyEngine,
  SpectralEngine,
  CausalEngine,
  QuantumEngine,
  CategoryEngine,
  HottEngine,
} from './engines/index.js';

import {
  validateCoherenceInput,
  validateSpectralInput,
  validateCausalInput,
  validateConsensusInput,
  validateTopologyInput,
  validateMemoryGateInput,
  validateConfig,
} from './schemas.js';

// ============================================================================
// WASM Bridge Implementation
// ============================================================================

/**
 * Bridge to the Prime Radiant WASM module
 * Manages the 92KB bundle and engine instances
 */
class PrimeRadiantBridge implements IPrimeRadiantBridge {
  private initialized = false;
  private wasmModule: WasmModule | null = null;

  private cohomologyEngine!: CohomologyEngine;
  private spectralEngine!: SpectralEngine;
  private causalEngine!: CausalEngine;
  private quantumEngine!: QuantumEngine;
  private categoryEngine!: CategoryEngine;
  private hottEngine!: HottEngine;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const wasmModule = await this.loadWasmModule();
      this.wasmModule = wasmModule;

      this.cohomologyEngine = new CohomologyEngine(wasmModule ?? undefined);
      this.spectralEngine = new SpectralEngine(wasmModule ?? undefined);
      this.causalEngine = new CausalEngine(wasmModule ?? undefined);
      this.quantumEngine = new QuantumEngine(wasmModule ?? undefined);
      this.categoryEngine = new CategoryEngine(wasmModule ?? undefined);
      this.hottEngine = new HottEngine(wasmModule ?? undefined);

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize WASM module: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async dispose(): Promise<void> {
    this.wasmModule = null;
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(PrimeRadiantErrorCodes.WASM_NOT_INITIALIZED);
    }
  }

  private async loadWasmModule(): Promise<WasmModule | null> {
    try {
      const module = await import('prime-radiant-advanced-wasm');
      if (module.default) {
        await module.default();
      }
      return module as unknown as WasmModule;
    } catch {
      // Falls back to pure JS engine implementations
      return null;
    }
  }

  // Public API methods
  async checkCoherence(vectors: Float32Array[]): Promise<CoherenceCheckResult> {
    this.ensureInitialized();
    const result = await this.cohomologyEngine.checkCoherence(vectors);
    return {
      coherent: result.coherent,
      energy: result.energy,
      violations: result.violations,
      confidence: result.confidence,
    };
  }

  async analyzeSpectral(adjacencyMatrix: Float32Array): Promise<SpectralAnalysisResult> {
    this.ensureInitialized();
    const n = Math.round(Math.sqrt(adjacencyMatrix.length));
    const matrix: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => adjacencyMatrix[i * n + j])
    );
    return this.spectralEngine.analyzeStability(matrix);
  }

  async inferCausal(
    treatment: string,
    outcome: string,
    graph: CausalGraph
  ): Promise<CausalInferenceResult> {
    this.ensureInitialized();
    const result = await this.causalEngine.infer({ treatment, outcome, graph });
    return {
      effect: result.effect,
      confounders: result.confounders,
      backdoorPaths: result.backdoorPaths.map(p => Array.isArray(p) ? p.join(' → ') : p),
      interventionValid: result.interventionValid,
    };
  }

  async computeTopology(points: Float32Array[], dimension: number): Promise<TopologyResult> {
    this.ensureInitialized();
    return this.quantumEngine.computeTopology(points, dimension);
  }

  async applyMorphism(
    _source: unknown,
    _target: unknown,
    _morphism: string
  ): Promise<{ valid: boolean; result: unknown; naturalTransformation: boolean }> {
    this.ensureInitialized();
    // CategoryEngine operates on typed Morphism objects; raw-string morphisms are not supported
    return { valid: false, result: null, naturalTransformation: false };
  }

  async verifyTypeProof(
    proposition: string,
    proof: string
  ): Promise<{ valid: boolean; type: string; normalForm: string }> {
    this.ensureInitialized();
    const [valid, type, normalForm] = await Promise.all([
      this.hottEngine.verifyProof(proposition, proof),
      this.hottEngine.inferType(proof),
      this.hottEngine.normalize(proof),
    ]);
    return {
      valid,
      type,
      normalForm,
    };
  }
}

// ============================================================================
// Coherence Gate Implementation
// ============================================================================

/**
 * Coherence Gate - validates memory entries for contradictions
 */
class CoherenceGate implements ICoherenceGate {
  private bridge: IPrimeRadiantBridge;
  private thresholds: CoherenceThresholds = {
    reject: 0.7,
    warn: 0.3,
    allow: 0.3,
  };

  constructor(bridge: IPrimeRadiantBridge) {
    this.bridge = bridge;
  }

  async validate(
    entry: MemoryEntry,
    existingContext?: MemoryEntry[]
  ): Promise<MemoryCoherenceValidation> {
    const vectors: Float32Array[] = [entry.embedding];

    if (existingContext?.length) {
      vectors.push(...existingContext.map((e) => e.embedding));
    }

    const coherenceResult = await this.bridge.checkCoherence(vectors);

    let action: CoherenceAction;
    if (coherenceResult.energy >= this.thresholds.reject) {
      action = 'reject';
    } else if (coherenceResult.energy >= this.thresholds.warn) {
      action = 'warn';
    } else {
      action = 'allow';
    }

    return {
      entry,
      existingContext,
      coherenceResult,
      action,
    };
  }

  async validateBatch(entries: MemoryEntry[]): Promise<MemoryCoherenceValidation[]> {
    const results: MemoryCoherenceValidation[] = [];
    const processed: MemoryEntry[] = [];

    for (const entry of entries) {
      const validation = await this.validate(entry, processed);
      results.push(validation);
      if (validation.action !== 'reject') {
        processed.push(entry);
      }
    }

    return results;
  }

  setThresholds(thresholds: Partial<CoherenceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  getThresholds(): CoherenceThresholds {
    return { ...this.thresholds };
  }
}

// ============================================================================
// LRU Cache Implementation
// ============================================================================

/**
 * Simple LRU Cache with TTL
 */
class ResultCache<T> implements IResultCache<T> {
  private cache = new Map<string, { value: T; expiry: number }>();
  private maxSize: number;
  private defaultTTL: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 1000, defaultTTL: number = 60000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, {
      value,
      expiry: Date.now() + (ttl ?? this.defaultTTL),
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}

// ============================================================================
// Plugin Class
// ============================================================================

/**
 * Prime Radiant Plugin for Monomind
 *
 * Provides mathematical AI interpretability capabilities:
 * - Sheaf Laplacian coherence detection
 * - Spectral stability analysis
 * - Do-calculus causal inference
 * - Quantum topology computation
 * - Category theory morphisms
 * - Homotopy Type Theory proofs
 */
export class PrimeRadiantPlugin implements IPlugin {
  readonly name = 'prime-radiant';
  readonly version = '0.1.3';
  readonly description =
    'Mathematical AI interpretability with sheaf cohomology, spectral analysis, and causal inference';

  private bridge: PrimeRadiantBridge;
  private coherenceGate: CoherenceGate;
  private cache: ResultCache<unknown>;
  private config: PrimeRadiantConfig;
  private context: PluginContext | null = null;

  constructor(config?: Partial<PrimeRadiantConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bridge = new PrimeRadiantBridge();
    this.coherenceGate = new CoherenceGate(this.bridge);
    this.cache = new ResultCache(1000, this.config.coherence.cacheTTL);
  }

  /**
   * Register the plugin with monomind
   */
  async register(context: PluginContext): Promise<void> {
    this.context = context;

    // Register plugin in context
    context.set('prime-radiant', this);
    context.set('pr.version', this.version);
    context.set('pr.capabilities', this.getCapabilities());
  }

  /**
   * Initialize the plugin (load WASM, set up engines)
   */
  async initialize(context: PluginContext): Promise<{ success: boolean; error?: string }> {
    try {
      // Load WASM bundle (92KB)
      await this.bridge.initialize();

      // Store instances in plugin context
      context.set('pr.bridge', this.bridge);
      context.set('pr.coherenceGate', this.coherenceGate);
      context.set('pr.cache', this.cache);
      context.set('pr.config', this.config);

      // Register with memory service if available
      if (context.has('memory')) {
        const memoryService = context.get<{
          registerPreStoreHook: (hook: (entry: MemoryEntry) => Promise<MemoryEntry>) => void;
        }>('memory');

        memoryService.registerPreStoreHook(async (entry: MemoryEntry) => {
          const result = await this.coherenceGate.validate(entry);
          if (result.action === 'reject') {
            throw new Error(
              `${PrimeRadiantErrorCodes.COHERENCE_VIOLATION}: Energy ${result.coherenceResult.energy.toFixed(3)}`
            );
          }
          return entry;
        });
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Shutdown the plugin (cleanup WASM resources)
   */
  async shutdown(_context: PluginContext): Promise<{ success: boolean; error?: string }> {
    try {
      await this.bridge.dispose();
      this.cache.clear();
      this.context = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get plugin capabilities
   */
  getCapabilities(): string[] {
    return [
      'coherence-checking',
      'spectral-analysis',
      'causal-inference',
      'consensus-verification',
      'quantum-topology',
      'category-theory',
      'hott-proofs',
    ];
  }

  /**
   * Get plugin MCP tools
   */
  getMCPTools(): PluginMCPTool[] {
    return [
      this.createCoherenceCheckTool(),
      this.createSpectralAnalyzeTool(),
      this.createCausalInferTool(),
      this.createConsensusVerifyTool(),
      this.createQuantumTopologyTool(),
      this.createMemoryGateTool(),
    ];
  }

  /**
   * Get plugin hooks
   */
  getHooks(): PluginHook[] {
    return [
      this.createPreMemoryStoreHook(),
      this.createPreConsensusHook(),
      this.createPostSwarmTaskHook(),
      this.createPreRagRetrievalHook(),
    ];
  }

  // ============================================================================
  // MCP Tool Implementations
  // ============================================================================

  private createCoherenceCheckTool(): PluginMCPTool {
    return {
      name: 'pr_coherence_check',
      description: 'Check coherence of vectors using Sheaf Laplacian energy (0=coherent, 1=contradictory)',
      category: 'coherence',
      version: this.version,
      inputSchema: {
        type: 'object',
        properties: {
          vectors: {
            type: 'array',
            items: { type: 'array', items: { type: 'number' } },
            description: 'Array of embedding vectors to check for coherence',
          },
          threshold: {
            type: 'number',
            default: 0.3,
            description: 'Energy threshold for coherence (0-1)',
          },
        },
        required: ['vectors'],
      },
      handler: async (input: unknown, _context: PluginContext) => {
        const validated = validateCoherenceInput(input);
        const vectors = validated.vectors.map((v) => new Float32Array(v));
        const result = await this.bridge.checkCoherence(vectors);

        const interpretation =
          result.energy < 0.1
            ? 'Fully coherent'
            : result.energy < 0.3
              ? 'Minor inconsistencies'
              : result.energy < 0.7
                ? 'Significant contradictions'
                : 'Major contradictions detected';

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ...result, interpretation }, null, 2),
            },
          ],
        };
      },
    };
  }

  private createSpectralAnalyzeTool(): PluginMCPTool {
    return {
      name: 'pr_spectral_analyze',
      description: 'Analyze stability using spectral graph theory',
      category: 'spectral',
      version: this.version,
      inputSchema: {
        type: 'object',
        properties: {
          adjacencyMatrix: {
            type: 'array',
            items: { type: 'array', items: { type: 'number' } },
            description: 'Adjacency matrix representing connections',
          },
          analyzeType: {
            type: 'string',
            enum: ['stability', 'clustering', 'connectivity'],
            default: 'stability',
          },
        },
        required: ['adjacencyMatrix'],
      },
      handler: async (input: unknown, _context: PluginContext) => {
        const validated = validateSpectralInput(input);
        const flat = validated.adjacencyMatrix.flat();
        const matrix = new Float32Array(flat);
        const result = await this.bridge.analyzeSpectral(matrix);

        const interpretation = result.stable
          ? 'System is spectrally stable'
          : 'System shows instability patterns';

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ...result,
                  eigenvalues: result.eigenvalues.slice(0, 10),
                  interpretation,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    };
  }

  private createCausalInferTool(): PluginMCPTool {
    return {
      name: 'pr_causal_infer',
      description: 'Perform causal inference using do-calculus',
      category: 'causal',
      version: this.version,
      inputSchema: {
        type: 'object',
        properties: {
          treatment: { type: 'string', description: 'Treatment/intervention variable' },
          outcome: { type: 'string', description: 'Outcome variable' },
          graph: {
            type: 'object',
            properties: {
              nodes: { type: 'array', items: { type: 'string' } },
              edges: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
            description: 'Causal graph with nodes and edges',
          },
        },
        required: ['treatment', 'outcome', 'graph'],
      },
      handler: async (input: unknown, _context: PluginContext) => {
        const validated = validateCausalInput(input);
        const result = await this.bridge.inferCausal(
          validated.treatment,
          validated.outcome,
          validated.graph
        );

        const recommendation = result.interventionValid
          ? 'Intervention is valid for causal inference'
          : `Confounders detected: ${result.confounders.join(', ')}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ...result, recommendation }, null, 2),
            },
          ],
        };
      },
    };
  }

  private createConsensusVerifyTool(): PluginMCPTool {
    return {
      name: 'pr_consensus_verify',
      description: 'Verify multi-agent consensus mathematically',
      category: 'consensus',
      version: this.version,
      inputSchema: {
        type: 'object',
        properties: {
          agentStates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agentId: { type: 'string' },
                embedding: { type: 'array', items: { type: 'number' } },
                vote: { type: 'string' },
              },
            },
            description: 'Array of agent states to verify consensus',
          },
          consensusThreshold: {
            type: 'number',
            default: 0.8,
            description: 'Required agreement threshold (0-1)',
          },
        },
        required: ['agentStates'],
      },
      handler: async (input: unknown, _context: PluginContext) => {
        const validated = validateConsensusInput(input);
        const vectors = validated.agentStates.map((s) => new Float32Array(s.embedding));

        const coherence = await this.bridge.checkCoherence(vectors);

        // Build adjacency matrix
        const n = vectors.length;
        const adj = new Float32Array(n * n);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            adj[i * n + j] = this.cosineSimilarity(vectors[i], vectors[j]);
          }
        }

        const spectral = await this.bridge.analyzeSpectral(adj);
        const agreementRatio = 1 - coherence.energy;
        const consensusAchieved = agreementRatio >= validated.consensusThreshold;

        const result: ConsensusResult = {
          consensusAchieved,
          agreementRatio,
          coherenceEnergy: coherence.energy,
          spectralStability: spectral.stable,
          spectralGap: spectral.spectralGap,
          violations: coherence.violations,
          recommendation: consensusAchieved
            ? 'Consensus is mathematically verified'
            : `Consensus not achieved. Disagreement energy: ${coherence.energy.toFixed(3)}`,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    };
  }

  private createQuantumTopologyTool(): PluginMCPTool {
    return {
      name: 'pr_quantum_topology',
      description: 'Compute quantum topology features (Betti numbers, persistence)',
      category: 'topology',
      version: this.version,
      inputSchema: {
        type: 'object',
        properties: {
          points: {
            type: 'array',
            items: { type: 'array', items: { type: 'number' } },
            description: 'Point cloud for topological analysis',
          },
          maxDimension: {
            type: 'number',
            default: 2,
            description: 'Maximum homology dimension to compute',
          },
        },
        required: ['points'],
      },
      handler: async (input: unknown, _context: PluginContext) => {
        const validated = validateTopologyInput(input);
        const points = validated.points.map((p) => new Float32Array(p));
        const result = await this.bridge.computeTopology(points, validated.maxDimension);

        const interpretation = {
          b0: `${result.bettiNumbers[0]} connected components`,
          b1: `${result.bettiNumbers[1] || 0} loops/cycles`,
          b2: `${result.bettiNumbers[2] || 0} voids/cavities`,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ...result, interpretation }, null, 2),
            },
          ],
        };
      },
    };
  }

  private createMemoryGateTool(): PluginMCPTool {
    return {
      name: 'pr_memory_gate',
      description: 'Pre-storage coherence gate for memory entries',
      category: 'memory',
      version: this.version,
      inputSchema: {
        type: 'object',
        properties: {
          entry: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              content: { type: 'string' },
              embedding: { type: 'array', items: { type: 'number' } },
            },
            description: 'Memory entry to validate',
          },
          contextEmbeddings: {
            type: 'array',
            items: { type: 'array', items: { type: 'number' } },
            description: 'Existing context embeddings',
          },
          thresholds: {
            type: 'object',
            properties: {
              reject: { type: 'number' },
              warn: { type: 'number' },
            },
          },
        },
        required: ['entry'],
      },
      handler: async (input: unknown, _context: PluginContext) => {
        const validated = validateMemoryGateInput(input);

        const entry: MemoryEntry = {
          key: validated.entry.key,
          content: validated.entry.content,
          embedding: new Float32Array(validated.entry.embedding),
        };

        const existingContext = validated.contextEmbeddings?.map((e, i) => ({
          key: `context-${i}`,
          content: '',
          embedding: new Float32Array(e),
        }));

        if (validated.thresholds) {
          this.coherenceGate.setThresholds(validated.thresholds);
        }

        const result = await this.coherenceGate.validate(entry, existingContext);

        const recommendation =
          result.action === 'allow'
            ? 'Entry is coherent with existing context'
            : result.action === 'warn'
              ? 'Entry has minor inconsistencies - review recommended'
              : 'Entry contradicts existing context - storage blocked';

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  action: result.action,
                  coherent: result.coherenceResult.coherent,
                  energy: result.coherenceResult.energy,
                  violations: result.coherenceResult.violations,
                  confidence: result.coherenceResult.confidence,
                  recommendation,
                },
                null,
                2
              ),
            },
          ],
        };
      },
    };
  }

  // ============================================================================
  // Hook Implementations
  // ============================================================================

  private createPreMemoryStoreHook(): PluginHook {
    return {
      name: 'pr/pre-memory-store',
      event: 'pre-memory-store',
      priority: 100 as HookPriority,
      description: 'Validates memory entry coherence before storage',
      handler: async (_context: PluginContext, payload: unknown) => {
        const entry = payload as MemoryEntry;
        const validation = await this.coherenceGate.validate(entry);

        if (validation.action === 'reject') {
          throw new Error(
            `${PrimeRadiantErrorCodes.COHERENCE_VIOLATION}: ${validation.coherenceResult.violations.join(', ')}`
          );
        }

        if (validation.action === 'warn') {
          console.warn(
            `[Prime Radiant] Coherence warning for ${entry.key}: energy=${validation.coherenceResult.energy.toFixed(3)}`
          );
        }

        return {
          ...entry,
          metadata: {
            ...(entry.metadata || {}),
            coherenceEnergy: validation.coherenceResult.energy,
            coherenceChecked: true,
          },
        };
      },
    };
  }

  private createPreConsensusHook(): PluginHook {
    return {
      name: 'pr/pre-consensus',
      event: 'pre-consensus',
      priority: 100 as HookPriority,
      description: 'Validates consensus proposal coherence before voting',
      handler: async (_context: PluginContext, payload: unknown) => {
        const proposal = payload as {
          proposalEmbedding: number[];
          existingDecisions: Array<{ embedding: number[] }>;
        };

        const vectors = [
          new Float32Array(proposal.proposalEmbedding),
          ...proposal.existingDecisions.map((d) => new Float32Array(d.embedding)),
        ];

        const coherence = await this.bridge.checkCoherence(vectors);

        if (coherence.energy > 0.7) {
          return {
            ...proposal,
            rejected: true,
            rejectionReason: `Proposal contradicts existing decisions (energy: ${coherence.energy.toFixed(3)})`,
          };
        }

        return {
          ...proposal,
          coherenceEnergy: coherence.energy,
          coherenceConfidence: coherence.confidence,
        };
      },
    };
  }

  private createPostSwarmTaskHook(): PluginHook {
    return {
      name: 'pr/post-swarm-task',
      event: 'post-task',
      priority: 50 as HookPriority,
      description: 'Analyzes swarm stability after task completion',
      handler: async (context: PluginContext, payload: unknown) => {
        const task = payload as { isSwarmTask?: boolean; taskId: string };
        if (!task.isSwarmTask) return payload;

        // Get agent states if hive-mind is available
        if (!context.has('hiveMind')) return payload;

        const hiveMind = context.get<{
          getAgentStates: () => Promise<
            Array<{
              id: string;
              communicationsWith?: Record<string, number>;
              totalCommunications?: number;
            }>
          >;
        }>('hiveMind');

        const agentStates = await hiveMind.getAgentStates();
        const n = agentStates.length;

        if (n < 2) return payload;

        // Build adjacency matrix
        const adj = new Float32Array(n * n);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const commCount = agentStates[i].communicationsWith?.[agentStates[j].id] || 0;
            adj[i * n + j] = commCount / (agentStates[i].totalCommunications || 1);
          }
        }

        const spectral = await this.bridge.analyzeSpectral(adj);

        // Store metrics
        if (context.has('memory')) {
          const memory = context.get<{
            store: (entry: { namespace: string; key: string; content: string }) => Promise<void>;
          }>('memory');
          await memory.store({
            namespace: 'pr/stability-metrics',
            key: `task-${task.taskId}`,
            content: JSON.stringify({
              taskId: task.taskId,
              stable: spectral.stable,
              spectralGap: spectral.spectralGap,
              stabilityIndex: spectral.stabilityIndex,
              timestamp: Date.now(),
            }),
          });
        }

        return {
          ...(payload as Record<string, unknown>),
          stabilityMetrics: {
            stable: spectral.stable,
            spectralGap: spectral.spectralGap,
          },
        };
      },
    };
  }

  private createPreRagRetrievalHook(): PluginHook {
    return {
      name: 'pr/pre-rag-retrieval',
      event: 'pre-rag-retrieval',
      priority: 100 as HookPriority,
      description: 'Checks retrieved context coherence to prevent hallucinations',
      handler: async (_context: PluginContext, payload: unknown) => {
        const retrieval = payload as {
          retrievedDocs: Array<{ embedding: number[] }>;
        };

        const vectors = retrieval.retrievedDocs.map((d) => new Float32Array(d.embedding));

        if (vectors.length < 2) return payload;

        const coherence = await this.bridge.checkCoherence(vectors);

        if (coherence.energy > 0.5) {
          console.warn(
            `[Prime Radiant] RAG coherence warning: ${coherence.violations.join(', ')}`
          );

          return {
            ...retrieval,
            retrievedDocs: retrieval.retrievedDocs.slice(
              0,
              Math.ceil(retrieval.retrievedDocs.length / 2)
            ),
            coherenceFiltered: true,
            originalCoherenceEnergy: coherence.energy,
          };
        }

        return payload;
      },
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get the WASM bridge instance
   */
  getBridge(): IPrimeRadiantBridge {
    return this.bridge;
  }

  /**
   * Get the coherence gate instance
   */
  getCoherenceGate(): ICoherenceGate {
    return this.coherenceGate;
  }

  /**
   * Get the result cache instance
   */
  getCache(): IResultCache<unknown> {
    return this.cache;
  }

  /**
   * Get the current configuration
   */
  getConfig(): PrimeRadiantConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PrimeRadiantConfig>): void {
    this.config = validateConfig({ ...this.config, ...config });
    this.coherenceGate.setThresholds({
      reject: this.config.coherence.rejectThreshold,
      warn: this.config.coherence.warnThreshold,
      allow: this.config.coherence.warnThreshold,
    });
  }
}
