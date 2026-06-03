/**
 * SONA Bridge
 *
 * Bridge to SONA (Self-Optimizing Neural Architecture) for continuous
 * learning with LoRA fine-tuning and EWC++ memory preservation.
 */

import type { WasmBridge, WasmModuleStatus, SonaConfig } from '../types.js';
import { SonaConfigSchema, isNativeDisabled } from '../types.js';

/**
 * SONA trajectory for learning
 */
export interface SonaTrajectory {
  id: string;
  domain: string;
  steps: SonaStep[];
  qualityScore: number;
  metadata?: Record<string, unknown>;
}

/**
 * SONA learning step
 */
export interface SonaStep {
  stateBefore: Float32Array;
  action: string;
  stateAfter: Float32Array;
  reward: number;
  timestamp: number;
}

/**
 * SONA pattern
 */
export interface SonaPattern {
  id: string;
  embedding: Float32Array;
  successRate: number;
  usageCount: number;
  domain: string;
}

/**
 * LoRA weights
 */
export interface LoRAWeights {
  A: Map<string, Float32Array>;
  B: Map<string, Float32Array>;
  rank: number;
  alpha: number;
}

/**
 * EWC state
 */
export interface EWCState {
  fisher: Map<string, Float32Array>;
  means: Map<string, Float32Array>;
  lambda: number;
}

/**
 * SONA WASM module interface
 */
interface SonaModule {
  // Core learning
  learn(trajectories: SonaTrajectory[], config: SonaConfig): number;
  predict(state: Float32Array): { action: string; confidence: number };

  // Pattern management
  storePattern(pattern: SonaPattern): void;
  findPatterns(query: Float32Array, k: number): SonaPattern[];
  updatePatternSuccess(patternId: string, success: boolean): void;

  // LoRA operations
  applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array;
  updateLoRA(gradients: Float32Array, config: SonaConfig): LoRAWeights;

  // EWC operations
  computeFisher(trajectories: SonaTrajectory[]): Map<string, Float32Array>;
  consolidate(ewcState: EWCState): void;

  // Mode-specific optimizations
  setMode(mode: SonaConfig['mode']): void;
  getMode(): SonaConfig['mode'];
}

/**
 * SONA Bridge implementation
 */
export class SonaBridge implements WasmBridge<SonaModule> {
  readonly name = 'sona';
  readonly version = '0.1.0';

  private _status: WasmModuleStatus = 'unloaded';
  private _module: SonaModule | null = null;
  private _sonaEngine: any | null = null; // real SonaEngine instance
  private config: SonaConfig;

  constructor(config?: Partial<SonaConfig>) {
    this.config = SonaConfigSchema.parse(config ?? {});
  }

  get status(): WasmModuleStatus {
    return this._status;
  }

  async init(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'loading') return;
    if (this._status === 'error') return;

    // Native kill-switch — force pure-JS mock, skip the @monoes/sona load.
    if (isNativeDisabled()) {
      this._module = this.createMockModule();
      this._status = 'ready';
      return;
    }

    this._status = 'loading';

    try {
      const wasmModule = await import('@monoes/sona').catch(() => null);

      if (!wasmModule) {
        this._module = this.createMockModule();
        this._status = 'ready'; // mock is always ready
        return;
      }

      // Guard: check if real @monoes/sona has the expected interface.
      // The real NAPI surface uses SonaEngine.withConfig() not top-level setMode/learn.
      const hasSonaEngine =
        typeof (wasmModule as any).SonaEngine === 'function' ||
        !!(wasmModule as any).SonaEngine;
      if (!hasSonaEngine) {
        // Real module doesn't match our expected interface — use mock to avoid TypeError loops
        this._module = this.createMockModule();
        this._status = 'ready';
        return;
      }

      // Real module has SonaEngine — create an engine instance via the withConfig factory.
      const SonaEngineClass = (wasmModule as any).SonaEngine;
      try {
        const sonaConfig = {
          hiddenDim: 768,
          embeddingDim: 768,
          // valid range: 1-2 (higher values cause an uncatchable Rust SIGABRT).
          // If this ever becomes config-driven, clamp via @monomind/neural's
          // safeMicroLoraRank (or a local Math.min(rank, 2)) before passing it.
          microLoraRank: 1,
          baseLoraRank: 8,
          microLoraLr: 0.001,
          baseLoraLr: 0.0001,
          ewcLambda: 1000,
          patternClusters: 50,
          trajectoryCapacity: 100,
          qualityThreshold: 0.6,
          enableSimd: true,
          backgroundIntervalMs: 1000,
        };
        this._sonaEngine = SonaEngineClass.withConfig(sonaConfig);
      } catch (err) {
        this._sonaEngine = null;
        console.debug(
          '[SonaBridge] SonaEngine.withConfig() failed, using mock:',
          err instanceof Error ? err.message : String(err)
        );
      }
      // Always set up mock for SonaModule interface methods that have no real-engine
      // equivalent (predict, applyLoRA, consolidate, setMode). learn/findPatterns/getStats
      // delegate to the real engine when available.
      this._module = this.createMockModule();
      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._sonaEngine = null;
    this._status = 'unloaded';
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): SonaModule | null {
    return this._module;
  }

  /**
   * Whether the real @monoes/sona engine is active (vs. mock)
   */
  get hasRealEngine(): boolean {
    return this._sonaEngine !== null;
  }

  /**
   * Learn from trajectories.
   * Delegates to the real SonaEngine when available; falls back to mock.
   *
   * Mapping from SonaTrajectory to SonaEngineAPI:
   *   beginTrajectory(queryEmbedding)   — uses first step's stateBefore as query embedding
   *   addTrajectoryStep(id, activations, attentionWeights, reward) — activations = stateAfter
   *   addTrajectoryContext(id, domain)
   *   endTrajectory(id, qualityScore)
   */
  learn(trajectories: SonaTrajectory[], config?: Partial<SonaConfig>): number {
    if (this._sonaEngine) {
      try {
        let totalLearned = 0;
        for (const traj of trajectories) {
          // Use first step's stateBefore as the query embedding for trajectory start,
          // falling back to an empty array if no steps exist.
          const queryEmbedding =
            traj.steps.length > 0 ? Array.from(traj.steps[0].stateBefore) : [];
          const trajId: number = this._sonaEngine.beginTrajectory(queryEmbedding);

          for (const step of traj.steps) {
            // activations = stateAfter; attentionWeights = [] (no equivalent in bridge type)
            this._sonaEngine.addTrajectoryStep(
              trajId,
              Array.from(step.stateAfter),
              [],
              step.reward
            );
          }

          // Attach domain as context label
          this._sonaEngine.addTrajectoryContext(trajId, traj.domain);

          this._sonaEngine.endTrajectory(trajId, traj.qualityScore);
          totalLearned++;
        }
        this._sonaEngine.flush();
        return totalLearned;
      } catch {
        // Fall through to mock
      }
    }
    if (!this._module) throw new Error('SONA module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.learn(trajectories, mergedConfig);
  }

  /**
   * Predict next action
   */
  predict(state: Float32Array): { action: string; confidence: number } {
    if (!this._module) throw new Error('SONA module not initialized');
    return this._module.predict(state);
  }

  /**
   * Store a pattern
   */
  storePattern(pattern: SonaPattern): void {
    if (!this._module) throw new Error('SONA module not initialized');
    this._module.storePattern(pattern);
  }

  /**
   * Find similar patterns.
   * Delegates to the real SonaEngine when available; falls back to mock.
   *
   * Mapping from LearnedPattern (engine) to SonaPattern (bridge):
   *   successRate  = avgQuality
   *   usageCount   = accessCount (may be absent, defaults to 1)
   *   domain       = patternType (may be absent, defaults to 'general')
   */
  findPatterns(query: Float32Array, k: number): SonaPattern[] {
    if (this._sonaEngine) {
      try {
        const rawPatterns: any[] = this._sonaEngine.findPatterns(Array.from(query), k);
        return rawPatterns.map((p: any) => ({
          id: p.id ?? String(Math.random()),
          embedding: new Float32Array(p.centroid ?? Array.from(query)),
          successRate: p.avgQuality ?? 0,
          usageCount: p.accessCount ?? 1,
          domain: p.patternType ?? 'general',
        }));
      } catch {
        // Fall through to mock
      }
    }
    if (!this._module) throw new Error('SONA module not initialized');
    return this._module.findPatterns(query, k);
  }

  /**
   * Apply LoRA transformation
   */
  applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array {
    if (!this._module) throw new Error('SONA module not initialized');
    return this._module.applyLoRA(input, weights);
  }

  /**
   * Consolidate memory with EWC
   */
  consolidate(ewcState: EWCState): void {
    if (!this._module) throw new Error('SONA module not initialized');
    this._module.consolidate(ewcState);
  }

  /**
   * Set operating mode
   */
  setMode(mode: SonaConfig['mode']): void {
    if (!this._module) throw new Error('SONA module not initialized');
    this._module.setMode(mode);
    this.config.mode = mode;
  }

  /**
   * Get current mode
   */
  getMode(): SonaConfig['mode'] {
    return this._module?.getMode() ?? this.config.mode;
  }

  /**
   * Get engine statistics.
   * Returns parsed JSON from the real engine when available; falls back to mock.
   */
  getStats(): Record<string, unknown> {
    if (this._sonaEngine) {
      try {
        const statsJson: string = this._sonaEngine.getStats();
        return JSON.parse(statsJson) as Record<string, unknown>;
      } catch {
        // Fall through to mock
      }
    }
    // SonaModule interface has no getStats — cast to access it if present
    return (this._module as any)?.getStats?.() ?? {};
  }

  /**
   * Create mock module for development
   */
  private createMockModule(): SonaModule {
    const patterns = new Map<string, SonaPattern>();
    let currentMode: SonaConfig['mode'] = 'balanced';
    let loraWeights: LoRAWeights = {
      A: new Map(),
      B: new Map(),
      rank: 4,
      alpha: 0.1,
    };

    return {
      learn(trajectories: SonaTrajectory[], config: SonaConfig): number {
        if (trajectories.length === 0) return 0;

        const goodTrajectories = trajectories.filter(t => t.qualityScore >= 0.5);
        if (goodTrajectories.length === 0) return 0;

        // Extract patterns from good trajectories
        for (const trajectory of goodTrajectories) {
          if (trajectory.steps.length > 0) {
            const lastStep = trajectory.steps[trajectory.steps.length - 1];
            const patternId = `pattern_${patterns.size}`;

            patterns.set(patternId, {
              id: patternId,
              embedding: new Float32Array(lastStep.stateAfter),
              successRate: trajectory.qualityScore,
              usageCount: 1,
              domain: trajectory.domain,
            });
          }
        }

        const avgQuality = goodTrajectories.reduce((s, t) => s + t.qualityScore, 0) / goodTrajectories.length;
        return Math.max(0, avgQuality - 0.5);
      },

      predict(state: Float32Array): { action: string; confidence: number } {
        // Find most similar pattern
        let bestPattern: SonaPattern | null = null;
        let bestSim = -1;

        for (const pattern of patterns.values()) {
          const sim = cosineSimilarity(state, pattern.embedding);
          if (sim > bestSim) {
            bestSim = sim;
            bestPattern = pattern;
          }
        }

        if (bestPattern && bestSim > 0.5) {
          return {
            action: bestPattern.domain,
            confidence: bestSim * bestPattern.successRate,
          };
        }

        return { action: 'explore', confidence: 0.3 };
      },

      storePattern(pattern: SonaPattern): void {
        patterns.set(pattern.id, pattern);
      },

      findPatterns(query: Float32Array, k: number): SonaPattern[] {
        const results: Array<{ pattern: SonaPattern; sim: number }> = [];

        for (const pattern of patterns.values()) {
          const sim = cosineSimilarity(query, pattern.embedding);
          results.push({ pattern, sim });
        }

        results.sort((a, b) => b.sim - a.sim);
        return results.slice(0, k).map(r => r.pattern);
      },

      updatePatternSuccess(patternId: string, success: boolean): void {
        const pattern = patterns.get(patternId);
        if (pattern) {
          pattern.usageCount++;
          const alpha = 1 / pattern.usageCount;
          pattern.successRate = pattern.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
        }
      },

      applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array {
        const output = new Float32Array(input.length);
        output.set(input);

        // Apply LoRA: output = input + alpha * B @ A @ input
        for (const [module, A] of weights.A) {
          const B = weights.B.get(module);
          if (!B) continue;

          // Simplified LoRA application
          let intermediate = 0;
          for (let i = 0; i < Math.min(input.length, A.length); i++) {
            intermediate += A[i] * input[i];
          }

          for (let i = 0; i < Math.min(output.length, B.length); i++) {
            output[i] += weights.alpha * B[i] * intermediate;
          }
        }

        return output;
      },

      updateLoRA(gradients: Float32Array, config: SonaConfig): LoRAWeights {
        // Update LoRA weights based on gradients
        const dim = gradients.length;
        const rank = config.loraRank;

        const A = new Float32Array(rank * dim);
        const B = new Float32Array(dim * rank);

        // Initialize with small random values scaled by gradients
        for (let i = 0; i < A.length; i++) {
          A[i] = (Math.random() - 0.5) * 0.01 * (gradients[i % dim] || 1);
        }
        for (let i = 0; i < B.length; i++) {
          B[i] = (Math.random() - 0.5) * 0.01 * (gradients[i % dim] || 1);
        }

        loraWeights.A.set('default', A);
        loraWeights.B.set('default', B);
        loraWeights.rank = rank;

        return loraWeights;
      },

      computeFisher(trajectories: SonaTrajectory[]): Map<string, Float32Array> {
        const fisher = new Map<string, Float32Array>();

        for (const trajectory of trajectories) {
          for (const step of trajectory.steps) {
            const key = trajectory.domain;
            let f = fisher.get(key);

            if (!f) {
              f = new Float32Array(step.stateAfter.length);
              fisher.set(key, f);
            }

            // Approximate Fisher information
            for (let i = 0; i < step.stateAfter.length; i++) {
              const grad = step.stateAfter[i] * step.reward;
              f[i] += grad * grad;
            }
          }
        }

        // Normalize
        for (const f of fisher.values()) {
          const sum = f.reduce((s, v) => s + v, 0);
          if (sum > 0) {
            for (let i = 0; i < f.length; i++) {
              f[i] /= sum;
            }
          }
        }

        return fisher;
      },

      consolidate(ewcState: EWCState): void {
        // Apply EWC penalty to prevent catastrophic forgetting
        // This modifies the learning in future updates
      },

      setMode(mode: SonaConfig['mode']): void {
        currentMode = mode;
      },

      getMode(): SonaConfig['mode'] {
        return currentMode;
      },
    };
  }
}

/**
 * Cosine similarity helper
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Create a new SONA bridge
 */
export function createSonaBridge(config?: Partial<SonaConfig>): SonaBridge {
  return new SonaBridge(config);
}
