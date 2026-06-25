/**
 * Embedding Operations
 * ONNX model loading, embedding generation, and hash-based fallback.
 * Extracted from memory-initializer.ts (ARCH-4)
 *
 * @module v1/cli/embedding-operations
 */
// ADR-053: Lazy import of memory bridge
let _bridge;
async function getBridge() {
    if (_bridge === null)
        return null;
    if (_bridge)
        return _bridge;
    try {
        _bridge = await import('./memory-bridge.js');
        return _bridge;
    }
    catch {
        _bridge = null;
        return null;
    }
}
let embeddingModelState = null;
/**
 * Lazy load ONNX embedding model
 * Only loads when first embedding is requested
 */
export async function loadEmbeddingModel(options) {
    const { verbose = false } = options || {};
    const startTime = Date.now();
    // Already loaded
    if (embeddingModelState?.loaded) {
        return {
            success: true,
            dimensions: embeddingModelState.dimensions,
            modelName: 'cached',
            loadTime: 0
        };
    }
    // ADR-053: Try LanceDB bridge first
    const bridge = await getBridge();
    if (bridge) {
        const bridgeResult = await bridge.bridgeLoadEmbeddingModel();
        if (bridgeResult && bridgeResult.success) {
            // Mark local state as loaded too so subsequent calls use cache
            embeddingModelState = {
                loaded: true,
                model: null, // Bridge handles embedding
                tokenizer: null,
                dimensions: bridgeResult.dimensions
            };
            return bridgeResult;
        }
    }
    try {
        // Try to import @xenova/transformers for ONNX embeddings
        const transformers = await import('@xenova/transformers').catch(() => null);
        if (transformers) {
            if (verbose) {
                console.log('Loading ONNX embedding model (all-MiniLM-L6-v2)...');
            }
            // Use small, fast model for local embeddings
            const { pipeline } = transformers;
            const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            embeddingModelState = {
                loaded: true,
                model: embedder,
                tokenizer: null,
                dimensions: 384 // MiniLM-L6 produces 384-dim vectors
            };
            return {
                success: true,
                dimensions: 384,
                modelName: 'Xenova/all-MiniLM-L6-v2',
                loadTime: Date.now() - startTime
            };
        }
        // Fallback: Check for agentic-flow ReasoningBank embeddings (v1)
        const reasoningBank = await import('agentic-flow/reasoningbank').catch(() => null);
        if (reasoningBank?.computeEmbedding) {
            if (verbose) {
                console.log('Loading agentic-flow ReasoningBank embedding model...');
            }
            embeddingModelState = {
                loaded: true,
                model: { embed: reasoningBank.computeEmbedding },
                tokenizer: null,
                dimensions: 768
            };
            return {
                success: true,
                dimensions: 768,
                modelName: 'agentic-flow/reasoningbank',
                loadTime: Date.now() - startTime
            };
        }
        // Fallback: Check for monovector ONNX embedder (bundled MiniLM-L6-v2 since v0.2.15)
        // v0.2.16: LoRA B=0 fix makes AdaptiveEmbedder safe (identity when untrained)
        // Note: isReady() returns false until first embed() call (lazy init), so we
        // skip the isReady() gate and verify with a probe embed instead.
        const monovector = await import('monovector').catch(() => null);
        if (monovector?.initOnnxEmbedder) {
            try {
                await monovector.initOnnxEmbedder();
                // Fallback: OptimizedOnnxEmbedder (raw ONNX, lazy-inits on first embed)
                const onnxEmb = monovector.getOptimizedOnnxEmbedder?.();
                if (onnxEmb?.embed) {
                    // Probe embed to trigger lazy ONNX init and verify it works
                    const probe = await onnxEmb.embed('test');
                    if (probe && probe.length > 0 && (Array.isArray(probe) ? probe.some((v) => v !== 0) : true)) {
                        if (verbose) {
                            console.log(`Loading monovector ONNX embedder (all-MiniLM-L6-v2, ${probe.length}d)...`);
                        }
                        embeddingModelState = {
                            loaded: true,
                            model: (text) => onnxEmb.embed(text),
                            tokenizer: null,
                            dimensions: probe.length || 384
                        };
                        return {
                            success: true,
                            dimensions: probe.length || 384,
                            modelName: 'monovector/onnx',
                            loadTime: Date.now() - startTime
                        };
                    }
                }
            }
            catch {
                // monovector ONNX init failed, continue to next fallback
            }
        }
        // Legacy fallback: Check for agentic-flow core embeddings
        const agenticFlow = await import('agentic-flow').catch(() => null);
        if (agenticFlow && agenticFlow.embeddings) {
            if (verbose) {
                console.log('Loading agentic-flow embedding model...');
            }
            embeddingModelState = {
                loaded: true,
                model: agenticFlow.embeddings,
                tokenizer: null,
                dimensions: 768
            };
            return {
                success: true,
                dimensions: 768,
                modelName: 'agentic-flow',
                loadTime: Date.now() - startTime
            };
        }
        // No ONNX model available - use fallback
        embeddingModelState = {
            loaded: true,
            model: null, // Will use simple hash-based fallback
            tokenizer: null,
            dimensions: 128 // Smaller fallback dimensions
        };
        return {
            success: true,
            dimensions: 128,
            modelName: 'hash-fallback',
            loadTime: Date.now() - startTime
        };
    }
    catch (error) {
        return {
            success: false,
            dimensions: 0,
            modelName: 'none',
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
/**
 * Generate real embedding for text
 * Uses ONNX model if available, falls back to deterministic hash
 */
export async function generateEmbedding(text) {
    // Cap input text — caller may pass arbitrarily large content. Without this
    // cap, the hash-fallback below burns O(text.length × dimension) sin() calls
    // per call, and ONNX tokenization can saturate memory on multi-MB inputs.
    if (typeof text !== 'string')
        text = String(text ?? '');
    if (text.length > 16 * 1024)
        text = text.slice(0, 16 * 1024);
    // ADR-053: Try LanceDB bridge first
    const bridge = await getBridge();
    if (bridge) {
        const bridgeResult = await bridge.bridgeGenerateEmbedding(text);
        if (bridgeResult)
            return bridgeResult;
    }
    // Ensure model is loaded
    if (!embeddingModelState?.loaded) {
        await loadEmbeddingModel();
    }
    const state = embeddingModelState;
    // Use ONNX model if available
    if (state.model && typeof state.model === 'function') {
        try {
            const output = await state.model(text, { pooling: 'mean', normalize: true });
            // Handle both @xenova/transformers (output.data) and monovector (plain array) formats
            const embedding = output?.data
                ? Array.from(output.data)
                : Array.isArray(output) ? output : null;
            if (embedding) {
                return {
                    embedding,
                    dimensions: embedding.length,
                    model: 'onnx'
                };
            }
        }
        catch {
            // Fall through to fallback
        }
    }
    // Deterministic hash-based fallback (for testing/demo without ONNX)
    const embedding = generateHashEmbedding(text, state.dimensions);
    return {
        embedding,
        dimensions: state.dimensions,
        model: 'hash-fallback'
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
export async function generateBatchEmbeddings(texts, options) {
    const { concurrency = texts.length, onProgress } = options || {};
    const startTime = Date.now();
    // Ensure model is loaded first (prevents cold start in parallel)
    if (!embeddingModelState?.loaded) {
        await loadEmbeddingModel();
    }
    // Process in parallel with optional concurrency limit
    if (concurrency >= texts.length) {
        // Full parallelism
        const embeddings = await Promise.all(texts.map(async (text, i) => {
            const result = await generateEmbedding(text);
            onProgress?.(i + 1, texts.length);
            return { text, ...result };
        }));
        const totalTime = Date.now() - startTime;
        return {
            results: embeddings,
            totalTime,
            avgTime: totalTime / texts.length
        };
    }
    // Limited concurrency using chunking
    const results = [];
    let completed = 0;
    for (let i = 0; i < texts.length; i += concurrency) {
        const chunk = texts.slice(i, i + concurrency);
        const chunkResults = await Promise.all(chunk.map(async (text) => {
            const result = await generateEmbedding(text);
            completed++;
            onProgress?.(completed, texts.length);
            return { text, ...result };
        }));
        results.push(...chunkResults);
    }
    const totalTime = Date.now() - startTime;
    return {
        results,
        totalTime,
        avgTime: totalTime / texts.length
    };
}
/**
 * Generate deterministic hash-based embedding
 * Not semantic, but deterministic and useful for testing
 */
export function generateHashEmbedding(text, dimensions) {
    const embedding = new Array(dimensions).fill(0);
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
    return embedding.map(v => v / magnitude);
}
//# sourceMappingURL=embedding-operations.js.map