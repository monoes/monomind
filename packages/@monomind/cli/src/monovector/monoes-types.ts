/**
 * Minimal typed interfaces for @monoes/* packages.
 * Replace `any` at the single import boundary; downstream code stays typed.
 *
 * Always supply the type parameter explicitly when calling tryLoad<T>() from
 * pkg-loader.ts — the default Record<string, unknown> is intentionally broad.
 */

// ── @monoes/attention ────────────────────────────────────────────────────────

export interface AttentionInstanceAPI {
  computeRaw(query: Float32Array, keys: Float32Array[]): Float32Array;
  free(): void;
}

export interface AttentionModule {
  DotProductAttention: { new (dim: number): AttentionInstanceAPI };
  FlashAttention: { new (dim: number, blockSize: number): AttentionInstanceAPI };
  MultiHeadAttention: { new (dim: number, heads: number): AttentionInstanceAPI };
  HyperbolicAttention: { new (dim: number): AttentionInstanceAPI };
  LinearAttention: { new (dim: number): AttentionInstanceAPI };
}

// ── @monoes/learning-wasm ────────────────────────────────────────────────────

export interface WasmMicroLoRAAPI {
  adapt_array(gradient: Float32Array): void;
  get_weights(): Float32Array;
  free(): void;
}

export interface WasmScopedLoRAAPI {
  adapt(gradient: Float32Array): void;
  free(): void;
}

export interface WasmTrajectoryBufferAPI {
  push(v: Float32Array): void;
  flush(): Float32Array[];
  free(): void;
}

export interface LearningWasmModule {
  WasmMicroLoRA: { new (dim: number, alpha: number, lr: number): WasmMicroLoRAAPI };
  WasmScopedLoRA: { new (dim: number): WasmScopedLoRAAPI };
  WasmTrajectoryBuffer: { new (capacity: number): WasmTrajectoryBufferAPI };
  initSync(opts: { module: ArrayBuffer | ArrayBufferView }): void;
}

// ── @monoes/router ───────────────────────────────────────────────────────────

export interface RouterVectorDbAPI {
  insert(id: string, vector: Float32Array): string;
  search(queryVector: Float32Array, k: number): Array<{ id: string; score: number }>;
  delete(id: string): boolean;
}

export interface RouterModule {
  VectorDb: {
    new (opts: {
      dimensions: number;
      distanceMetric: number;
      hnswM?: number;
      hnswEfConstruction?: number;
      hnswEfSearch?: number;
    }): RouterVectorDbAPI;
  };
  DistanceMetric: { Cosine: number; Euclidean: number; DotProduct: number };
}
