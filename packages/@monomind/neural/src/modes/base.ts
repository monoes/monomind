/**
 * Base Mode Implementation
 *
 * Separated to avoid circular dependencies.
 */

import type {
  SONAModeConfig,
  ModeOptimizations,
  Trajectory,
  Pattern,
  PatternMatch,
  LoRAWeights,
  EWCState,
} from '../types.js';

// Minimal inline interface — avoids cross-package import
interface WasmMicroLoRAInstance {
  adapt_array(gradient: Float32Array): void;
  get_weights(): Float32Array;
  free(): void;
}
interface WasmMicroLoRAConstructor {
  new (dim: number, alpha: number, lr: number): WasmMicroLoRAInstance;
}

let _wasmLoRAClass: WasmMicroLoRAConstructor | null | undefined = undefined;

function getWasmLoRA(): WasmMicroLoRAConstructor | null {
  return _wasmLoRAClass ?? null;
}

// Fire-and-forget at module load — no await needed
void import('@monoes/learning-wasm').then(
  (mod: any) => { _wasmLoRAClass = typeof mod.WasmMicroLoRA === 'function' ? mod.WasmMicroLoRA : null; },
  () => { _wasmLoRAClass = null; }
);

/**
 * Common interface for all mode implementations
 */
export interface ModeImplementation {
  /** Mode identifier */
  readonly mode: string;

  /** Initialize the mode */
  initialize(): Promise<void>;

  /** Cleanup resources */
  cleanup(): Promise<void>;

  /** Find similar patterns (k-nearest) */
  findPatterns(
    embedding: Float32Array,
    k: number,
    patterns: Pattern[]
  ): Promise<PatternMatch[]>;

  /** Perform a learning step */
  learn(
    trajectories: Trajectory[],
    config: SONAModeConfig,
    ewcState: EWCState
  ): Promise<number>;

  /** Apply LoRA adaptations */
  applyLoRA(
    input: Float32Array,
    weights?: LoRAWeights
  ): Promise<Float32Array>;

  /** Get mode-specific stats */
  getStats(): Record<string, number>;
}

/**
 * Base class for mode implementations
 */
export abstract class BaseModeImplementation implements ModeImplementation {
  abstract readonly mode: string;

  protected config: SONAModeConfig;
  protected optimizations: ModeOptimizations;
  protected isInitialized = false;

  constructor(config: SONAModeConfig, optimizations: ModeOptimizations) {
    this.config = config;
    this.optimizations = optimizations;
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async cleanup(): Promise<void> {
    this.isInitialized = false;
  }

  /**
   * Compute cosine similarity between two vectors (SIMD-optimized)
   */
  protected cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    // Process 4 elements at a time for SIMD-like behavior
    const len = a.length;
    const simdLen = len - (len % 4);

    for (let i = 0; i < simdLen; i += 4) {
      dotProduct += a[i] * b[i] + a[i+1] * b[i+1] + a[i+2] * b[i+2] + a[i+3] * b[i+3];
      normA += a[i] * a[i] + a[i+1] * a[i+1] + a[i+2] * a[i+2] + a[i+3] * a[i+3];
      normB += b[i] * b[i] + b[i+1] * b[i+1] + b[i+2] * b[i+2] + b[i+3] * b[i+3];
    }

    // Handle remaining elements
    for (let i = simdLen; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }

  /**
   * Apply LoRA: output = input + BA * input (simplified).
   * Tries the WasmMicroLoRA path first (sync, no-await); falls back to pure-JS.
   */
  protected applyLoRATransform(
    input: Float32Array,
    A: Float32Array,
    B: Float32Array,
    rank: number
  ): Float32Array {
    const dim = input.length;

    // Try WASM path if module already loaded (sync check — no await)
    const WasmLoRA = getWasmLoRA();
    if (WasmLoRA) {
      try {
        // Step 1: A * input -> intermediate (rank dimensions)
        const intermediate = new Float32Array(rank);
        for (let r = 0; r < rank; r++) {
          let sum = 0;
          for (let d = 0; d < dim; d++) {
            sum += A[d * rank + r] * input[d];
          }
          intermediate[r] = sum;
        }

        const lora = new WasmLoRA(rank, 1.0, 0.0);
        try {
          lora.adapt_array(intermediate);
          const w = lora.get_weights();
          // Step 2: B * w -> delta, add to input
          const output = new Float32Array(dim);
          output.set(input);
          for (let d = 0; d < dim; d++) {
            let sum = 0;
            for (let r = 0; r < rank; r++) {
              sum += B[r * dim + d] * (w[r] ?? intermediate[r]);
            }
            output[d] += sum;
          }
          return output;
        } finally {
          lora.free();
        }
      } catch {
        // fall through to JS implementation
      }
    }

    // JS fallback
    const output = new Float32Array(dim);

    // Copy input to output
    output.set(input);

    // Compute A * input -> intermediate (rank dimensions)
    const intermediate = new Float32Array(rank);
    for (let r = 0; r < rank; r++) {
      let sum = 0;
      for (let d = 0; d < dim; d++) {
        sum += A[d * rank + r] * input[d];
      }
      intermediate[r] = sum;
    }

    // Compute B * intermediate -> delta (dim dimensions)
    for (let d = 0; d < dim; d++) {
      let sum = 0;
      for (let r = 0; r < rank; r++) {
        sum += B[r * dim + d] * intermediate[r];
      }
      output[d] += sum;
    }

    return output;
  }

  abstract findPatterns(
    embedding: Float32Array,
    k: number,
    patterns: Pattern[]
  ): Promise<PatternMatch[]>;

  abstract learn(
    trajectories: Trajectory[],
    config: SONAModeConfig,
    ewcState: EWCState
  ): Promise<number>;

  abstract applyLoRA(
    input: Float32Array,
    weights?: LoRAWeights
  ): Promise<Float32Array>;

  abstract getStats(): Record<string, number>;
}
