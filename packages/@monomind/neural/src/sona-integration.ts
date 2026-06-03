/**
 * SONA Integration for V1 Neural Module
 *
 * Wraps @monoes/sona package for V1 usage with:
 * - Trajectory tracking and verdict judgment
 * - Pattern extraction and memory distillation
 * - Sub-0.05ms learning performance target
 * - Clean TypeScript API with proper types
 *
 * @module sona-integration
 */

import type {
  Trajectory,
  TrajectoryStep,
  TrajectoryVerdict,
  DistilledMemory,
  SONAMode,
  SONAModeConfig,
} from './types.js';
import type { SonaEngineAPI, SonaModule } from './sona-types.js';
import { SONA_HIDDEN_DIM, SONA_EDGE_DIM } from './constants.js';

// =============================================================================
// Inline type definitions (replaces static @monoes/sona import)
// =============================================================================

/**
 * Configuration for the @monoes/sona WASM engine
 */
export interface JsSonaConfig {
  hiddenDim?: number;
  embeddingDim?: number;
  microLoraRank?: number;
  baseLoraRank?: number;
  microLoraLr?: number;
  baseLoraLr?: number;
  ewcLambda?: number;
  patternClusters?: number;
  trajectoryCapacity?: number;
  qualityThreshold?: number;
  enableSimd?: boolean;
  backgroundIntervalMs?: number;
}

/**
 * A learned pattern returned by the @monoes/sona engine
 */
export interface JsLearnedPattern {
  patternType?: string;
  avgQuality: number;
  [key: string]: unknown;
}

let _sonaEngineClass: SonaModule['SonaEngine'] | null = null;
let _sonaLoadAttempted = false;
/** OR-4: Stores the load error message so getStats() can surface it. */
let _sonaLoadError: string | null = null;

// Lazy loader — called on first SONALearningEngine.initialize().
// Avoids top-level await which breaks ESM circular-import loading order in Vitest.
async function loadSonaEngine(): Promise<SonaModule['SonaEngine'] | null> {
  if (_sonaLoadAttempted) return _sonaEngineClass;
  _sonaLoadAttempted = true;
  try {
    // @ts-ignore — optional peer dependency; not always installed
    const mod = await import('@monoes/sona');
    const m = mod as unknown as SonaModule;
    _sonaEngineClass = m.SonaEngine ?? null;
  } catch (err) {
    _sonaEngineClass = null;
    _sonaLoadError = err instanceof Error ? err.message : String(err);
    process.emitWarning(
      `@monoes/sona failed to load — SONA learning disabled: ${_sonaLoadError}`,
      'MonoesWarning'
    );
  }
  return _sonaEngineClass;
}

// Kept for backward compat with code that checks `SonaEngine` at module scope.
// Will be null until loadSonaEngine() is awaited.
let SonaEngine: SonaModule['SonaEngine'] | null = null;

// =============================================================================
// Types
// =============================================================================

/**
 * Context for SONA learning adaptation
 */
export interface Context {
  /** Task domain */
  domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general';
  /** Current query embedding */
  queryEmbedding: Float32Array;
  /** Additional context metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Adapted behavior result from SONA
 */
export interface AdaptedBehavior {
  /** Transformed query embedding after micro-LoRA */
  transformedQuery: Float32Array;
  /** Similar learned patterns */
  patterns: JsLearnedPattern[];
  /** Suggested route/model */
  suggestedRoute?: string;
  /** Confidence score */
  confidence: number;
}

/**
 * SONA engine statistics
 */
export interface SONAStats {
  /** Total trajectories recorded */
  totalTrajectories: number;
  /** Patterns learned */
  patternsLearned: number;
  /** Average quality */
  avgQuality: number;
  /** Last learning time (ms) */
  lastLearningMs: number;
  /** Engine enabled state */
  enabled: boolean;
  /** OR-4: Error message if @monoes/sona failed to load; null when load succeeded */
  sonaLoadError?: string | null;
}

// =============================================================================
// Mode Configuration Mapping
// =============================================================================

/**
 * Convert V1 SONA mode to @monoes/sona config
 */
function modeToConfig(mode: SONAMode, modeConfig: SONAModeConfig): Record<string, unknown> {
  const baseConfig: JsSonaConfig = {
    hiddenDim: modeConfig?.hiddenDim ?? SONA_HIDDEN_DIM, // Standard transformer dimension
    embeddingDim: modeConfig?.embeddingDim ?? SONA_HIDDEN_DIM,
    microLoraRank: modeConfig.loraRank <= 2 ? modeConfig.loraRank : 1,
    baseLoraRank: modeConfig.loraRank,
    microLoraLr: modeConfig.learningRate,
    baseLoraLr: modeConfig.learningRate * 0.1,
    ewcLambda: modeConfig.ewcLambda,
    patternClusters: modeConfig.patternClusters,
    trajectoryCapacity: modeConfig.trajectoryCapacity,
    qualityThreshold: modeConfig.qualityThreshold,
    enableSimd: true,
  };

  // Mode-specific adjustments
  switch (mode) {
    case 'real-time':
      return {
        ...baseConfig,
        microLoraRank: 1,
        backgroundIntervalMs: 60000, // 1 minute
      };
    case 'edge':
      return {
        ...baseConfig,
        hiddenDim: SONA_EDGE_DIM, // Smaller for edge devices
        embeddingDim: SONA_EDGE_DIM,
        microLoraRank: 1,
        patternClusters: 25,
        backgroundIntervalMs: 300000, // 5 minutes
      };
    case 'research':
      return {
        ...baseConfig,
        baseLoraRank: 16,
        backgroundIntervalMs: 3600000, // 1 hour
      };
    case 'batch':
      return {
        ...baseConfig,
        backgroundIntervalMs: 7200000, // 2 hours
      };
    case 'balanced':
    default:
      return {
        ...baseConfig,
        backgroundIntervalMs: 1800000, // 30 minutes
      };
  }
}

// =============================================================================
// SONA Learning Engine
// =============================================================================

/**
 * SONA Learning Engine - wraps @monoes/sona for V1 usage
 *
 * Performance targets:
 * - learn(): <0.05ms
 * - adapt(): <0.1ms
 * - Full learning cycle: <10ms
 */
export class SONALearningEngine {
  private engine: SonaEngineAPI | null = null;
  private trajectoryMap: Map<string, number> = new Map();
  private adaptationTimeMs: number = 0;
  private learningTimeMs: number = 0;
  private mode: SONAMode;
  private modeConfig: SONAModeConfig;

  constructor(mode: SONAMode, modeConfig: SONAModeConfig) {
    this.mode = mode;
    this.modeConfig = modeConfig;
    // Engine will be initialized lazily in initialize()
  }

  /**
   * Initialize the underlying WASM engine (must be called before other methods).
   */
  async initialize(): Promise<void> {
    const EngineClass = await loadSonaEngine();
    SonaEngine = EngineClass; // update module-level ref for callers
    if (!EngineClass) {
      throw new Error(
        '@monoes/sona is not installed. Install it as an optional dependency or use SONAManager (JS fallback).'
      );
    }
    const config = modeToConfig(this.mode, this.modeConfig);
    this.engine = EngineClass.withConfig(config);
  }

  /**
   * Learn from a trajectory
   *
   * Performance target: <0.05ms
   *
   * @param trajectory - Trajectory to learn from
   */
  async learn(trajectory: Trajectory): Promise<void> {
    const startTime = performance.now();

    try {
      if (!this.engine) throw new Error('Engine not initialized — call initialize() first');
      // Begin trajectory recording
      const queryEmbedding = this.trajectoryToQueryEmbedding(trajectory);
      const trajectoryId = this.engine.beginTrajectory(
        Array.from(queryEmbedding)
      );

      // Add trajectory steps
      for (const step of trajectory.steps) {
        this.engine.addTrajectoryStep(
          trajectoryId,
          Array.from(step.stateBefore),
          Array.from(step.stateAfter),
          step.reward
        );
      }

      // Set context if available
      if (trajectory.domain) {
        this.engine.addTrajectoryContext(trajectoryId, trajectory.domain);
      }

      // Complete trajectory with quality score
      const quality = this.calculateQuality(trajectory);
      this.engine.endTrajectory(trajectoryId, quality);

      // Flush instant updates
      this.engine.flush();

      this.learningTimeMs = performance.now() - startTime;
    } catch (error) {
      throw new Error(`SONA learning failed: ${error}`);
    }
  }

  /**
   * Adapt behavior based on context
   *
   * @param context - Current context for adaptation
   * @returns Adapted behavior with transformed embeddings
   */
  async adapt(context: Context): Promise<AdaptedBehavior> {
    const startTime = performance.now();

    try {
      if (!this.engine) throw new Error('Engine not initialized — call initialize() first');
      // Apply micro-LoRA transformation
      const transformedQuery = this.engine.applyMicroLora(
        Array.from(context.queryEmbedding)
      );

      // Find similar patterns
      const patterns = this.engine.findPatterns(
        Array.from(context.queryEmbedding),
        5
      );

      // Determine suggested route from patterns
      const suggestedRoute = this.inferRoute(patterns, context);
      const confidence = patterns.length > 0 ? patterns[0].avgQuality : 0.5;

      this.adaptationTimeMs = performance.now() - startTime;

      return {
        transformedQuery: new Float32Array(transformedQuery),
        patterns,
        suggestedRoute,
        confidence,
      };
    } catch (error) {
      throw new Error(`SONA adaptation failed: ${error}`);
    }
  }

  /**
   * Get last adaptation time
   *
   * @returns Adaptation time in milliseconds
   */
  getAdaptationTime(): number {
    return this.adaptationTimeMs;
  }

  /**
   * Get last learning time
   *
   * @returns Learning time in milliseconds
   */
  getLearningTime(): number {
    return this.learningTimeMs;
  }

  /**
   * Reset learning state
   */
  resetLearning(): void {
    // Create a new engine with the same config (requires engine already initialized)
    const config = modeToConfig(this.mode, this.modeConfig);
    if (_sonaEngineClass) {
      this.engine = _sonaEngineClass.withConfig(config);
    }
    this.trajectoryMap.clear();
    this.adaptationTimeMs = 0;
    this.learningTimeMs = 0;
  }

  /**
   * Force immediate learning cycle
   *
   * @returns Status message
   */
  forceLearning(): string {
    if (!this.engine) throw new Error('Engine not initialized — call initialize() first');
    return this.engine.forceLearn();
  }

  /**
   * Tick background learning (call periodically)
   *
   * @returns Status message if learning occurred
   */
  tick(): string | null {
    if (!this.engine) return null;
    return this.engine.tick();
  }

  /**
   * Get engine statistics
   *
   * @returns SONA engine statistics
   */
  getStats(): SONAStats {
    if (!this.engine) {
      return { totalTrajectories: 0, patternsLearned: 0, avgQuality: 0, lastLearningMs: 0, enabled: false, sonaLoadError: _sonaLoadError };
    }
    let stats: Record<string, unknown> = {};
    try {
      const statsJson = this.engine.getStats();
      stats = JSON.parse(statsJson);
    } catch {
      // WASM returned malformed JSON — return safe defaults
    }

    return {
      totalTrajectories: (stats.total_trajectories as number) || 0,
      patternsLearned: (stats.patterns_learned as number) || 0,
      avgQuality: (stats.avg_quality as number) || 0,
      lastLearningMs: this.learningTimeMs,
      enabled: this.engine.isEnabled(),
      sonaLoadError: _sonaLoadError,
    };
  }

  /**
   * Enable or disable the engine
   *
   * @param enabled - Whether to enable the engine
   */
  setEnabled(enabled: boolean): void {
    if (!this.engine) throw new Error('Engine not initialized — call initialize() first');
    this.engine.setEnabled(enabled);
  }

  /**
   * Check if engine is enabled
   *
   * @returns Whether the engine is enabled
   */
  isEnabled(): boolean {
    return this.engine?.isEnabled() ?? false;
  }

  /**
   * Find learned patterns similar to query
   *
   * @param queryEmbedding - Query embedding
   * @param k - Number of patterns to return
   * @returns Learned patterns
   */
  findPatterns(queryEmbedding: Float32Array, k: number = 5): JsLearnedPattern[] {
    if (!this.engine) return [];
    return this.engine.findPatterns(Array.from(queryEmbedding), k);
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Convert trajectory to query embedding
   */
  private trajectoryToQueryEmbedding(trajectory: Trajectory): Float32Array {
    // Use the first step's state as query
    if (trajectory.steps.length > 0) {
      return trajectory.steps[0].stateBefore;
    }
    // Fallback to zero embedding
    return new Float32Array(SONA_HIDDEN_DIM);
  }

  /**
   * Calculate quality score for trajectory
   */
  private calculateQuality(trajectory: Trajectory): number {
    if (trajectory.qualityScore !== undefined) {
      return trajectory.qualityScore;
    }

    // Calculate from steps
    if (trajectory.steps.length === 0) return 0.5;

    const avgReward = trajectory.steps.reduce((sum, step) => sum + step.reward, 0) /
                      trajectory.steps.length;

    // Normalize to [0, 1]
    return Math.max(0, Math.min(1, (avgReward + 1) / 2));
  }

  /**
   * Infer suggested route from patterns and context
   */
  private inferRoute(patterns: JsLearnedPattern[], context: Context): string | undefined {
    if (patterns.length === 0) return undefined;

    // Use the highest quality pattern's type as route
    const bestPattern = patterns.reduce((best, pattern) =>
      pattern.avgQuality > best.avgQuality ? pattern : best
    );

    return bestPattern.patternType || `${context.domain}-default`;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a SONA learning engine
 *
 * @param mode - SONA learning mode
 * @param modeConfig - Mode configuration
 * @returns SONA learning engine instance
 */
export function createSONALearningEngine(
  mode: SONAMode,
  modeConfig: SONAModeConfig
): SONALearningEngine {
  return new SONALearningEngine(mode, modeConfig);
}

// JsLearnedPattern and JsSonaConfig are already exported via inline interface declarations above.
