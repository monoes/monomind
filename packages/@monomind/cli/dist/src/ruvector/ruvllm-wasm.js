/**
 * RuVector LLM WASM Integration
 *
 * Wraps @ruvector/ruvllm-wasm for browser-native LLM inference utilities.
 * Provides HNSW routing, SONA instant adaptation, MicroLoRA fine-tuning,
 * chat template formatting, KV cache management, and inference arena.
 *
 * Published API (v2.0.2): RuvLLMWasm, ChatTemplateWasm, ChatMessageWasm,
 * GenerateConfig, HnswRouterWasm, SonaInstantWasm, MicroLoraWasm,
 * KvCacheWasm, BufferPoolWasm, InferenceArenaWasm.
 *
 * v2.0.2 fixes:
 * - HNSW supports 1000+ patterns (fixed connect_node ordering)
 * - MicroLoRA adapt() now takes (input: Float32Array, feedback: AdaptFeedbackWasm)
 *
 * Remaining quirks:
 * - Stats objects return WASM pointers — use .toJson() or named accessors
 * - GenerateConfig float precision loss (f32 roundtrip)
 * - MicroLoRA apply() hardcoded to 768 dims regardless of config
 *
 * @module @monomind/cli/ruvector/ruvllm-wasm
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// ── WASM Module Detection & Init ─────────────────────────────
let _wasmReady = false;
/**
 * Check if @ruvector/ruvllm-wasm is installed and loadable.
 */
export async function isRuvllmWasmAvailable() {
    try {
        const mod = await import('@ruvector/ruvllm-wasm');
        return typeof mod.RuvLLMWasm === 'function';
    }
    catch {
        return false;
    }
}
/**
 * Initialize the WASM module for Node.js. Safe to call multiple times.
 * Uses initSync with object form: { module: bytes } (raw bytes deprecated).
 */
export async function initRuvllmWasm() {
    if (_wasmReady)
        return;
    try {
        const mod = await import('@ruvector/ruvllm-wasm');
        const require_ = createRequire(import.meta.url);
        const wasmPath = require_.resolve('@ruvector/ruvllm-wasm/ruvllm_wasm_bg.wasm');
        const wasmBytes = readFileSync(wasmPath);
        // MUST use object form — initSync(bytes) is deprecated
        mod.initSync({ module: wasmBytes });
        _wasmReady = true;
    }
    catch (err) {
        throw new Error(`Failed to initialize @ruvector/ruvllm-wasm: ${err}`);
    }
}
/**
 * Get ruvllm-wasm status.
 */
export async function getRuvllmStatus() {
    const available = await isRuvllmWasmAvailable();
    if (!available) {
        return { available: false, initialized: false, version: null };
    }
    try {
        const mod = await import('@ruvector/ruvllm-wasm');
        // version is a standalone function, not on RuvLLMWasm class
        const version = typeof mod.getVersion === 'function' ? mod.getVersion() : null;
        return { available: true, initialized: _wasmReady, version };
    }
    catch {
        return { available: true, initialized: _wasmReady, version: null };
    }
}
// ── HNSW Router ──────────────────────────────────────────────
/**
 * Maximum safe pattern count for HNSW router.
 * v2.0.2 supports 1000+ patterns (fixed connect_node ordering).
 */
export const HNSW_MAX_SAFE_PATTERNS = 1024;
/**
 * Create a WASM HNSW router for semantic routing.
 * Returns an object with add/route/clear methods.
 *
 * Enforces HNSW_MAX_SAFE_PATTERNS limit (1024 in v2.0.2).
 */
export async function createHnswRouter(config) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    const router = new mod.HnswRouterWasm(config.dimensions, config.maxPatterns);
    if (config.efSearch) {
        router.setEfSearch(config.efSearch);
    }
    let count = 0;
    return {
        addPattern(pattern) {
            if (count >= HNSW_MAX_SAFE_PATTERNS) {
                throw new Error(`HNSW pattern limit reached (${HNSW_MAX_SAFE_PATTERNS}).`);
            }
            const metadataJson = JSON.stringify(pattern.metadata ?? {});
            // addPattern requires 3 args: (embedding, name, metadata_json)
            const ok = router.addPattern(pattern.embedding, pattern.name, metadataJson);
            if (ok)
                count++;
            return ok;
        },
        route(query, k = 3) {
            return router.route(query, k);
        },
        clear() {
            router.clear();
            count = 0;
        },
        patternCount() {
            return count;
        },
        toJson() {
            return router.toJson();
        },
    };
}
// ── SONA Instant Adaptation ──────────────────────────────────
/**
 * Create a SONA instant adaptation loop (<1ms adaptation).
 * v2.0.1: requires SonaConfigWasm object, not raw number.
 */
export async function createSonaInstant(config = {}) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    const sonaConfig = new mod.SonaConfigWasm();
    if (config.hiddenDim !== undefined)
        sonaConfig.hiddenDim = config.hiddenDim;
    if (config.learningRate !== undefined)
        sonaConfig.learningRate = config.learningRate;
    if (config.emaDecay !== undefined)
        sonaConfig.emaDecay = config.emaDecay;
    if (config.ewcLambda !== undefined)
        sonaConfig.ewcLambda = config.ewcLambda;
    if (config.microLoraRank !== undefined)
        sonaConfig.microLoraRank = config.microLoraRank;
    if (config.patternCapacity !== undefined)
        sonaConfig.patternCapacity = config.patternCapacity;
    const sona = new mod.SonaInstantWasm(sonaConfig);
    return {
        adapt(quality) {
            sona.instantAdapt(quality);
        },
        recordPattern(embedding, success) {
            sona.recordPattern(new Float32Array(embedding), success);
        },
        suggestAction(context) {
            return sona.suggestAction(context);
        },
        stats() {
            return sona.toJson();
        },
        reset() {
            sona.reset();
        },
        toJson() {
            return sona.toJson();
        },
    };
}
// ── MicroLoRA ────────────────────────────────────────────────
/**
 * Create a MicroLoRA adapter (ultra-lightweight LoRA, ranks 1-4).
 * v2.0.2: .adapt(input, feedback) takes Float32Array + AdaptFeedbackWasm.
 */
export async function createMicroLora(config) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    const loraConfig = new mod.MicroLoraConfigWasm();
    loraConfig.inputDim = config.inputDim;
    loraConfig.outputDim = config.outputDim;
    loraConfig.rank = config.rank ?? 2;
    loraConfig.alpha = config.alpha ?? 1.0;
    const lora = new mod.MicroLoraWasm(loraConfig);
    return {
        apply(input) {
            return lora.apply(input);
        },
        adapt(quality, learningRate = 0.01, success = true) {
            // v2.0.2: adapt(input, feedback) — two args
            const feedback = new mod.AdaptFeedbackWasm();
            feedback.quality = quality;
            feedback.learningRate = learningRate;
            // Note: feedback.success not on prototype in v2.0.2, set via property
            try {
                feedback.success = success;
            }
            catch { /* v2.0.2 quirk */ }
            // Create a dummy input vector matching the configured inputDim
            const input = new Float32Array(config.inputDim);
            lora.adapt(input, feedback);
        },
        applyUpdates(gradients) {
            lora.applyUpdates(gradients);
        },
        stats() {
            return lora.toJson();
        },
        reset() {
            lora.reset();
        },
        toJson() {
            return lora.toJson();
        },
        pendingUpdates() {
            return lora.pendingUpdates();
        },
    };
}
/**
 * Format chat messages using a chat template.
 * Supports presets (llama3, mistral, chatml, phi, gemma) and auto-detection.
 */
export async function formatChat(messages, template) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    // Build template
    let tmpl;
    if (typeof template === 'string') {
        const presets = {
            llama3: () => mod.ChatTemplateWasm.llama3(),
            mistral: () => mod.ChatTemplateWasm.mistral(),
            chatml: () => mod.ChatTemplateWasm.chatml(),
            phi: () => mod.ChatTemplateWasm.phi(),
            gemma: () => mod.ChatTemplateWasm.gemma(),
        };
        const factory = presets[template];
        if (!factory)
            throw new Error(`Unknown template preset: ${template}. Use: ${Object.keys(presets).join(', ')}`);
        tmpl = factory();
    }
    else if ('custom' in template) {
        tmpl = mod.ChatTemplateWasm.custom(template.custom);
    }
    else if ('modelId' in template) {
        tmpl = mod.ChatTemplateWasm.detectFromModelId(template.modelId);
    }
    // Build messages
    const wasmMessages = messages.map(m => {
        switch (m.role) {
            case 'system': return mod.ChatMessageWasm.system(m.content);
            case 'user': return mod.ChatMessageWasm.user(m.content);
            case 'assistant': return mod.ChatMessageWasm.assistant(m.content);
            default: throw new Error(`Unknown role: ${m.role}`);
        }
    });
    return tmpl.format(wasmMessages);
}
// ── KV Cache ─────────────────────────────────────────────────
/**
 * Create a KV cache for token management.
 */
export async function createKvCache(opts) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    let cache;
    if (opts) {
        const config = new mod.KvCacheConfigWasm();
        if (opts.tailLength !== undefined)
            config.tailLength = opts.tailLength;
        if (opts.maxTokens !== undefined)
            config.maxTokens = opts.maxTokens;
        if (opts.numKvHeads !== undefined)
            config.numKvHeads = opts.numKvHeads;
        if (opts.headDim !== undefined)
            config.headDim = opts.headDim;
        cache = new mod.KvCacheWasm(config);
    }
    else {
        cache = mod.KvCacheWasm.withDefaults();
    }
    return {
        append(keys, values) {
            cache.append(keys, values);
        },
        stats() {
            // Use toJson if available, otherwise stringify
            try {
                return JSON.stringify(cache.stats());
            }
            catch {
                return '{}';
            }
        },
        clear() {
            cache.clear();
        },
        tokenCount() {
            return cache.tokenCount;
        },
    };
}
// ── Generate Config ──────────────────────────────────────────
/**
 * Create a generation config object.
 * Note: f32 precision loss is expected (0.7 → 0.699999...).
 */
export async function createGenerateConfig(opts = {}) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    const config = new mod.GenerateConfig();
    if (opts.maxTokens !== undefined)
        config.maxTokens = opts.maxTokens;
    if (opts.temperature !== undefined)
        config.temperature = opts.temperature;
    if (opts.topP !== undefined)
        config.topP = opts.topP;
    if (opts.topK !== undefined)
        config.topK = opts.topK;
    if (opts.repetitionPenalty !== undefined)
        config.repetitionPenalty = opts.repetitionPenalty;
    for (const seq of opts.stopSequences ?? []) {
        config.addStopSequence(seq);
    }
    return config.toJson();
}
// ── Buffer Pool ──────────────────────────────────────────────
/**
 * Create a buffer pool for inference memory management.
 */
export async function createBufferPool(capacity) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    const pool = mod.BufferPoolWasm.withCapacity(capacity);
    return {
        prewarm(count) {
            pool.prewarmAll(count);
        },
        stats() {
            return pool.statsJson();
        },
        hitRate() {
            return pool.hitRate;
        },
        clear() {
            pool.clear();
        },
    };
}
// ── Inference Arena ──────────────────────────────────────────
/**
 * Create an inference arena for model memory allocation.
 */
export async function createInferenceArena(opts) {
    await initRuvllmWasm();
    const mod = await import('@ruvector/ruvllm-wasm');
    const arena = 'capacity' in opts
        ? new mod.InferenceArenaWasm(opts.capacity)
        : mod.InferenceArenaWasm.forModel(opts.hiddenDim, opts.vocabSize, opts.batchSize);
    return {
        reset() { arena.reset(); },
        used() { return arena.used; },
        capacity() { return arena.capacity; },
        remaining() { return arena.remaining; },
    };
}
//# sourceMappingURL=ruvllm-wasm.js.map