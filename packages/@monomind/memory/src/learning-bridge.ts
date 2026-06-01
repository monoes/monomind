/**
 * LearningBridge - Connects AutoMemoryBridge to NeuralLearningSystem
 *
 * When insights are recorded via AutoMemoryBridge, this module triggers
 * neural learning trajectories so the system continuously improves from
 * its own discoveries. The NeuralLearningSystem dependency is optional:
 * when unavailable, all operations degrade gracefully to no-ops.
 *
 * @module @monomind/memory/learning-bridge
 */

import { EventEmitter } from 'node:events';
import type { IMemoryBackend, MemoryEntry, SONAMode } from './types.js';
import type { MemoryInsight, InsightCategory } from './auto-memory-bridge.js';

// ===== Types =====

/**
 * Factory function that returns a neural system instance.
 * Used for dependency injection so tests can supply a mock.
 */
export type NeuralLoader = () => Promise<any>;

/** Configuration for the LearningBridge */
export interface LearningBridgeConfig {
  /** SONA operating mode (default: 'balanced') */
  sonaMode?: SONAMode;
  /** Per-hour confidence decay rate (default: 0.005) */
  confidenceDecayRate?: number;
  /** Confidence boost per access (default: 0.03) */
  accessBoostAmount?: number;
  /** Maximum confidence value (default: 1.0) */
  maxConfidence?: number;
  /** Minimum confidence floor (default: 0.1) */
  minConfidence?: number;
  /** EWC regularization strength (default: 2000) */
  ewcLambda?: number;
  /** Min active trajectories before consolidation runs (default: 10) */
  consolidationThreshold?: number;
  /** Enable the bridge (default: true). When false all methods are no-ops */
  enabled?: boolean;
  /**
   * Optional factory for the neural learning system.
   * When provided, this replaces the default dynamic import of @monomind/neural.
   * Primarily used for testing.
   */
  neuralLoader?: NeuralLoader;
  /**
   * Optional real embedder function injected by the CLI.
   * When provided, replaces the cross-package dynamic import of memory-bridge.js,
   * eliminating the architectural coupling between @monomind/memory and @monomind/cli.
   * Signature: (text: string) => Promise<number[]>
   */
  embedder?: (text: string) => Promise<number[]>;
}

/** Aggregated learning statistics */
export interface LearningStats {
  totalTrajectories: number;
  completedTrajectories: number;
  activeTrajectories: number;
  totalConsolidations: number;
  totalDecays: number;
  avgConfidenceBoost: number;
  neuralAvailable: boolean;
}

/** Result returned by consolidate() */
export interface ConsolidateResult {
  trajectoriesCompleted: number;
  patternsLearned: number;
  entriesUpdated: number;
  durationMs: number;
}

/** A single pattern match returned by findSimilarPatterns() */
export interface PatternMatch {
  content: string;
  similarity: number;
  category: string;
  confidence: number;
}

// ===== Defaults =====

/** Internal resolved config type where optional fields stay optional */
type ResolvedConfig = Required<Omit<LearningBridgeConfig, 'neuralLoader' | 'embedder'>> & {
  neuralLoader?: NeuralLoader;
  embedder?: (text: string) => Promise<number[]>;
};

const DEFAULT_CONFIG: ResolvedConfig = {
  sonaMode: 'balanced',
  confidenceDecayRate: 0.005,
  accessBoostAmount: 0.03,
  maxConfidence: 1.0,
  minConfidence: 0.1,
  ewcLambda: 2000,
  consolidationThreshold: 5,
  enabled: true,
};

const MS_PER_HOUR = 3_600_000;

// ===== LearningBridge =====

/**
 * Connects AutoMemoryBridge insights to the NeuralLearningSystem.
 *
 * @example
 * ```typescript
 * const bridge = new LearningBridge(memoryBackend);
 * await bridge.onInsightRecorded(insight, entryId);
 * await bridge.onInsightAccessed(entryId);
 * const result = await bridge.consolidate();
 * ```
 */
export class LearningBridge extends EventEmitter {
  private neural: any | null = null;
  private backend: IMemoryBackend;
  private config: ResolvedConfig;
  private activeTrajectories: Map<string, string> = new Map();
  private stats = {
    totalTrajectories: 0,
    completedTrajectories: 0,
    totalConsolidations: 0,
    totalDecays: 0,
    confidenceBoosts: 0,
    totalBoostAmount: 0,
  };
  private destroyed = false;
  private neuralInitPromise: Promise<void> | null = null;
  private backfillInProgress = false;

  constructor(backend: IMemoryBackend, config?: LearningBridgeConfig) {
    super();
    this.backend = backend;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===== Public API =====

  /**
   * Notify the bridge that an insight has been recorded in AgentDB.
   * Creates a learning trajectory so the neural system can track the
   * insight's lifecycle.
   */
  async onInsightRecorded(insight: MemoryInsight, entryId: string): Promise<void> {
    if (!this.config.enabled || this.destroyed) return;

    await this.initNeural();

    if (this.neural) {
      try {
        const trajectoryId = this.neural.beginTask(insight.summary, 'general');
        this.activeTrajectories.set(entryId, trajectoryId);
        this.stats.totalTrajectories++;

        // V1: use real embeddings from the memory bridge rather than hash noise
        const embedding = await this.createEmbedding(insight.summary);
        this.neural.recordStep(
          trajectoryId,
          `record:${insight.category}`,
          insight.confidence,
          embedding,
        );
      } catch {
        // Neural system failure is non-fatal
      }
    }

    this.emit('insight:learning-started', { entryId, category: insight.category });
  }

  /**
   * Notify the bridge that an insight entry was accessed.
   * Boosts confidence in the backend and records a step in the
   * trajectory if one exists.
   */
  async onInsightAccessed(entryId: string): Promise<void> {
    if (!this.config.enabled || this.destroyed) return;

    const entry = await this.backend.get(entryId);
    if (!entry) return;

    const currentConf = (entry.metadata?.confidence as number) ?? 0.5;
    const newConf = Math.min(
      this.config.maxConfidence,
      currentConf + this.config.accessBoostAmount,
    );

    await this.backend.update(entryId, {
      metadata: { ...entry.metadata, confidence: newConf },
    });

    this.stats.confidenceBoosts++;
    this.stats.totalBoostAmount += this.config.accessBoostAmount;

    if (this.neural && this.activeTrajectories.has(entryId)) {
      try {
        const trajectoryId = this.activeTrajectories.get(entryId)!;
        const accessEmbedding = await this.createEmbedding(`access:${entryId}`);
        this.neural.recordStep(
          trajectoryId,
          'access',
          this.config.accessBoostAmount,
          accessEmbedding,
        );
      } catch {
        // Non-fatal
      }
    }

    this.emit('insight:accessed', { entryId, newConfidence: newConf });
  }

  /**
   * Consolidate active trajectories by completing them in the neural system.
   * Only runs when there are enough active trajectories to justify the cost.
   */
  async consolidate(): Promise<ConsolidateResult> {
    const startTime = Date.now();
    const earlyResult: ConsolidateResult = {
      trajectoriesCompleted: 0,
      patternsLearned: 0,
      entriesUpdated: 0,
      durationMs: 0,
    };

    if (!this.config.enabled || this.destroyed) {
      return earlyResult;
    }

    if (!this.neural || this.activeTrajectories.size < this.config.consolidationThreshold) {
      earlyResult.durationMs = Date.now() - startTime;
      return earlyResult;
    }

    let completed = 0;
    let patternsLearned = 0;
    const toRemove: string[] = [];

    const entries = Array.from(this.activeTrajectories.entries());
    for (const [entryId, trajectoryId] of entries) {
      try {
        // V2: use the entry's stored confidence as quality rather than hardcoded 1.0
        // so the reward signal actually reflects insight importance
        let quality = 1.0;
        try {
          const entry = await this.backend.get(entryId);
          const stored = (entry?.metadata?.confidence as number) ?? (entry?.importanceScore as number);
          if (Number.isFinite(stored) && stored >= 0 && stored <= 1) quality = stored;
        } catch { /* use default */ }

        await this.neural.completeTask(trajectoryId, quality);
        completed++;
        patternsLearned++;
        toRemove.push(entryId);
      } catch {
        // Skip failed completions
      }
    }

    for (const key of toRemove) {
      this.activeTrajectories.delete(key);
    }

    this.stats.completedTrajectories += completed;
    this.stats.totalConsolidations++;

    // Pipeline A→B bridge: flush PatternLearner patterns to patterns.json so
    // intelligence.ts (the routing path) can find patterns learned by the neural
    // package. This closes the loop between automatic session learning and routing.
    if (completed > 0 && this.neural && typeof (this.neural as any).getLearnedPatterns === 'function') {
      void this.flushNeuralPatternsToFile().catch(() => {});
    }

    const result: ConsolidateResult = {
      trajectoriesCompleted: completed,
      patternsLearned,
      entriesUpdated: completed,
      durationMs: Date.now() - startTime,
    };

    this.emit('consolidation:completed', result);
    return result;
  }

  /**
   * Apply time-based confidence decay to entries in the given namespace.
   * Entries not accessed for more than one hour see their confidence reduced
   * proportionally to the hours elapsed, down to minConfidence.
   *
   * @returns number of entries whose confidence was lowered
   */
  async decayConfidences(namespace: string): Promise<number> {
    if (!this.config.enabled || this.destroyed) return 0;

    let entries: MemoryEntry[];
    try {
      entries = await this.backend.query({
        type: 'hybrid',
        namespace,
        limit: 1000,
      });
    } catch {
      return 0;
    }

    const now = Date.now();
    let decayed = 0;

    for (const entry of entries) {
      const hoursSinceUpdate = (now - entry.updatedAt) / MS_PER_HOUR;
      if (hoursSinceUpdate < 1) continue;

      const currentConf = (entry.metadata?.confidence as number) ?? 0.5;
      // FOREVER forgetting curve: exponential decay weighted by importanceScore
      // Source: https://arxiv.org/html/2601.03938v1
      const importanceScore = (entry.importanceScore ?? entry.metadata?.importanceScore as number) ?? currentConf;
      const newConf = Math.max(
        this.config.minConfidence,
        importanceScore * Math.exp(-this.config.confidenceDecayRate * hoursSinceUpdate),
      );

      if (newConf < currentConf) {
        try {
          await this.backend.update(entry.id, {
            metadata: { ...entry.metadata, confidence: newConf },
          });
          decayed++;
        } catch {
          // Skip failed updates
        }
      }
    }

    this.stats.totalDecays += decayed;
    return decayed;
  }

  /**
   * Find patterns similar to the given content using the neural system.
   * Returns an empty array when the neural system is unavailable.
   */
  async findSimilarPatterns(content: string, k: number = 5): Promise<PatternMatch[]> {
    if (!this.config.enabled || this.destroyed) return [];

    await this.initNeural();

    if (!this.neural) return [];

    try {
      const embedding = this.createHashEmbedding(content);
      const results = await this.neural.findPatterns(embedding, k);

      if (!Array.isArray(results)) return [];

      return results.map((r: any) => ({
        content: r.content ?? r.data ?? '',
        similarity: r.similarity ?? r.score ?? 0,
        category: r.category ?? 'unknown',
        confidence: r.confidence ?? r.reward ?? 0,
      }));
    } catch {
      return [];
    }
  }

  /** Return aggregated learning statistics */
  getStats(): LearningStats {
    const avgBoost =
      this.stats.confidenceBoosts > 0
        ? this.stats.totalBoostAmount / this.stats.confidenceBoosts
        : 0;

    return {
      totalTrajectories: this.stats.totalTrajectories,
      completedTrajectories: this.stats.completedTrajectories,
      activeTrajectories: this.activeTrajectories.size,
      totalConsolidations: this.stats.totalConsolidations,
      totalDecays: this.stats.totalDecays,
      avgConfidenceBoost: avgBoost,
      neuralAvailable: this.neural !== null,
    };
  }

  /** Tear down the bridge. Subsequent method calls become no-ops. */
  destroy(): void {
    this.destroyed = true;
    this.activeTrajectories.clear();

    if (this.neural && typeof this.neural.cleanup === 'function') {
      try {
        this.neural.cleanup();
      } catch {
        // Best-effort cleanup
      }
    }

    this.neural = null;
    this.neuralInitPromise = null;
    this.removeAllListeners();
  }

  // ===== Private =====

  /**
   * Lazily attempt to load and initialize the NeuralLearningSystem.
   * The promise is cached so that repeated calls do not re-attempt
   * after a failure.
   */
  private async initNeural(): Promise<void> {
    if (this.neural) return;
    if (this.neuralInitPromise) {
      await this.neuralInitPromise;
      return;
    }

    this.neuralInitPromise = this.loadNeural();
    await this.neuralInitPromise;
  }

  private async loadNeural(): Promise<void> {
    try {
      if (this.config.neuralLoader) {
        // Use injected loader (test / custom integrations)
        this.neural = await this.config.neuralLoader();
        return;
      }

      const mod = await import('@monomind/neural' as string);
      const NeuralLearningSystem = mod.NeuralLearningSystem ?? mod.default;
      if (!NeuralLearningSystem) return;

      const instance = new NeuralLearningSystem(this.config.sonaMode);

      if (typeof instance.initialize === 'function') {
        await instance.initialize();
      }

      this.neural = instance;
    } catch {
      // @monomind/neural not installed or failed to initialize.
      // This is expected in many environments; degrade silently.
      this.neural = null;
    }
  }

  /**
   * Write PatternLearner patterns to .monomind/neural/patterns.json so that
   * intelligence.ts (Pipeline B) can find them via findSimilarPatterns / getAllPatterns.
   * This is the Pipeline A→B bridge: automatic session learning → routing.
   */
  private async flushNeuralPatternsToFile(): Promise<void> {
    const learnedRaw: Array<{ id: string; domain: string; strategy: string; successRate: number; usageCount: number }>
      = (this.neural as any).getLearnedPatterns?.() ?? [];
    if (learnedRaw.length === 0) return;

    const { writeFileSync, mkdirSync, existsSync, readFileSync, renameSync } = await import('node:fs');
    const { join } = await import('node:path');

    const dir = join(process.cwd(), '.monomind', 'neural');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const patternsPath = join(dir, 'patterns.json');

    let existing: Array<Record<string, unknown>> = [];
    try {
      const raw = readFileSync(patternsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch { /* start fresh */ }

    // Map PatternLearner domains to valid monomind agent type strings.
    // Domain values ('code', 'reasoning', 'general', etc.) are not agent names;
    // without this mapping every flushed pattern is rejected by the VALID_AGENT_TYPES
    // filter in suggestAgentsFromIntelligence, making the A→B bridge a no-op.
    const DOMAIN_TO_AGENT: Record<string, string> = {
      code: 'coder',
      coding: 'coder',
      reasoning: 'researcher',
      research: 'researcher',
      testing: 'tester',
      review: 'reviewer',
      security: 'security-architect',
      performance: 'performance-engineer',
      architecture: 'architect',
      creative: 'researcher',
      math: 'researcher',
      chat: 'coder',
      general: 'coder',
    };

    const existingIds = new Set(existing.map(p => p['id']));
    const now = Date.now();
    const newEntries = learnedRaw
      .filter(p => !existingIds.has(`neural:${p.id}`) && p.successRate >= 0.3)
      .map(p => ({
        id: `neural:${p.id}`,
        type: DOMAIN_TO_AGENT[p.domain] ?? 'coder',
        content: p.strategy,
        confidence: p.successRate,
        usageCount: p.usageCount,
        embedding: [] as number[],
        createdAt: now,
        lastUsedAt: now,
      }));

    if (newEntries.length === 0) return;

    const merged = [...existing, ...newEntries];
    const tmp = `${patternsPath}.${process.pid}.${now}.tmp`;
    writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
    renameSync(tmp, patternsPath);

    void this.backfillEmbeddings(patternsPath).catch(() => {});
  }

  /**
   * Background task: generate embeddings for patterns written with empty
   * embedding arrays. Runs fire-and-forget after flushNeuralPatternsToFile.
   * Non-fatal — any error is silently swallowed.
   */
  private async backfillEmbeddings(patternsPath: string): Promise<void> {
    if (this.backfillInProgress) return;
    this.backfillInProgress = true;
    try {
      const { readFileSync, writeFileSync, renameSync } = await import('node:fs');

      const raw = readFileSync(patternsPath, 'utf-8');
      const patterns: Array<Record<string, unknown>> = JSON.parse(raw);
      if (!Array.isArray(patterns)) return;

      let changed = false;
      for (const entry of patterns) {
        const emb = entry['embedding'];
        if (Array.isArray(emb) && emb.length === 0) {
          const content = typeof entry['content'] === 'string' ? entry['content'] : '';
          const vec = await this.createEmbedding(content, 768);
          entry['embedding'] = Array.from(vec);
          changed = true;
        }
      }

      if (!changed) return;

      const now = Date.now();
      const tmp = `${patternsPath}.backfill.${process.pid}.${now}.tmp`;
      writeFileSync(tmp, JSON.stringify(patterns, null, 2), 'utf-8');
      renameSync(tmp, patternsPath);
    } catch {
      // Non-fatal: backfill failure does not affect the flush result
    } finally {
      this.backfillInProgress = false;
    }
  }

  /**
   * Generate a real semantic embedding via the memory bridge embedder,
   * falling back to a deterministic hash embedding when unavailable.
   * V1: using real embeddings is critical for meaningful LoRA weight updates.
   */
  private async createEmbedding(text: string, dimensions: number = 768): Promise<Float32Array> {
    // Prefer the injected embedder (CLI wires this in via LearningBridgeConfig.embedder)
    // — no cross-package import needed, clean dependency boundary.
    const embeddingSource = this.config.embedder;
    if (embeddingSource) {
      try {
        const raw = await embeddingSource(text);
        if (Array.isArray(raw) && raw.length > 0) {
          const arr = new Float32Array(dimensions);
          const copyLen = Math.min(raw.length, dimensions);
          for (let i = 0; i < copyLen; i++) arr[i] = raw[i];
          let norm = 0;
          for (let i = 0; i < dimensions; i++) norm += arr[i] * arr[i];
          norm = Math.sqrt(norm);
          if (norm > 0) for (let i = 0; i < dimensions; i++) arr[i] /= norm;
          return arr;
        }
      } catch { /* fall through */ }
    }

    // Fallback: try @monomind/cli's memory-bridge when running inside the CLI process
    try {
      const bridge = await import('@monomind/cli/src/memory/memory-bridge.js' as string)
        .catch(() => null);
      if (bridge?.bridgeGenerateEmbedding) {
        const result = await bridge.bridgeGenerateEmbedding(text);
        if (result?.embedding && Array.isArray(result.embedding) && result.embedding.length > 0) {
          const arr = new Float32Array(dimensions);
          const copyLen = Math.min(result.embedding.length, dimensions);
          for (let i = 0; i < copyLen; i++) arr[i] = result.embedding[i];
          let norm = 0;
          for (let i = 0; i < dimensions; i++) norm += arr[i] * arr[i];
          norm = Math.sqrt(norm);
          if (norm > 0) for (let i = 0; i < dimensions; i++) arr[i] /= norm;
          return arr;
        }
      }
    } catch { /* fall through to hash */ }

    return this.createHashEmbedding(text, dimensions);
  }

  /**
   * Deterministic hash-based embedding fallback.
   * Used only when no real embedder is available.
   */
  private createHashEmbedding(text: string, dimensions: number = 768): Float32Array {
    const embedding = new Float32Array(dimensions);
    const normalized = text.toLowerCase().trim();

    for (let i = 0; i < dimensions; i++) {
      let hash = 0;
      for (let j = 0; j < normalized.length; j++) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(j) * (i + 1)) | 0;
      }
      embedding[i] = (Math.sin(hash) + 1) / 2;
    }

    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }
}

export default LearningBridge;
