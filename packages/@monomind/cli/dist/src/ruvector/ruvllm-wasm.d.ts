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
 * @module @monoes/cli/ruvector/ruvllm-wasm
 */
export interface HnswRouterConfig {
    dimensions: number;
    maxPatterns: number;
    efSearch?: number;
}
export interface HnswPattern {
    name: string;
    embedding: Float32Array;
    metadata?: Record<string, unknown>;
}
export interface HnswRouteResult {
    name: string;
    score: number;
    metadata?: Record<string, unknown>;
}
export interface SonaConfig {
    hiddenDim?: number;
    learningRate?: number;
    emaDecay?: number;
    ewcLambda?: number;
    microLoraRank?: number;
    patternCapacity?: number;
}
export interface MicroLoraConfig {
    inputDim: number;
    outputDim: number;
    rank?: number;
    alpha?: number;
}
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface GenerateOptions {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    repetitionPenalty?: number;
    stopSequences?: string[];
}
export interface RuvllmStatus {
    available: boolean;
    initialized: boolean;
    version: string | null;
}
/**
 * Check if @ruvector/ruvllm-wasm is installed and loadable.
 */
export declare function isRuvllmWasmAvailable(): Promise<boolean>;
/**
 * Initialize the WASM module for Node.js. Safe to call multiple times.
 * Uses initSync with object form: { module: bytes } (raw bytes deprecated).
 */
export declare function initRuvllmWasm(): Promise<void>;
/**
 * Get ruvllm-wasm status.
 */
export declare function getRuvllmStatus(): Promise<RuvllmStatus>;
/**
 * Maximum safe pattern count for HNSW router.
 * v2.0.2 supports 1000+ patterns (fixed connect_node ordering).
 */
export declare const HNSW_MAX_SAFE_PATTERNS = 1024;
/**
 * Create a WASM HNSW router for semantic routing.
 * Returns an object with add/route/clear methods.
 *
 * Enforces HNSW_MAX_SAFE_PATTERNS limit (1024 in v2.0.2).
 */
export declare function createHnswRouter(config: HnswRouterConfig): Promise<{
    addPattern: (pattern: HnswPattern) => boolean;
    route: (query: Float32Array, k?: number) => HnswRouteResult[];
    clear: () => void;
    patternCount: () => number;
    toJson: () => string;
}>;
/**
 * Create a SONA instant adaptation loop (<1ms adaptation).
 * v2.0.1: requires SonaConfigWasm object, not raw number.
 */
export declare function createSonaInstant(config?: SonaConfig): Promise<{
    adapt: (quality: number) => void;
    recordPattern: (embedding: number[], success: boolean) => void;
    suggestAction: (context: string) => string | undefined;
    stats: () => string;
    reset: () => void;
    toJson: () => string;
}>;
/**
 * Create a MicroLoRA adapter (ultra-lightweight LoRA, ranks 1-4).
 * v2.0.2: .adapt(input, feedback) takes Float32Array + AdaptFeedbackWasm.
 */
export declare function createMicroLora(config: MicroLoraConfig): Promise<{
    apply: (input: Float32Array) => Float32Array;
    adapt: (quality: number, learningRate?: number, success?: boolean) => void;
    applyUpdates: (gradients: Float32Array) => void;
    stats: () => string;
    reset: () => void;
    toJson: () => string;
    pendingUpdates: () => number;
}>;
type TemplatePreset = 'llama3' | 'mistral' | 'chatml' | 'phi' | 'gemma';
/**
 * Format chat messages using a chat template.
 * Supports presets (llama3, mistral, chatml, phi, gemma) and auto-detection.
 */
export declare function formatChat(messages: ChatMessage[], template: TemplatePreset | {
    custom: string;
} | {
    modelId: string;
}): Promise<string>;
/**
 * Create a KV cache for token management.
 */
export declare function createKvCache(opts?: {
    tailLength?: number;
    maxTokens?: number;
    numKvHeads?: number;
    headDim?: number;
}): Promise<{
    append: (keys: Float32Array, values: Float32Array) => void;
    stats: () => string;
    clear: () => void;
    tokenCount: () => number;
}>;
/**
 * Create a generation config object.
 * Note: f32 precision loss is expected (0.7 → 0.699999...).
 */
export declare function createGenerateConfig(opts?: GenerateOptions): Promise<string>;
/**
 * Create a buffer pool for inference memory management.
 */
export declare function createBufferPool(capacity: number): Promise<{
    prewarm: (count: number) => void;
    stats: () => string;
    hitRate: () => number;
    clear: () => void;
}>;
/**
 * Create an inference arena for model memory allocation.
 */
export declare function createInferenceArena(opts: {
    capacity: number;
} | {
    hiddenDim: number;
    vocabSize: number;
    batchSize: number;
}): Promise<{
    reset: () => void;
    used: () => number;
    capacity: () => number;
    remaining: () => number;
}>;
export {};
//# sourceMappingURL=ruvllm-wasm.d.ts.map