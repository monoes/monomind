/**
 * Embedding Operations
 * ONNX model loading, embedding generation, and hash-based fallback.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/embedding-operations
 */

import { BRIDGE_EMBEDDING_DIMS, BRIDGE_EMBEDDING_MODEL } from './memory-bridge.js';

// ADR-053: Lazy import of memory bridge
let _bridge: typeof import('./memory-bridge.js') | null | undefined;
async function getBridge(): Promise<typeof import('./memory-bridge.js') | null> {
  if (_bridge === null) return null;
  if (_bridge) return _bridge;
  try {
    _bridge = await import('./memory-bridge.js');
    return _bridge;
  } catch {
    _bridge = null;
    return null;
  }
}

// ============================================================================
// ONNX Model Manager for lazy loading embeddings
// Avoids loading 100MB+ models unless actually needed
// ============================================================================

interface EmbeddingModel {
  loaded: boolean;
  model: unknown;
  tokenizer: unknown;
  dimensions: number;
}

let embeddingModelState: EmbeddingModel | null = null;

// P2-6: BGE-M3 opt-in model registry. When the user passes --embedder=bge-m3,
// load this model via transformers.js instead of the default. Lazy-fetched from
// HuggingFace CDN on first use (~600MB-2GB depending on variant); cached forever.
const EMBEDDER_REGISTRY: Record<
  string,
  { model: string; dimensions: number; description: string }
> = {
  'bge-m3': {
    model: 'Xenova/bge-m3',
    dimensions: 1024,
    description: 'BAAI/bge-m3 — 1024d, 8192-token context, 100+ languages, dense+sparse+ColBERT',
  },
  minilm: {
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    description: 'all-MiniLM-L6-v2 — 384d, lightweight default',
  },
};

// Currently active embedder override (set by --embedder flag on doc ingest)
let _embedderOverride: string | null = null;

/** P2-6: Set the embedder model override (e.g. 'bge-m3'). Call before loadEmbeddingModel. */
export function setEmbedderOverride(name: string | null): void {
  if (name && !EMBEDDER_REGISTRY[name]) {
    throw new Error(
      `Unknown embedder: ${name}. Available: ${Object.keys(EMBEDDER_REGISTRY).join(', ')}`,
    );
  }
  _embedderOverride = name;
  // Force reload on next use
  embeddingModelState = null;
}

/** P2-6: Get the currently configured embedder name (or null for default chain). */
export function getEmbedderOverride(): string | null {
  return _embedderOverride;
}

/**
 * Lazy load ONNX embedding model
 * Only loads when first embedding is requested
 */
export async function loadEmbeddingModel(options?: {
  modelPath?: string;
  verbose?: boolean;
}): Promise<{
  success: boolean;
  dimensions: number;
  modelName: string;
  loadTime?: number;
  error?: string;
}> {
  const { verbose = false } = options || {};
  const startTime = Date.now();

  // Already loaded
  if (embeddingModelState?.loaded) {
    return {
      success: true,
      dimensions: embeddingModelState.dimensions,
      modelName: 'cached',
      loadTime: 0,
    };
  }

  // ADR-053: Try SQLite-backed memory bridge first
  // P2-6: Skip bridge when an explicit embedder override is set — the user
  // chose a specific model; the bridge's own model would ignore that choice.
  if (!_embedderOverride) {
    const bridge = await getBridge();
    if (bridge) {
      const bridgeResult = await bridge.bridgeLoadEmbeddingModel();
      if (bridgeResult?.success) {
        embeddingModelState = {
          loaded: true,
          model: null,
          tokenizer: null,
          dimensions: bridgeResult.dimensions,
        };
        return bridgeResult;
      }
    }
  }

  // P2-6: Explicit embedder override (e.g. --embedder=bge-m3).
  // Lazy-fetches from HuggingFace CDN on first use; cached forever by transformers.js.
  if (_embedderOverride) {
    const config = EMBEDDER_REGISTRY[_embedderOverride];
    if (config) {
      try {
        const transformers = await import('@huggingface/transformers').catch(() => null);
        if (transformers) {
          if (verbose) {
            console.log(`Loading ${_embedderOverride} (${config.model}, ${config.dimensions}d)...`);
            console.log(`  ${config.description}`);
            console.log(
              `  First use will download the model from HuggingFace (~600MB+). Subsequent uses are cached.`,
            );
          }
          const { pipeline } = transformers;
          // Note: local_files_only is NOT set here — the model needs to be fetched
          // from HuggingFace on first use. Subsequent calls use the local cache.
          const embedder = await pipeline('feature-extraction', config.model);
          embeddingModelState = {
            loaded: true,
            model: embedder,
            tokenizer: null,
            dimensions: config.dimensions,
          };
          return {
            success: true,
            dimensions: config.dimensions,
            modelName: config.model,
            loadTime: Date.now() - startTime,
          };
        }
      } catch (err) {
        // Model download/init failed — fall through to default chain
        if (verbose) {
          console.log(
            `Failed to load ${_embedderOverride}: ${err instanceof Error ? err.message : String(err)}`,
          );
          console.log('Falling back to default embedder chain...');
        }
      }
    }
  }

  try {
    // MONOMIND_NO_LOCAL_EMBEDDINGS: see the matching guard in
    // memory-bridge.ts's loadEmbedder() — same native-crash rationale,
    // same env var, set automatically for org runs.
    const transformers =
      process.env.MONOMIND_NO_LOCAL_EMBEDDINGS === '1'
        ? null
        : // Try to import @huggingface/transformers for ONNX embeddings
          // (@huggingface/transformers is the maintained successor to @xenova/transformers,
          // same maintainers/API — this is the package actually declared as a dependency)
          await import('@huggingface/transformers').catch(() => null);

    if (transformers) {
      if (verbose) {
        console.log('Loading ONNX embedding model (gte-modernbert-base)...');
      }

      // Own try/catch: with local_files_only:true, pipeline() throws when the
      // model isn't cached locally (fresh installs, sandboxed/offline test
      // environments). That failure must fall through to the fallback chain
      // below, not bail out of the whole function via the outer catch — the
      // outer catch returns without ever setting embeddingModelState, which
      // left it null and crashed every generateEmbedding() caller with
      // "Cannot read properties of null (reading 'model')".
      try {
        const { pipeline } = transformers;
        const embedder = await pipeline('feature-extraction', BRIDGE_EMBEDDING_MODEL, {
          local_files_only: true,
        });

        embeddingModelState = {
          loaded: true,
          model: embedder,
          tokenizer: null,
          dimensions: BRIDGE_EMBEDDING_DIMS,
        };

        return {
          success: true,
          dimensions: BRIDGE_EMBEDDING_DIMS,
          modelName: BRIDGE_EMBEDDING_MODEL,
          loadTime: Date.now() - startTime,
        };
      } catch (err) {
        if (verbose) {
          console.log(
            `ONNX model not available locally (${err instanceof Error ? err.message : String(err)}) — falling back.`,
          );
        }
      }
    }

    // No ONNX model available - use fallback
    embeddingModelState = {
      loaded: true,
      model: null, // Will use simple hash-based fallback
      tokenizer: null,
      dimensions: 128, // Smaller fallback dimensions
    };

    return {
      success: true,
      dimensions: 128,
      modelName: 'hash-fallback',
      loadTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      dimensions: 0,
      modelName: 'none',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate real embedding for text
 * Uses ONNX model if available, falls back to deterministic hash
 */
export async function generateEmbedding(text: string): Promise<{
  embedding: number[];
  dimensions: number;
  model: string;
}> {
  // Cap input text — caller may pass arbitrarily large content. Without this
  // cap, the hash-fallback below burns O(text.length × dimension) sin() calls
  // per call, and ONNX tokenization can saturate memory on multi-MB inputs.
  if (typeof text !== 'string') text = String(text ?? '');
  if (text.length > 16 * 1024) text = text.slice(0, 16 * 1024);

  // ADR-053: Try SQLite-backed memory bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeGenerateEmbedding(text);
    if (bridgeResult) return bridgeResult;
  }

  // Ensure model is loaded
  if (!embeddingModelState?.loaded) {
    await loadEmbeddingModel();
  }

  // Defensive: loadEmbeddingModel() is expected to always set
  // embeddingModelState (even on failure, via the hash-fallback branch), but
  // don't crash the caller if some future code path breaks that contract —
  // fall straight to the hash-based embedding instead.
  const state = embeddingModelState;

  // Use ONNX model if available
  if (state?.model && typeof (state.model as any) === 'function') {
    try {
      const output = await (state.model as any)(text, { pooling: 'cls', normalize: true });
      // Handle both @xenova/transformers (output.data) and monovector (plain array) formats
      const embedding = output?.data
        ? Array.from(output.data as Float32Array)
        : Array.isArray(output)
          ? output
          : null;
      if (embedding) {
        return {
          embedding,
          dimensions: embedding.length,
          model: 'onnx',
        };
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Deterministic hash-based fallback (for testing/demo without ONNX)
  const dimensions = state?.dimensions ?? 128;
  const embedding = generateHashEmbedding(text, dimensions);
  return {
    embedding,
    dimensions,
    model: 'hash-fallback',
  };
}

/**
 * Generate embeddings for multiple texts
 * Uses parallel execution for API-based providers (2-4x faster)
 * Note: Local ONNX inference is CPU-bound, so parallelism has limited benefit
 *
 * @param texts - Array of texts to embed
 * @param options - Batch options
 * @returns Array of embedding results with timing info
 */
export async function generateBatchEmbeddings(
  texts: string[],
  options?: {
    concurrency?: number; // Max concurrent embeddings (default: all)
    onProgress?: (completed: number, total: number) => void;
  },
): Promise<{
  results: Array<{ text: string; embedding: number[]; dimensions: number; model: string }>;
  totalTime: number;
  avgTime: number;
}> {
  const { concurrency = texts.length, onProgress } = options || {};
  const startTime = Date.now();

  // Ensure model is loaded first (prevents cold start in parallel)
  if (!embeddingModelState?.loaded) {
    await loadEmbeddingModel();
  }

  // Process in parallel with optional concurrency limit
  if (concurrency >= texts.length) {
    // Full parallelism
    const embeddings = await Promise.all(
      texts.map(async (text, i) => {
        const result = await generateEmbedding(text);
        onProgress?.(i + 1, texts.length);
        return { text, ...result };
      }),
    );

    const totalTime = Date.now() - startTime;
    return {
      results: embeddings,
      totalTime,
      avgTime: totalTime / texts.length,
    };
  }

  // Limited concurrency using chunking
  const results: Array<{ text: string; embedding: number[]; dimensions: number; model: string }> =
    [];
  let completed = 0;

  for (let i = 0; i < texts.length; i += concurrency) {
    const chunk = texts.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (text) => {
        const result = await generateEmbedding(text);
        completed++;
        onProgress?.(completed, texts.length);
        return { text, ...result };
      }),
    );
    results.push(...chunkResults);
  }

  const totalTime = Date.now() - startTime;
  return {
    results,
    totalTime,
    avgTime: totalTime / texts.length,
  };
}

/**
 * Generate deterministic hash-based embedding
 * Not semantic, but deterministic and useful for testing
 */
export function generateHashEmbedding(text: string, dimensions: number): number[] {
  const embedding: number[] = new Array(dimensions).fill(0);

  // Simple hash-based approach for reproducibility
  const words = text.toLowerCase().split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < word.length; j++) {
      const charCode = word.charCodeAt(j);
      const idx = (charCode * (i + 1) * (j + 1)) % dimensions;
      embedding[idx] += Math.sin(charCode * 0.1) * 0.1;
    }
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
  return embedding.map((v) => v / magnitude);
}
