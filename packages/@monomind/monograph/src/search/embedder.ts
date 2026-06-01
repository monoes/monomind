/**
 * Lazy singleton for the HuggingFace FeatureExtractionPipeline.
 *
 * Uses dynamic import so that:
 *  1. Tests can mock `getEmbedder` without installing the package.
 *  2. @huggingface/transformers is optional at import time; callers receive a
 *     clear error if the package is unavailable.
 *
 * Model: Snowflake/snowflake-arctic-embed-xs (384 dimensions)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmbedderFn = (text: string | string[], options?: Record<string, unknown>) => Promise<any>;

let cachedEmbedder: EmbedderFn | null = null;

/**
 * Returns (and caches) a FeatureExtractionPipeline for
 * 'Snowflake/snowflake-arctic-embed-xs'.
 *
 * Throws a descriptive error if @huggingface/transformers is not installed.
 */
export async function getEmbedder(): Promise<EmbedderFn> {
  if (cachedEmbedder) return cachedEmbedder;

  let pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<EmbedderFn>;
  try {
    // Dynamic import so the dep is optional at bundle time
    const hf = await import('@huggingface/transformers');
    pipeline = hf.pipeline as typeof pipeline;
  } catch {
    throw new Error(
      '@huggingface/transformers is not installed. ' +
        'Run `npm install @huggingface/transformers` to enable embedding support.',
    );
  }

  cachedEmbedder = await pipeline('feature-extraction', 'Snowflake/snowflake-arctic-embed-xs', {
    dtype: 'fp32',
  });
  return cachedEmbedder;
}

/** Reset the cached singleton — used only in tests. */
export function resetEmbedderCache(): void {
  cachedEmbedder = null;
}

/**
 * Embed a single text string and return a 384-dim Float32Array.
 * Pooling: mean. Normalisation: L2 (so cosine ≡ dot product).
 */
export async function embedText(
  text: string,
  embedder: EmbedderFn,
): Promise<Float32Array> {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  // HuggingFace Tensor: output.data is Float32Array
  return output.data as Float32Array;
}
