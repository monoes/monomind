/**
 * Minimal interface describing the @monoes/sona SonaEngine NAPI surface.
 * Kept in sync with @ruvector/sona (which @monoes/sona re-exports).
 *
 * Ground-truth source: packages/@monoes/sona/node_modules/@ruvector/sona/index.d.ts
 */

export interface SonaEngineAPI {
  /**
   * Start a new trajectory recording.
   * @param queryEmbedding - Query embedding vector
   * @returns Numeric trajectory ID
   */
  beginTrajectory(queryEmbedding: number[]): number;
  /**
   * Add a step to a trajectory.
   * @param trajectoryId - ID returned by beginTrajectory
   * @param activations   - Layer activations
   * @param attentionWeights - Attention weights
   * @param reward        - Reward signal for this step
   */
  addTrajectoryStep(
    trajectoryId: number,
    activations: number[],
    attentionWeights: number[],
    reward: number
  ): void;
  /**
   * Attach a context label to a trajectory.
   * @param trajectoryId - Trajectory ID
   * @param contextId    - Context identifier string
   */
  addTrajectoryContext(trajectoryId: number, contextId: string): void;
  /**
   * Complete a trajectory and submit for learning.
   * @param trajectoryId - Trajectory ID
   * @param quality      - Final quality score [0.0, 1.0]
   */
  endTrajectory(trajectoryId: number, quality: number): void;
  /** Flush instant loop updates. */
  flush(): void;
  /**
   * Apply micro-LoRA transformation to input.
   * @param input - Input vector
   * @returns Transformed output vector
   */
  applyMicroLora(input: number[]): number[];
  /**
   * Find similar learned patterns to query.
   * @param queryEmbedding - Query embedding vector
   * @param k              - Number of patterns to return
   */
  findPatterns(queryEmbedding: number[], k: number): LearnedPattern[];
  /** Returns engine statistics as a JSON string — always parse with try/catch. */
  getStats(): string;
  /** Force background learning cycle immediately. */
  forceLearn(): string;
  /** Run background learning cycle if due. */
  tick(): string | null;
  /** Check if engine is enabled. */
  isEnabled(): boolean;
  /** Enable or disable the engine. */
  setEnabled(enabled: boolean): void;
}

export interface SonaConfig {
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

export interface LearnedPattern {
  patternType?: string;
  avgQuality: number;
  [key: string]: unknown;
}

/**
 * Shape of the @monoes/sona (= @ruvector/sona) module export.
 * SonaEngine is a class with a static `withConfig` factory.
 */
export interface SonaModule {
  SonaEngine: { withConfig(config: SonaConfig): SonaEngineAPI };
}
