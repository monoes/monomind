/**
 * Flash Attention Bridge
 *
 * Bridge to monovector-attention-wasm for efficient attention computation.
 * Achieves 2.49x-7.47x speedup over standard attention.
 */

import type { AttentionConfig } from '../types.js';
import { AttentionConfigSchema } from '../types.js';
import { BaseBridge } from './base-bridge.js';

/**
 * Attention WASM module interface
 */
interface AttentionModule {
  flashAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config: AttentionConfig
  ): Float32Array;

  multiHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config: AttentionConfig
  ): Float32Array;

  selfAttention(
    input: Float32Array,
    config: AttentionConfig
  ): Float32Array;
}

/**
 * Flash Attention Bridge implementation
 */
export class AttentionBridge extends BaseBridge<AttentionModule> {
  readonly name = 'monoes-attention';
  readonly version = '0.1.0';

  private config: AttentionConfig;

  constructor(config?: Partial<AttentionConfig>) {
    super();
    this.config = AttentionConfigSchema.parse(config ?? {});
  }

  protected specifier(): string {
    return '@monoes/attention';
  }

  protected validateShape(mod: unknown): boolean {
    return typeof (mod as any)?.FlashAttention === 'function';
  }

  protected createMock(): AttentionModule {
    return this.createMockModule();
  }

  /**
   * Compute flash attention
   */
  flashAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config?: Partial<AttentionConfig>
  ): Float32Array {
    if (!this._module) throw new Error('Attention module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.flashAttention(query, key, value, mergedConfig);
  }

  /**
   * Compute multi-head attention
   */
  multiHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config?: Partial<AttentionConfig>
  ): Float32Array {
    if (!this._module) throw new Error('Attention module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.multiHeadAttention(query, key, value, mergedConfig);
  }

  /**
   * Compute self-attention
   */
  selfAttention(
    input: Float32Array,
    config?: Partial<AttentionConfig>
  ): Float32Array {
    if (!this._module) throw new Error('Attention module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.selfAttention(input, mergedConfig);
  }

  /**
   * Create mock module for development
   */
  private createMockModule(): AttentionModule {
    return {
      flashAttention(
        query: Float32Array,
        key: Float32Array,
        value: Float32Array,
        config: AttentionConfig
      ): Float32Array {
        // Simplified mock attention
        const seqLen = config.seqLength;
        const headDim = config.headDim;
        const output = new Float32Array(seqLen * headDim);

        // Scaled dot-product attention approximation
        for (let i = 0; i < seqLen; i++) {
          for (let j = 0; j < headDim; j++) {
            let sum = 0;
            for (let k = 0; k < seqLen; k++) {
              const qk = query[i * headDim + j] * key[k * headDim + j];
              const attn = Math.exp(qk / Math.sqrt(headDim));
              sum += attn * value[k * headDim + j];
            }
            output[i * headDim + j] = sum;
          }
        }

        return output;
      },

      multiHeadAttention(
        query: Float32Array,
        key: Float32Array,
        value: Float32Array,
        config: AttentionConfig
      ): Float32Array {
        return this.flashAttention(query, key, value, config);
      },

      selfAttention(
        input: Float32Array,
        config: AttentionConfig
      ): Float32Array {
        return this.flashAttention(input, input, input, config);
      },
    };
  }
}

/**
 * Create a new attention bridge
 */
export function createAttentionBridge(config?: Partial<AttentionConfig>): AttentionBridge {
  return new AttentionBridge(config);
}
