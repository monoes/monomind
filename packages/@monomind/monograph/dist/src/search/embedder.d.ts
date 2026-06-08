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
export type EmbedderFn = (text: string | string[], options?: Record<string, unknown>) => Promise<any>;
/**
 * Returns (and caches) a FeatureExtractionPipeline for
 * 'Snowflake/snowflake-arctic-embed-xs'.
 *
 * Throws a descriptive error if @huggingface/transformers is not installed.
 */
export declare function getEmbedder(): Promise<EmbedderFn>;
/** Reset the cached singleton — used only in tests. */
export declare function resetEmbedderCache(): void;
/**
 * Embed a single text string and return a 384-dim Float32Array.
 * Pooling: mean. Normalisation: L2 (so cosine ≡ dot product).
 */
export declare function embedText(text: string, embedder: EmbedderFn): Promise<Float32Array>;
//# sourceMappingURL=embedder.d.ts.map