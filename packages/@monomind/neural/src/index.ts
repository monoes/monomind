/**
 * V1 Neural/Learning System
 *
 * Complete neural learning module with SONA learning modes,
 * ReasoningBank integration, pattern learning, and RL algorithms.
 *
 * Performance Targets:
 * - SONA adaptation: <0.05ms
 * - Pattern matching: <1ms
 * - Learning step: <10ms
 *
 * @module @monomind/neural
 */

// =============================================================================
// Dimensional Constants
// =============================================================================

export { SONA_HIDDEN_DIM, DEFAULT_VECTOR_DIM, SONA_EDGE_DIM } from './constants.js';

// =============================================================================
// Core Types
// =============================================================================

export type {
  // SONA Mode Types
  SONAMode,
  SONAModeConfig,
  ModeOptimizations,

  // Trajectory Types
  Trajectory,
  TrajectoryStep,
  TrajectoryVerdict,
  DistilledMemory,

  // Pattern Types
  Pattern,
  PatternMatch,
  PatternEvolution,

  // RL Algorithm Types
  RLAlgorithm,
  RLConfig,
  PPOConfig,
  DQNConfig,
  DecisionTransformerConfig,
  CuriosityConfig,

  // LoRA Types
  LoRAConfig,
  LoRAWeights,

  // EWC Types
  EWCConfig,
  EWCState,

  // Statistics
  NeuralStats,

  // Events
  NeuralEvent,
  NeuralEventListener,
} from './types.js';

// =============================================================================
// SONA Manager
// =============================================================================

export {
  SONAManager,
  createSONAManager,
  getModeConfig,
  getModeOptimizations,
} from './sona-manager.js';

// =============================================================================
// Learning Modes
// =============================================================================

export type { ModeImplementation } from './modes/index.js';

export {
  BaseModeImplementation,
  RealTimeMode,
  BalancedMode,
  ResearchMode,
  EdgeMode,
  BatchMode,
} from './modes/index.js';

// =============================================================================
// SONA Integration (@monoes/sona)
// =============================================================================

export {
  SONALearningEngine,
  createSONALearningEngine,
} from './sona-integration.js';

export type {
  Context,
  AdaptedBehavior,
  SONAStats,
  JsLearnedPattern,
  JsSonaConfig,
} from './sona-integration.js';

// =============================================================================
// ReasoningBank
// =============================================================================

export {
  ReasoningBank,
  createReasoningBank,
  createInitializedReasoningBank,
} from './reasoning-bank.js';

export type {
  ReasoningBankConfig,
  RetrievalResult,
  ConsolidationResult,
} from './reasoning-bank.js';

// =============================================================================
// Pattern Learner
// =============================================================================

export {
  PatternLearner,
  createPatternLearner,
} from './pattern-learner.js';

export type { PatternLearnerConfig } from './pattern-learner.js';

// =============================================================================
// RL Algorithms
// =============================================================================

export {
  // PPO
  PPOAlgorithm,
  createPPO,
  DEFAULT_PPO_CONFIG,

  // DQN
  DQNAlgorithm,
  createDQN,
  DEFAULT_DQN_CONFIG,

  // A2C
  A2CAlgorithm,
  createA2C,
  DEFAULT_A2C_CONFIG,

  // Decision Transformer
  DecisionTransformer,
  createDecisionTransformer,
  DEFAULT_DT_CONFIG,

  // Q-Learning
  QLearning,
  createQLearning,
  DEFAULT_QLEARNING_CONFIG,

  // SARSA
  SARSAAlgorithm,
  createSARSA,
  DEFAULT_SARSA_CONFIG,

  // Curiosity
  CuriosityModule,
  createCuriosity,
  DEFAULT_CURIOSITY_CONFIG,

  // Factory functions
  createAlgorithm,
  getDefaultConfig,
} from './algorithms/index.js';

export type {
  A2CConfig,
  QLearningConfig,
  SARSAConfig,
} from './algorithms/index.js';

// =============================================================================
// Convenience Factory
// =============================================================================

import { SONAManager, createSONAManager } from './sona-manager.js';
import { ReasoningBank, createReasoningBank } from './reasoning-bank.js';
import { PatternLearner, createPatternLearner } from './pattern-learner.js';
import { SONALearningEngine, createSONALearningEngine } from './sona-integration.js';
import type { SONAMode, NeuralEventListener } from './types.js';

/**
 * Neural Learning System - Complete integrated learning module
 */
export class NeuralLearningSystem {
  private sona: SONAManager;
  private reasoningBank: ReasoningBank;
  private patternLearner: PatternLearner;
  private sonaEngine: SONALearningEngine | null = null;
  private initialized = false;
  private mode: SONAMode;

  constructor(mode: SONAMode = 'balanced') {
    this.mode = mode;
    this.sona = createSONAManager(mode);
    this.reasoningBank = createReasoningBank();
    this.patternLearner = createPatternLearner();
  }

  /**
   * Initialize the learning system.
   * Attempts to start the real @monoes/sona WASM engine; falls back to
   * the pure-JS SONAManager silently if the native engine is unavailable.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.sona.initialize();
    // Wire the real WASM SONA engine when available (lazy-loaded to avoid circular import)
    try {
      const { getModeConfig } = await import('./sona-manager.js');
      const engine = createSONALearningEngine(this.mode, getModeConfig(this.mode));
      await engine.initialize(); // loads WASM, throws if @monoes/sona unavailable
      this.sonaEngine = engine;
    } catch {
      // @monoes/sona not installed or failed to init — JS SONAManager fallback active
      this.sonaEngine = null;
    }
    this.initialized = true;
  }

  /**
   * Get SONA manager
   */
  getSONAManager(): SONAManager {
    return this.sona;
  }

  /**
   * Get ReasoningBank
   */
  getReasoningBank(): ReasoningBank {
    return this.reasoningBank;
  }

  /**
   * Get Pattern Learner
   */
  getPatternLearner(): PatternLearner {
    return this.patternLearner;
  }

  /**
   * Return all patterns currently held by the PatternLearner.
   * Used by LearningBridge to flush learned patterns to patterns.json so the
   * intelligence.ts routing path (Pipeline B) can find them.
   */
  getLearnedPatterns(): Array<{ id: string; domain: string; strategy: string; successRate: number; usageCount: number }> {
    return this.patternLearner.getPatterns().map(p => ({
      id: p.patternId,
      domain: p.domain,
      strategy: p.strategy,
      successRate: p.successRate,
      usageCount: p.usageCount,
    }));
  }

  /**
   * Change learning mode
   */
  async setMode(mode: SONAMode): Promise<void> {
    await this.sona.setMode(mode);
  }

  /**
   * Begin tracking a task
   */
  beginTask(context: string, domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general' = 'general'): string {
    return this.sona.beginTrajectory(context, domain);
  }

  /**
   * Record a step in the current task
   */
  recordStep(
    trajectoryId: string,
    action: string,
    reward: number,
    stateEmbedding: Float32Array
  ): void {
    this.sona.recordStep(trajectoryId, action, reward, stateEmbedding);
  }

  /**
   * Complete a task and trigger learning.
   * Feeds the trajectory into both the JS ReasoningBank pipeline and, when
   * available, the real @monoes/sona WASM engine.
   */
  async completeTask(trajectoryId: string, quality?: number): Promise<void> {
    const trajectory = this.sona.completeTrajectory(trajectoryId, quality);

    if (trajectory) {
      // Store in reasoning bank
      this.reasoningBank.storeTrajectory(trajectory);

      // Judge and potentially distill
      await this.reasoningBank.judge(trajectory);
      const memory = await this.reasoningBank.distill(trajectory);

      // Extract pattern if successful
      if (memory) {
        this.patternLearner.extractPattern(trajectory, memory);
      }

      // Also feed into the real WASM SONA engine when available
      if (this.sonaEngine) {
        try {
          await this.sonaEngine.learn(trajectory);
        } catch {
          // SONA engine failure is non-fatal; JS path already ran above
        }
      }
    }
  }

  /**
   * Find similar patterns for a task.
   * Prefers the real WASM micro-LoRA transformation when the SONA engine is
   * available; falls back to the JS LoRA adaptation from SONAManager.
   */
  async findPatterns(queryEmbedding: Float32Array, k: number = 3): Promise<import('./types.js').PatternMatch[]> {
    let adapted = queryEmbedding;
    if (this.sonaEngine) {
      try {
        const behavior = await this.sonaEngine.adapt({ domain: 'general', queryEmbedding });
        adapted = behavior.transformedQuery;
      } catch {
        adapted = await this.sona.applyAdaptations(queryEmbedding);
      }
    } else {
      adapted = await this.sona.applyAdaptations(queryEmbedding);
    }
    return this.patternLearner.findMatches(adapted, k);
  }

  /**
   * Retrieve relevant memories.
   * Applies WASM or JS LoRA adaptation to the query before retrieval.
   */
  async retrieveMemories(queryEmbedding: Float32Array, k: number = 3): Promise<import('./reasoning-bank.js').RetrievalResult[]> {
    let adapted = queryEmbedding;
    if (this.sonaEngine) {
      try {
        const behavior = await this.sonaEngine.adapt({ domain: 'general', queryEmbedding });
        adapted = behavior.transformedQuery;
      } catch {
        adapted = await this.sona.applyAdaptations(queryEmbedding);
      }
    } else {
      adapted = await this.sona.applyAdaptations(queryEmbedding);
    }
    return this.reasoningBank.retrieve(adapted, k);
  }

  /**
   * Trigger learning cycle
   */
  async triggerLearning(): Promise<void> {
    await this.sona.triggerLearning('manual');
    await this.reasoningBank.consolidate();
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    sona: import('./types.js').NeuralStats;
    reasoningBank: Record<string, number>;
    patternLearner: Record<string, number>;
  } {
    return {
      sona: this.sona.getStats(),
      reasoningBank: this.reasoningBank.getStats(),
      patternLearner: this.patternLearner.getStats(),
    };
  }

  /**
   * Add event listener
   */
  addEventListener(listener: NeuralEventListener): void {
    this.sona.addEventListener(listener);
    this.reasoningBank.addEventListener(listener);
    this.patternLearner.addEventListener(listener);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.sona.cleanup();
    // Shut down ReasoningBank to close any open AgentDB SQLite handle
    if (typeof this.reasoningBank.shutdown === 'function') {
      await this.reasoningBank.shutdown();
    }
    this.initialized = false;
  }
}

/**
 * Create a complete neural learning system
 */
export function createNeuralLearningSystem(mode: SONAMode = 'balanced'): NeuralLearningSystem {
  return new NeuralLearningSystem(mode);
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  // Factories
  createSONAManager,
  createReasoningBank,
  createPatternLearner,
  createNeuralLearningSystem,
  createSONALearningEngine,

  // Classes
  SONAManager,
  ReasoningBank,
  PatternLearner,
  NeuralLearningSystem,
  SONALearningEngine,
};
