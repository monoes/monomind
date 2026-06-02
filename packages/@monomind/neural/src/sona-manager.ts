/**
 * SONA Manager - Self-Optimizing Neural Architecture
 *
 * Manages learning modes and provides adaptive optimization for agent tasks.
 *
 * Performance Targets:
 * - Adaptation: <0.05ms
 * - Pattern retrieval: <1ms
 * - Learning step: <10ms
 *
 * Supported Modes:
 * - real-time: Sub-millisecond adaptation (2200 ops/sec)
 * - balanced: General purpose (+25% quality)
 * - research: Deep exploration (+55% quality)
 * - edge: Resource-constrained (<5MB)
 * - batch: High-throughput processing
 */

import type {
  SONAMode,
  SONAModeConfig,
  ModeOptimizations,
  Trajectory,
  TrajectoryStep,
  Pattern,
  PatternMatch,
  NeuralStats,
  NeuralEvent,
  NeuralEventListener,
  LoRAConfig,
  LoRAWeights,
  EWCConfig,
  EWCState,
  RLAlgorithm,
} from './types.js';

import { RealTimeMode } from './modes/real-time.js';
import { BalancedMode } from './modes/balanced.js';
import { ResearchMode } from './modes/research.js';
import { EdgeMode } from './modes/edge.js';
import { BatchMode } from './modes/batch.js';
import type { ModeImplementation } from './modes/base.js';

/**
 * Default mode configurations
 */
const MODE_CONFIGS: Record<SONAMode, SONAModeConfig> = {
  'real-time': {
    mode: 'real-time',
    loraRank: 2,
    learningRate: 0.001,
    batchSize: 32,
    trajectoryCapacity: 1000,
    patternClusters: 25,
    qualityThreshold: 0.7,
    maxLatencyMs: 0.5,
    memoryBudgetMb: 25,
    ewcLambda: 2000,
  },
  'balanced': {
    mode: 'balanced',
    loraRank: 4,
    learningRate: 0.002,
    batchSize: 32,
    trajectoryCapacity: 3000,
    patternClusters: 50,
    qualityThreshold: 0.5,
    maxLatencyMs: 18,
    memoryBudgetMb: 50,
    ewcLambda: 2000,
  },
  'research': {
    mode: 'research',
    loraRank: 16,
    learningRate: 0.002,
    batchSize: 64,
    trajectoryCapacity: 10000,
    patternClusters: 100,
    qualityThreshold: 0.2,
    maxLatencyMs: 100,
    memoryBudgetMb: 100,
    ewcLambda: 2500,
  },
  'edge': {
    mode: 'edge',
    loraRank: 1,
    learningRate: 0.001,
    batchSize: 16,
    trajectoryCapacity: 200,
    patternClusters: 15,
    qualityThreshold: 0.8,
    maxLatencyMs: 1,
    memoryBudgetMb: 5,
    ewcLambda: 1500,
  },
  'batch': {
    mode: 'batch',
    loraRank: 8,
    learningRate: 0.002,
    batchSize: 128,
    trajectoryCapacity: 5000,
    patternClusters: 75,
    qualityThreshold: 0.4,
    maxLatencyMs: 50,
    memoryBudgetMb: 75,
    ewcLambda: 2000,
  },
};

/**
 * Mode-specific optimizations
 */
const MODE_OPTIMIZATIONS: Record<SONAMode, ModeOptimizations> = {
  'real-time': {
    enableSIMD: true,
    useMicroLoRA: true,
    gradientCheckpointing: false,
    useHalfPrecision: true,
    patternCaching: true,
    asyncUpdates: true,
  },
  'balanced': {
    enableSIMD: true,
    useMicroLoRA: false,
    gradientCheckpointing: false,
    useHalfPrecision: false,
    patternCaching: true,
    asyncUpdates: false,
  },
  'research': {
    enableSIMD: true,
    useMicroLoRA: false,
    gradientCheckpointing: true,
    useHalfPrecision: false,
    patternCaching: true,
    asyncUpdates: false,
  },
  'edge': {
    enableSIMD: false,
    useMicroLoRA: true,
    gradientCheckpointing: false,
    useHalfPrecision: true,
    patternCaching: false,
    asyncUpdates: true,
  },
  'batch': {
    enableSIMD: true,
    useMicroLoRA: false,
    gradientCheckpointing: true,
    useHalfPrecision: true,
    patternCaching: true,
    asyncUpdates: true,
  },
};

/**
 * SONA Manager - Main orchestrator for neural learning
 */
export class SONAManager {
  private currentMode: SONAMode;
  private config: SONAModeConfig;
  private optimizations: ModeOptimizations;
  private modeImpl: ModeImplementation;

  private trajectories: Map<string, Trajectory> = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private loraWeights: Map<string, LoRAWeights> = new Map();
  private ewcState: EWCState | null = null;

  private eventListeners: Set<NeuralEventListener> = new Set();
  private stats: NeuralStats;
  private isInitialized = false;
  private isLearning = false;

  // Performance tracking
  private operationCount = 0;
  private totalLatencyMs = 0;
  private learningCycles = 0;
  private lastStatsUpdate = Date.now();

  constructor(mode: SONAMode = 'balanced') {
    this.currentMode = mode;
    this.config = { ...MODE_CONFIGS[mode] };
    this.optimizations = { ...MODE_OPTIMIZATIONS[mode] };
    this.modeImpl = this.createModeImplementation(mode);
    this.stats = this.createInitialStats();
  }

  /**
   * Initialize the SONA manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Initialize mode implementation
    await this.modeImpl.initialize();

    // Initialize EWC state for continual learning
    this.ewcState = {
      means: new Map(),
      fisher: new Map(),
      taskCount: 0,
      lastConsolidation: Date.now(),
    };

    this.isInitialized = true;
    await this.loadLearnedState();
  }

  /**
   * Change the current learning mode
   */
  async setMode(mode: SONAMode): Promise<void> {
    if (mode === this.currentMode) return;

    const previousMode = this.currentMode;

    // Cleanup current mode
    await this.modeImpl.cleanup();

    // Update configuration
    this.currentMode = mode;
    this.config = { ...MODE_CONFIGS[mode] };
    this.optimizations = { ...MODE_OPTIMIZATIONS[mode] };
    this.loraWeights.clear();
    // L1: reset EWC state so old-rank Fisher/means don't contaminate the new mode's updates
    this.ewcState = {
      means: new Map(),
      fisher: new Map(),
      taskCount: this.ewcState?.taskCount ?? 0,
      lastConsolidation: Date.now(),
    };

    // Create new mode implementation
    this.modeImpl = this.createModeImplementation(mode);
    await this.modeImpl.initialize();

    // Emit mode change event
    this.emitEvent({
      type: 'mode_changed',
      fromMode: previousMode,
      toMode: mode,
    });
  }

  /**
   * Get current mode and configuration
   */
  getConfig(): { mode: SONAMode; config: SONAModeConfig; optimizations: ModeOptimizations } {
    return {
      mode: this.currentMode,
      config: { ...this.config },
      optimizations: { ...this.optimizations },
    };
  }

  // ==========================================================================
  // Trajectory Management
  // ==========================================================================

  /**
   * Begin a new trajectory for a task
   */
  beginTrajectory(context: string, domain: Trajectory['domain'] = 'general'): string {
    const startTime = performance.now();

    const trajectoryId = `traj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const trajectory: Trajectory = {
      trajectoryId,
      context,
      domain,
      steps: [],
      qualityScore: 0,
      isComplete: false,
      startTime: Date.now(),
    };

    this.trajectories.set(trajectoryId, trajectory);

    this.emitEvent({
      type: 'trajectory_started',
      trajectoryId,
      context,
    });

    this.trackLatency(performance.now() - startTime);
    return trajectoryId;
  }

  /**
   * Record a step in a trajectory
   */
  recordStep(
    trajectoryId: string,
    action: string,
    reward: number,
    stateEmbedding: Float32Array,
    metadata?: Record<string, unknown>
  ): void {
    const startTime = performance.now();

    if (!Number.isFinite(reward)) return;

    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || trajectory.isComplete) return;

    const step: TrajectoryStep = {
      stepId: `step_${trajectory.steps.length}`,
      timestamp: Date.now(),
      action,
      stateBefore: trajectory.steps.length > 0
        ? trajectory.steps[trajectory.steps.length - 1].stateAfter
        : stateEmbedding,
      stateAfter: stateEmbedding,
      reward,
      metadata,
    };

    trajectory.steps.push(step);

    // Update running quality score
    trajectory.qualityScore = this.calculateQualityScore(trajectory);

    this.trackLatency(performance.now() - startTime);
  }

  /**
   * Complete a trajectory
   */
  completeTrajectory(trajectoryId: string, finalQuality?: number): Trajectory | null {
    const startTime = performance.now();

    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || trajectory.isComplete) return null;

    trajectory.isComplete = true;
    trajectory.endTime = Date.now();

    if (finalQuality !== undefined) {
      trajectory.qualityScore = Math.max(0, Math.min(1, Number.isFinite(finalQuality) ? finalQuality : 0));
    } else {
      trajectory.qualityScore = this.calculateQualityScore(trajectory);
    }

    this.emitEvent({
      type: 'trajectory_completed',
      trajectoryId,
      qualityScore: trajectory.qualityScore,
    });

    // Check if we should trigger learning
    this.checkLearningTrigger();

    this.trackLatency(performance.now() - startTime);
    return trajectory;
  }

  /**
   * Get a trajectory by ID
   */
  getTrajectory(trajectoryId: string): Trajectory | undefined {
    return this.trajectories.get(trajectoryId);
  }

  // ==========================================================================
  // Pattern Matching
  // ==========================================================================

  /**
   * Find similar patterns for a given context (k=3 optimal)
   */
  async findSimilarPatterns(
    embedding: Float32Array,
    k: number = 3
  ): Promise<PatternMatch[]> {
    const startTime = performance.now();

    const matches = await this.modeImpl.findPatterns(embedding, k, Array.from(this.patterns.values()));

    // Track pattern match events
    for (const match of matches) {
      this.emitEvent({
        type: 'pattern_matched',
        patternId: match.pattern.patternId,
        similarity: match.similarity,
      });
    }

    const latency = performance.now() - startTime;

    // Add latency to matches
    return matches.map(m => ({ ...m, latencyMs: latency }));
  }

  /**
   * Store a new pattern
   */
  storePattern(pattern: Omit<Pattern, 'patternId' | 'createdAt' | 'updatedAt'>): Pattern {
    const startTime = performance.now();

    const fullPattern: Pattern = {
      ...pattern,
      patternId: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.patterns.set(fullPattern.patternId, fullPattern);

    this.trackLatency(performance.now() - startTime);
    return fullPattern;
  }

  /**
   * Update pattern based on usage
   */
  updatePatternUsage(patternId: string, quality: number): void {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.usageCount++;
    pattern.qualityHistory.push(quality);

    // Keep only last 100 quality scores
    if (pattern.qualityHistory.length > 100) {
      pattern.qualityHistory = pattern.qualityHistory.slice(-100);
    }

    // Update success rate
    pattern.successRate = pattern.qualityHistory.reduce((a, b) => a + b, 0) / pattern.qualityHistory.length;
    pattern.updatedAt = Date.now();
  }

  // ==========================================================================
  // Learning
  // ==========================================================================

  /**
   * Trigger a learning cycle
   */
  async triggerLearning(reason: string = 'manual'): Promise<void> {
    // Reentrancy guard — concurrent trajectory completions can race here
    if (this.isLearning) return;
    this.isLearning = true;
    const startTime = performance.now();
    try {
      const completedTrajectories = Array.from(this.trajectories.values())
        .filter(t => t.isComplete && t.qualityScore >= this.config.qualityThreshold);

      // Always prune regardless of whether any trajectories met quality threshold
      this.pruneTrajectories();

      if (completedTrajectories.length === 0) return;

      this.emitEvent({
        type: 'learning_triggered',
        reason,
        trajectoryCount: completedTrajectories.length,
      });

      // Ensure LoRA weights are initialized for the default domain
      if (!this.loraWeights.has('default')) {
        this.initializeLoRAWeights('default');
      }

      // H1: guard against ewcState being null (possible if triggerLearning fires before initialize())
      if (!this.ewcState) {
        console.warn('[SONAManager] triggerLearning called before initialize() — skipping');
        return;
      }

      // Perform learning via mode implementation
      const improvementDelta = await this.modeImpl.learn(
        completedTrajectories,
        this.config,
        this.ewcState
      );

      // Apply gradient update to LoRA B matrices using trajectory rewards
      this.updateLoRAFromTrajectories(completedTrajectories);

      // Update EWC Fisher information from current LoRA weights
      this.updateEWCFisher();
      // NOTE: consolidateEWC() is intentionally NOT called here.
      // It runs only in cleanup() at genuine session/task boundaries.
      // Calling it every cycle would re-anchor means=B, collapsing (B-means)
      // to zero on the next cycle and making the EWC penalty a permanent no-op.

      this.learningCycles++;

      this.emitEvent({
        type: 'learning_completed',
        improvementDelta,
      });

      this.trackLatency(performance.now() - startTime);

      void this.persistLearnedState().catch(err =>
        console.error('[SONAManager] Failed to persist learned state:', err)
      );
    } finally {
      // Always release reentrancy guard even if an error is thrown
      this.isLearning = false;
    }
  }

  /**
   * Apply learned adaptations to processing
   */
  async applyAdaptations(
    input: Float32Array,
    domain?: string
  ): Promise<Float32Array> {
    const startTime = performance.now();

    // Get relevant LoRA weights
    const weights = domain
      ? this.loraWeights.get(domain)
      : this.loraWeights.get('default');

    // Apply adaptations via mode implementation
    const output = await this.modeImpl.applyLoRA(input, weights);

    const latency = performance.now() - startTime;

    // Verify performance target
    if (latency > 0.05 && this.currentMode !== 'research' && this.currentMode !== 'batch') {
      console.warn(`SONA adaptation exceeded target: ${latency.toFixed(3)}ms > 0.05ms`);
    }

    return output;
  }

  // ==========================================================================
  // LoRA Management
  // ==========================================================================

  /**
   * Get LoRA configuration for current mode
   */
  getLoRAConfig(): LoRAConfig {
    return {
      rank: this.config.loraRank,
      alpha: this.config.loraRank * 2,
      dropout: 0.05,
      targetModules: ['q_proj', 'v_proj', 'k_proj', 'o_proj'],
      microLoRA: this.optimizations.useMicroLoRA,
    };
  }

  /**
   * Initialize LoRA weights for a domain
   */
  initializeLoRAWeights(domain: string = 'default'): LoRAWeights {
    const config = this.getLoRAConfig();

    const weights: LoRAWeights = {
      adapterId: `lora_${domain}_${Date.now()}`,
      A: new Map(),
      B: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      iterations: 0,
      domain,
    };

    // Initialize A and B matrices for each target module
    for (const module of config.targetModules) {
      // A: (hidden_dim, rank) initialized with small random values
      // B: (rank, hidden_dim) initialized to zero
      const hiddenDim = 768; // Typical transformer hidden dim
      const A = new Float32Array(hiddenDim * config.rank);
      const B = new Float32Array(config.rank * hiddenDim);

      // Initialize A with small random values
      for (let i = 0; i < A.length; i++) {
        A[i] = (Math.random() - 0.5) * 0.02;
      }

      weights.A.set(module, A);
      weights.B.set(module, B);
    }

    this.loraWeights.set(domain, weights);
    return weights;
  }

  // ==========================================================================
  // EWC (Elastic Weight Consolidation)
  // ==========================================================================

  /**
   * Get EWC configuration
   */
  getEWCConfig(): EWCConfig {
    return {
      lambda: this.config.ewcLambda,
      decay: 0.9,
      fisherSamples: 100,
      minFisher: 1e-8,
      online: true,
    };
  }

  /**
   * Consolidate EWC after learning a new task
   */
  consolidateEWC(): void {
    if (!this.ewcState) return;

    const config = this.getEWCConfig();

    // Decay Fisher and — critically — snapshot current B into means.
    // This is the task-boundary update: means now freezes at the weights
    // learned by this task, so next task's EWC penalty measures drift from HERE.
    for (const [key, fisher] of this.ewcState.fisher) {
      for (let i = 0; i < fisher.length; i++) {
        fisher[i] *= config.decay;
      }

      // Snapshot current B into means at task boundary
      const parts = key.split(':');
      const domain = parts[0];
      const module = parts.slice(1).join(':');
      const weights = this.loraWeights.get(domain);
      const B = weights?.B.get(module);
      if (B) {
        let means = this.ewcState.means.get(key);
        if (!means || means.length !== B.length) {
          means = new Float32Array(B.length);
          this.ewcState.means.set(key, means);
        }
        for (let i = 0; i < B.length; i++) {
          means[i] = B[i];
        }
      }
    }

    this.ewcState.taskCount++;
    this.ewcState.lastConsolidation = Date.now();
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get current neural system statistics
   */
  getStats(): NeuralStats {
    this.updateStats();
    return { ...this.stats };
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  /**
   * Add an event listener
   */
  addEventListener(listener: NeuralEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: NeuralEventListener): void {
    this.eventListeners.delete(listener);
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Consolidate EWC at genuine task boundary: snapshot current B into means
    // so the NEXT session's penalty measures drift from this session's endpoint.
    this.consolidateEWC();
    await this.persistLearnedState();
    await this.modeImpl.cleanup();
    this.trajectories.clear();
    this.patterns.clear();
    this.loraWeights.clear();
    this.eventListeners.clear();
    this.isInitialized = false;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private createModeImplementation(mode: SONAMode): ModeImplementation {
    switch (mode) {
      case 'real-time':
        return new RealTimeMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
      case 'balanced':
        return new BalancedMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
      case 'research':
        return new ResearchMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
      case 'edge':
        return new EdgeMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
      case 'batch':
        return new BatchMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
      default:
        return new BalancedMode(MODE_CONFIGS['balanced'], MODE_OPTIMIZATIONS['balanced']);
    }
  }

  private calculateQualityScore(trajectory: Trajectory): number {
    if (trajectory.steps.length === 0) return 0;

    // Average reward across steps
    const avgReward = trajectory.steps.reduce((sum, step) => sum + step.reward, 0) / trajectory.steps.length;

    // Discount factor for trajectory length (longer trajectories may accumulate errors)
    const lengthFactor = Math.min(1, 10 / trajectory.steps.length);

    return avgReward * 0.8 + lengthFactor * 0.2;
  }

  private checkLearningTrigger(): void {
    const trajectoryArray = Array.from(this.trajectories.values());
    const completedCount = trajectoryArray.filter(t => t.isComplete).length;
    const MIN_TRIGGER_COUNT = 5;
    const utilization = completedCount / this.config.trajectoryCapacity;
    const shouldTrigger = utilization >= 0.8 || completedCount >= MIN_TRIGGER_COUNT;
    if (shouldTrigger) {
      this.triggerLearning('capacity_threshold').catch(err => {
        console.error('[SONAManager] Auto-triggered learning failed:', err);
      });
    }
  }

  private pruneTrajectories(): void {
    const completed = Array.from(this.trajectories.entries())
      .filter(([_, t]) => t.isComplete)
      .sort((a, b) => a[1].qualityScore - b[1].qualityScore);

    // Remove lowest quality trajectories if over capacity
    const toRemove = completed.length - Math.floor(this.config.trajectoryCapacity * 0.5);

    if (toRemove > 0) {
      for (let i = 0; i < toRemove && i < completed.length; i++) {
        this.trajectories.delete(completed[i][0]);
      }
    }
  }

  private trackLatency(latencyMs: number): void {
    this.operationCount++;
    this.totalLatencyMs += latencyMs;
  }

  private emitEvent(event: NeuralEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in neural event listener:', error);
      }
    }
  }

  private createInitialStats(): NeuralStats {
    return {
      trajectories: {
        total: 0,
        active: 0,
        completed: 0,
        utilization: 0,
      },
      performance: {
        avgQualityScore: 0,
        opsPerSecond: 0,
        learningCycles: 0,
        avgLatencyMs: 0,
      },
      patterns: {
        totalPatterns: 0,
        avgMatchTime: 0,
        cacheHitRate: 0,
        evolutionCount: 0,
      },
      memory: {
        usedMb: 0,
        budgetMb: this.config.memoryBudgetMb,
        trajectoryBytes: 0,
        patternBytes: 0,
      },
      config: {
        mode: this.currentMode,
        loraRank: this.config.loraRank,
        learningRate: this.config.learningRate,
        algorithm: 'ppo',
      },
    };
  }

  private updateStats(): void {
    const now = Date.now();
    const elapsed = (now - this.lastStatsUpdate) / 1000;

    const trajectoryArray = Array.from(this.trajectories.values());
    const completed = trajectoryArray.filter(t => t.isComplete);

    this.stats = {
      trajectories: {
        total: trajectoryArray.length,
        active: trajectoryArray.filter(t => !t.isComplete).length,
        completed: completed.length,
        utilization: trajectoryArray.length / this.config.trajectoryCapacity,
      },
      performance: {
        avgQualityScore: completed.length > 0
          ? completed.reduce((sum, t) => sum + t.qualityScore, 0) / completed.length
          : 0,
        opsPerSecond: elapsed > 0 ? this.operationCount / elapsed : 0,
        learningCycles: this.learningCycles,
        avgLatencyMs: this.operationCount > 0
          ? this.totalLatencyMs / this.operationCount
          : 0,
      },
      patterns: {
        totalPatterns: this.patterns.size,
        avgMatchTime: 0, // Updated by mode implementation
        cacheHitRate: 0, // Updated by mode implementation
        evolutionCount: Array.from(this.patterns.values())
          .reduce((sum, p) => sum + p.evolutionHistory.length, 0),
      },
      memory: {
        usedMb: this.estimateMemoryUsage(),
        budgetMb: this.config.memoryBudgetMb,
        trajectoryBytes: this.estimateTrajectoryBytes(),
        patternBytes: this.estimatePatternBytes(),
      },
      config: {
        mode: this.currentMode,
        loraRank: this.config.loraRank,
        learningRate: this.config.learningRate,
        algorithm: 'ppo',
      },
    };

    this.lastStatsUpdate = now;
    this.operationCount = 0;
    this.totalLatencyMs = 0;
  }

  /**
   * Apply a reward-weighted gradient update to LoRA B matrices.
   * Uses each completed trajectory's final state embedding projected
   * through A to produce a rank-dimensional update signal for B.
   */
  private updateLoRAFromTrajectories(trajectories: Trajectory[]): void {
    const weights = this.loraWeights.get('default');
    if (!weights) return;

    const lr = this.config.learningRate;
    const rank = this.config.loraRank;

    for (const module of ['q_proj', 'v_proj', 'k_proj', 'o_proj']) {
      const B = weights.B.get(module);
      const A = weights.A.get(module);
      if (!B || !A) continue;

      const hiddenDim = B.length / rank;
      const gradSignal = new Float32Array(rank);
      let count = 0;

      for (const traj of trajectories) {
        if (traj.steps.length === 0) continue;
        const reward = traj.qualityScore;
        const embedding = traj.steps[traj.steps.length - 1].stateAfter;
        if (!embedding) continue;

        // Project embedding into rank-space via A: gradSignal[r] += reward * (A_row_r · embedding)
        for (let r = 0; r < rank; r++) {
          let dot = 0;
          for (let d = 0; d < Math.min(hiddenDim, embedding.length); d++) {
            dot += A[r * hiddenDim + d] * embedding[d];
          }
          gradSignal[r] += reward * dot;
        }
        count++;
      }

      if (count === 0) continue;

      // Apply EWC regularization penalty to constrain updates near task means
      const ewcKey = `default:${module}`;
      const fisher = this.ewcState?.fisher.get(ewcKey);
      const means = this.ewcState?.means.get(ewcKey);
      const ewcLambda = this.config.ewcLambda;

      // Apply averaged gradient update to B with optional EWC penalty
      for (let r = 0; r < rank; r++) {
        const grad = gradSignal[r] / count;
        for (let d = 0; d < hiddenDim; d++) {
          const idx = r * hiddenDim + d;
          let update = lr * grad;
          // Subtract EWC penalty: lambda * fisher * (B - means)
          if (fisher && means && idx < fisher.length && idx < means.length) {
            update -= lr * ewcLambda * fisher[idx] * (B[idx] - means[idx]);
          }
          B[idx] += update;
        }
      }
    }

    weights.iterations++;
    weights.updatedAt = Date.now();
  }

  /**
   * Update EWC Fisher information from the current LoRA B matrices.
   * Uses B^2 as a proxy for parameter importance (online EWC).
   */
  private updateEWCFisher(): void {
    if (!this.ewcState) return;

    for (const [domain, weights] of this.loraWeights) {
      for (const [module, B] of weights.B) {
        const key = `${domain}:${module}`;
        let fisher = this.ewcState.fisher.get(key);

        if (!fisher) {
          // First task: initialize Fisher and means from current B
          fisher = new Float32Array(B.length);
          const means = new Float32Array(B);
          for (let i = 0; i < B.length; i++) {
            fisher[i] = B[i] * B[i];
          }
          this.ewcState.fisher.set(key, fisher);
          this.ewcState.means.set(key, means);
        } else {
          // Accumulate B² into Fisher each cycle — consolidateEWC applies the decay.
          // IMPORTANT: do NOT update means here (see comment above).
          // CRITICAL: cap Fisher at the EWC stability threshold so the penalty term
          // (lr * ewcLambda * fisher * (B - means)) stays bounded. The recurrence
          // (B - means)_new = (B - means) * (1 - lr*ewcLambda*fisher) diverges when
          // fisher > 2/(lr*ewcLambda). For balanced mode that threshold is 0.5.
          // Uncapped Fisher grows to thousands in <25 cycles, causing exponential B blowup.
          const maxFisher = 0.5 / (this.config.learningRate * this.config.ewcLambda);
          for (let i = 0; i < B.length; i++) {
            fisher[i] = Math.min(maxFisher, fisher[i] + B[i] * B[i]);
          }
        }
      }
    }
  }

  /**
   * Get LoRA adapter statistics
   */
  getLoRAStats(): Record<string, { domain: string; iterations: number; modules: string[]; avgBNorm: number }> {
    const result: Record<string, { domain: string; iterations: number; modules: string[]; avgBNorm: number }> = {};
    for (const [domain, weights] of this.loraWeights) {
      // L2: compute normalized Frobenius norm of B matrices for observability.
      // Healthy: avgBNorm < 0.01 after a few cycles. >0.1 = suspicious. >1.0 = diverging.
      let totalNorm = 0;
      let normCount = 0;
      for (const B of weights.B.values()) {
        let sumSq = 0;
        for (let i = 0; i < B.length; i++) sumSq += B[i] * B[i];
        totalNorm += Math.sqrt(sumSq / Math.max(1, B.length));
        normCount++;
      }
      result[domain] = {
        domain: weights.domain ?? domain,
        iterations: weights.iterations,
        modules: Array.from(weights.B.keys()),
        avgBNorm: normCount > 0 ? totalNorm / normCount : 0,
      };
    }
    return result;
  }

  /**
   * Persist learned LoRA weights and EWC state to disk
   */
  private async persistLearnedState(): Promise<void> {
    try {
      const { mkdir, writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const dir = join(process.cwd(), '.monomind', 'neural');
      await mkdir(dir, { recursive: true });

      const state: Record<string, unknown> = {
        version: 1,
        timestamp: Date.now(),
        mode: this.currentMode,
        loraWeights: {} as Record<string, unknown>,
        ewcState: null as unknown,
      };

      // Serialize loraWeights
      const loraData: Record<string, unknown> = {};
      for (const [domain, weights] of this.loraWeights) {
        const aData: Record<string, number[]> = {};
        const bData: Record<string, number[]> = {};
        for (const [module, A] of weights.A) {
          aData[module] = Array.from(A);
        }
        for (const [module, B] of weights.B) {
          bData[module] = Array.from(B);
        }
        loraData[domain] = {
          adapterId: weights.adapterId,
          domain: weights.domain,
          iterations: weights.iterations,
          createdAt: weights.createdAt,
          updatedAt: weights.updatedAt,
          A: aData,
          B: bData,
        };
      }
      state.loraWeights = loraData;

      // Serialize ewcState
      if (this.ewcState) {
        const meansData: Record<string, number[]> = {};
        const fisherData: Record<string, number[]> = {};
        for (const [key, means] of this.ewcState.means) {
          meansData[key] = Array.from(means);
        }
        for (const [key, fisher] of this.ewcState.fisher) {
          fisherData[key] = Array.from(fisher);
        }
        state.ewcState = {
          means: meansData,
          fisher: fisherData,
          taskCount: this.ewcState.taskCount,
          lastConsolidation: this.ewcState.lastConsolidation,
        };
      }

      // H2: atomic write — write to tmp then rename so a crash mid-write can't corrupt state
      const filePath = join(dir, 'learned-state.json');
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(tmpPath, JSON.stringify(state), 'utf8');
      const { rename } = await import('fs/promises');
      await rename(tmpPath, filePath);
    } catch (err) {
      // Non-fatal — just log and continue
      console.error('[SONAManager] persistLearnedState error:', err);
    }
  }

  /**
   * Load persisted LoRA weights and EWC state from disk
   */
  private async loadLearnedState(): Promise<void> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const filePath = join(process.cwd(), '.monomind', 'neural', 'learned-state.json');
      const raw = await readFile(filePath, 'utf8');
      const state = JSON.parse(raw) as {
        version: number;
        loraWeights: Record<string, {
          adapterId: string;
          domain: string;
          iterations: number;
          createdAt: number;
          updatedAt: number;
          A: Record<string, number[]>;
          B: Record<string, number[]>;
        }>;
        ewcState?: {
          means: Record<string, number[]>;
          fisher: Record<string, number[]>;
          taskCount: number;
          lastConsolidation: number;
        };
      };

      if (!state || state.version !== 1) return;

      // Restore loraWeights
      for (const [domain, data] of Object.entries(state.loraWeights)) {
        const weights: LoRAWeights = {
          adapterId: data.adapterId,
          domain: data.domain,
          iterations: data.iterations,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          A: new Map(),
          B: new Map(),
        };
        for (const [module, arr] of Object.entries(data.A)) {
          weights.A.set(module, new Float32Array(arr));
        }
        for (const [module, arr] of Object.entries(data.B)) {
          weights.B.set(module, new Float32Array(arr));
        }

        // Sanity-check loaded B norms. avgBNorm > 1.0 indicates prior divergence.
        // Reset to zero to prevent corrupted weights poisoning future sessions.
        let totalNorm = 0;
        let normCount = 0;
        for (const B of weights.B.values()) {
          let sumSq = 0;
          for (let i = 0; i < B.length; i++) sumSq += B[i] * B[i];
          totalNorm += Math.sqrt(sumSq / Math.max(1, B.length));
          normCount++;
        }
        const avgBNorm = normCount > 0 ? totalNorm / normCount : 0;
        if (avgBNorm > 1.0) {
          console.warn(`[SONAManager] Loaded LoRA weights for domain '${domain}' have diverged (avgBNorm=${avgBNorm.toFixed(2)}). Resetting B matrices to zero.`);
          for (const B of weights.B.values()) B.fill(0);
        }

        this.loraWeights.set(domain, weights);
      }

      // Restore ewcState
      if (state.ewcState && this.ewcState) {
        for (const [key, arr] of Object.entries(state.ewcState.means)) {
          this.ewcState.means.set(key, new Float32Array(arr));
        }
        for (const [key, arr] of Object.entries(state.ewcState.fisher)) {
          this.ewcState.fisher.set(key, new Float32Array(arr));
        }
        this.ewcState.taskCount = state.ewcState.taskCount;
        this.ewcState.lastConsolidation = state.ewcState.lastConsolidation;
      }
    } catch (err) {
      // File may not exist yet on first run — that's fine
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error('[SONAManager] loadLearnedState error:', err);
      }
    }
  }

  private estimateMemoryUsage(): number {
    // Rough estimation in MB
    return (this.estimateTrajectoryBytes() + this.estimatePatternBytes()) / (1024 * 1024);
  }

  private estimateTrajectoryBytes(): number {
    let bytes = 0;
    for (const trajectory of this.trajectories.values()) {
      bytes += 200; // Base trajectory overhead
      bytes += trajectory.context.length * 2;
      bytes += trajectory.steps.length * (64 + 4 * 768 * 4); // Step overhead + embeddings
    }
    return bytes;
  }

  private estimatePatternBytes(): number {
    let bytes = 0;
    for (const pattern of this.patterns.values()) {
      bytes += 100; // Base pattern overhead
      bytes += pattern.name.length * 2;
      bytes += pattern.strategy.length * 2;
      bytes += pattern.embedding.byteLength;
      bytes += pattern.qualityHistory.length * 8;
      bytes += pattern.evolutionHistory.length * 100;
    }
    return bytes;
  }
}

/**
 * Factory function for creating SONA manager
 */
export function createSONAManager(mode: SONAMode = 'balanced'): SONAManager {
  return new SONAManager(mode);
}

/**
 * Get default configuration for a mode
 */
export function getModeConfig(mode: SONAMode): SONAModeConfig {
  return { ...MODE_CONFIGS[mode] };
}

/**
 * Get optimizations for a mode
 */
export function getModeOptimizations(mode: SONAMode): ModeOptimizations {
  return { ...MODE_OPTIMIZATIONS[mode] };
}
