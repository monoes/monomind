/**
 * HNSW Bridge
 *
 * Bridge to micro-hnsw-wasm for ultra-fast vector similarity search.
 * Achieves 150x-12,500x faster search compared to brute-force.
 */

import type { HnswConfig, SearchResult } from '../types.js';
import { HnswConfigSchema } from '../types.js';
import { BaseBridge } from './base-bridge.js';

/**
 * HNSW WASM module interface
 */
interface HnswModule {
  create(config: HnswConfig): HnswIndex;
}

/**
 * HNSW index interface
 */
interface HnswIndex {
  add(id: string, vector: Float32Array, metadata?: Record<string, unknown>): void;
  search(query: Float32Array, k: number): SearchResult[];
  remove(id: string): boolean;
  size(): number;
  save(): Uint8Array;
  load(data: Uint8Array): void;
}

/**
 * HNSW Bridge implementation
 */
export class HnswBridge extends BaseBridge<HnswModule> {
  readonly name = 'micro-hnsw-wasm';
  readonly version = '0.1.0';

  private _index: HnswIndex | null = null;
  private config: HnswConfig;

  constructor(config?: Partial<HnswConfig>) {
    super();
    this.config = HnswConfigSchema.parse(config ?? {});
  }

  protected specifier(): string {
    return '@monoes/micro-hnsw-wasm';
  }

  protected validateShape(mod: unknown): boolean {
    return typeof (mod as any)?.create === 'function';
  }

  protected createMock(): HnswModule {
    return this.createMockModule();
  }

  /**
   * Build the index from whichever module was adopted (real or mock).
   * BaseBridge sets this._module before calling adoptModule in both branches,
   * so the index is always created from the active module.
   */
  protected adoptModule(_mod: unknown): void {
    this._index = this._module ? this._module.create(this.config) : null;
  }

  async destroy(): Promise<void> {
    this._index = null;
    await super.destroy();
  }

  /**
   * Get the HNSW index
   */
  getIndex(): HnswIndex | null {
    return this._index;
  }

  /**
   * Add a vector to the index
   */
  add(id: string, vector: Float32Array, metadata?: Record<string, unknown>): void {
    if (!this._index) throw new Error('HNSW index not initialized');
    this._index.add(id, vector, metadata);
  }

  /**
   * Search for similar vectors
   */
  search(query: Float32Array, k: number): SearchResult[] {
    if (!this._index) throw new Error('HNSW index not initialized');
    return this._index.search(query, k);
  }

  /**
   * Remove a vector from the index
   */
  remove(id: string): boolean {
    if (!this._index) throw new Error('HNSW index not initialized');
    return this._index.remove(id);
  }

  /**
   * Get index size
   */
  size(): number {
    return this._index?.size() ?? 0;
  }

  /**
   * Create mock module for development
   */
  private createMockModule(): HnswModule {
    return {
      create: (config: HnswConfig) => {
        const vectors = new Map<string, { vector: Float32Array; metadata?: Record<string, unknown> }>();

        return {
          add(id: string, vector: Float32Array, metadata?: Record<string, unknown>) {
            vectors.set(id, { vector: new Float32Array(vector), metadata });
          },

          /**
           * Mock search returns cosine DISTANCE (0 = identical, 2 = opposite) to match
           * the real @monoes/micro-hnsw-wasm metric. Consumers (hooks-tools.ts:1102) apply
           * `1 - score` to convert distance → similarity, so this mock must produce distance.
           */
          search(query: Float32Array, k: number): SearchResult[] {
            const results: SearchResult[] = [];

            for (const [id, { vector, metadata }] of vectors) {
              // Convert similarity [-1,1] to cosine distance [0,2]: distance = 1 - similarity
              const distance = 1 - cosineSimilarity(query, vector);
              results.push({ id, score: distance, vector, metadata });
            }

            // Sort ascending — lower distance = better match (consistent with real WASM)
            results.sort((a, b) => a.score - b.score);
            return results.slice(0, k);
          },

          remove(id: string): boolean {
            return vectors.delete(id);
          },

          size(): number {
            return vectors.size;
          },

          save(): Uint8Array {
            return new Uint8Array(0);
          },

          load(_data: Uint8Array): void {
            // No-op for mock
          },
        };
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
 * Create a new HNSW bridge
 */
export function createHnswBridge(config?: Partial<HnswConfig>): HnswBridge {
  return new HnswBridge(config);
}
