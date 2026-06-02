/**
 * Minimal interface describing the @monoes/sona SonaEngine WASM surface.
 * Kept in sync manually with package updates.
 */

export interface SonaEngineAPI {
  withConfig(config: SonaConfig): SonaEngineAPI;
  beginTrajectory(id: string, context?: string): void;
  addTrajectoryStep(
    trajectoryId: string,
    action: string,
    stateBefore: number[],
    stateAfter: number[],
    reward: number
  ): void;
  addTrajectoryContext(trajectoryId: string, key: string, value: string): void;
  endTrajectory(trajectoryId: string, verdict: string, quality: number): void;
  flush(): void;
  applyMicroLora(gradient: Float32Array): void;
  findPatterns(embedding: Float32Array, topK: number): LearnedPattern[];
  /** Returns JSON string — always parse with try/catch */
  getStats(): string;
  forceLearn(): string;
  tick(): string | null;
  isEnabled(): boolean;
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

export interface SonaModule {
  SonaEngine: { withConfig(config: SonaConfig): SonaEngineAPI };
}
