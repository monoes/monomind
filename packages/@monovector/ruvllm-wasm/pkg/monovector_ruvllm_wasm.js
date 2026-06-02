/* @ts-self-types="./monovector_ruvllm_wasm.d.ts" */

/**
 * Feedback for per-request adaptation.
 *
 * Provides quality scores and optional gradient estimates to guide
 * LoRA weight updates.
 */
class AdaptFeedbackWasm {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AdaptFeedbackWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_adaptfeedbackwasm_free(ptr, 0);
    }
    /**
     * Get learning rate.
     * @returns {number}
     */
    get learningRate() {
        const ret = wasm.adaptfeedbackwasm_learningRate(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create new feedback with quality score [0.0, 1.0].
     * @param {number} quality
     */
    constructor(quality) {
        const ret = wasm.adaptfeedbackwasm_new(quality);
        this.__wbg_ptr = ret;
        AdaptFeedbackWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get quality score.
     * @returns {number}
     */
    get quality() {
        const ret = wasm.adaptfeedbackwasm_quality(this.__wbg_ptr);
        return ret;
    }
    /**
     * Set learning rate.
     * @param {number} value
     */
    set learningRate(value) {
        wasm.adaptfeedbackwasm_set_learningRate(this.__wbg_ptr, value);
    }
    /**
     * Set quality score (clamped to [0.0, 1.0]).
     * @param {number} value
     */
    set quality(value) {
        wasm.adaptfeedbackwasm_set_quality(this.__wbg_ptr, value);
    }
}
if (Symbol.dispose) AdaptFeedbackWasm.prototype[Symbol.dispose] = AdaptFeedbackWasm.prototype.free;
exports.AdaptFeedbackWasm = AdaptFeedbackWasm;

/**
 * Buffer pool for efficient memory reuse.
 */
class BufferPoolWasm {
    static __wrap(ptr) {
        const obj = Object.create(BufferPoolWasm.prototype);
        obj.__wbg_ptr = ptr;
        BufferPoolWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BufferPoolWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_bufferpoolwasm_free(ptr, 0);
    }
    /**
     * Clear all pooled buffers.
     */
    clear() {
        wasm.bufferpoolwasm_clear(this.__wbg_ptr);
    }
    /**
     * Get the hit rate (0.0 - 1.0).
     * @returns {number}
     */
    get hitRate() {
        const ret = wasm.bufferpoolwasm_hitRate(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create a new buffer pool with default settings.
     */
    constructor() {
        const ret = wasm.bufferpoolwasm_new();
        this.__wbg_ptr = ret;
        BufferPoolWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Pre-warm the pool by allocating buffers.
     * @param {number} count_per_class
     */
    prewarmAll(count_per_class) {
        wasm.bufferpoolwasm_prewarmAll(this.__wbg_ptr, count_per_class);
    }
    /**
     * Get pool statistics as JSON.
     * @returns {string}
     */
    statsJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.bufferpoolwasm_statsJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Create with specified max buffers per size class.
     * @param {number} max_buffers_per_class
     * @returns {BufferPoolWasm}
     */
    static withCapacity(max_buffers_per_class) {
        const ret = wasm.bufferpoolwasm_withCapacity(max_buffers_per_class);
        return BufferPoolWasm.__wrap(ret);
    }
}
if (Symbol.dispose) BufferPoolWasm.prototype[Symbol.dispose] = BufferPoolWasm.prototype.free;
exports.BufferPoolWasm = BufferPoolWasm;

/**
 * Chat message for instruction-tuned models.
 *
 * Used to construct conversations for chat-based inference.
 */
class ChatMessageWasm {
    static __wrap(ptr) {
        const obj = Object.create(ChatMessageWasm.prototype);
        obj.__wbg_ptr = ptr;
        ChatMessageWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof ChatMessageWasm)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ChatMessageWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_chatmessagewasm_free(ptr, 0);
    }
    /**
     * Create an assistant message.
     * @param {string} content
     * @returns {ChatMessageWasm}
     */
    static assistant(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chatmessagewasm_assistant(ptr0, len0);
        return ChatMessageWasm.__wrap(ret);
    }
    /**
     * Get the message content.
     * @returns {string}
     */
    get content() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chatmessagewasm_content(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get the role as a string.
     * @returns {string}
     */
    get role() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chatmessagewasm_role(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Create a system message.
     * @param {string} content
     * @returns {ChatMessageWasm}
     */
    static system(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chatmessagewasm_system(ptr0, len0);
        return ChatMessageWasm.__wrap(ret);
    }
    /**
     * Create a user message.
     * @param {string} content
     * @returns {ChatMessageWasm}
     */
    static user(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chatmessagewasm_user(ptr0, len0);
        return ChatMessageWasm.__wrap(ret);
    }
}
if (Symbol.dispose) ChatMessageWasm.prototype[Symbol.dispose] = ChatMessageWasm.prototype.free;
exports.ChatMessageWasm = ChatMessageWasm;

/**
 * Chat template for formatting conversations.
 */
class ChatTemplateWasm {
    static __wrap(ptr) {
        const obj = Object.create(ChatTemplateWasm.prototype);
        obj.__wbg_ptr = ptr;
        ChatTemplateWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ChatTemplateWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_chattemplatewasm_free(ptr, 0);
    }
    /**
     * Create a Qwen/ChatML chat template.
     * @returns {ChatTemplateWasm}
     */
    static chatml() {
        const ret = wasm.chattemplatewasm_chatml();
        return ChatTemplateWasm.__wrap(ret);
    }
    /**
     * Create a custom chat template.
     * @param {string} template
     * @returns {ChatTemplateWasm}
     */
    static custom(template) {
        const ptr0 = passStringToWasm0(template, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chattemplatewasm_custom(ptr0, len0);
        return ChatTemplateWasm.__wrap(ret);
    }
    /**
     * Detect template from model ID.
     * @param {string} model_id
     * @returns {ChatTemplateWasm}
     */
    static detectFromModelId(model_id) {
        const ptr0 = passStringToWasm0(model_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chattemplatewasm_detectFromModelId(ptr0, len0);
        return ChatTemplateWasm.__wrap(ret);
    }
    /**
     * Format messages using this template.
     * @param {ChatMessageWasm[]} messages
     * @returns {string}
     */
    format(messages) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArrayJsValueToWasm0(messages, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.chattemplatewasm_format(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Create a Gemma chat template.
     * @returns {ChatTemplateWasm}
     */
    static gemma() {
        const ret = wasm.chattemplatewasm_gemma();
        return ChatTemplateWasm.__wrap(ret);
    }
    /**
     * Create a Llama 3 chat template.
     * @returns {ChatTemplateWasm}
     */
    static llama3() {
        const ret = wasm.chattemplatewasm_llama3();
        return ChatTemplateWasm.__wrap(ret);
    }
    /**
     * Create a Mistral chat template.
     * @returns {ChatTemplateWasm}
     */
    static mistral() {
        const ret = wasm.chattemplatewasm_mistral();
        return ChatTemplateWasm.__wrap(ret);
    }
    /**
     * Get the template name.
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chattemplatewasm_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Create a Phi chat template.
     * @returns {ChatTemplateWasm}
     */
    static phi() {
        const ret = wasm.chattemplatewasm_phi();
        return ChatTemplateWasm.__wrap(ret);
    }
}
if (Symbol.dispose) ChatTemplateWasm.prototype[Symbol.dispose] = ChatTemplateWasm.prototype.free;
exports.ChatTemplateWasm = ChatTemplateWasm;

/**
 * Generation configuration for text generation.
 *
 * Controls sampling parameters and output constraints.
 * TypeScript-friendly with getter/setter methods.
 */
class GenerateConfig {
    static __wrap(ptr) {
        const obj = Object.create(GenerateConfig.prototype);
        obj.__wbg_ptr = ptr;
        GenerateConfigFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GenerateConfigFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_generateconfig_free(ptr, 0);
    }
    /**
     * Add a stop sequence.
     * @param {string} sequence
     */
    addStopSequence(sequence) {
        const ptr0 = passStringToWasm0(sequence, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.generateconfig_addStopSequence(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Clear all stop sequences.
     */
    clearStopSequences() {
        wasm.generateconfig_clearStopSequences(this.__wbg_ptr);
    }
    /**
     * Create from JSON string.
     * @param {string} json
     * @returns {GenerateConfig}
     */
    static fromJson(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.generateconfig_fromJson(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return GenerateConfig.__wrap(ret[0]);
    }
    /**
     * Get maximum tokens.
     * @returns {number}
     */
    get maxTokens() {
        const ret = wasm.generateconfig_maxTokens(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new GenerateConfig with default values.
     */
    constructor() {
        const ret = wasm.generateconfig_new();
        this.__wbg_ptr = ret;
        GenerateConfigFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get repetition penalty.
     * @returns {number}
     */
    get repetitionPenalty() {
        const ret = wasm.generateconfig_repetitionPenalty(this.__wbg_ptr);
        return ret;
    }
    /**
     * Set maximum tokens.
     * @param {number} value
     */
    set maxTokens(value) {
        wasm.generateconfig_set_maxTokens(this.__wbg_ptr, value);
    }
    /**
     * Set repetition penalty.
     * @param {number} value
     */
    set repetitionPenalty(value) {
        wasm.generateconfig_set_repetitionPenalty(this.__wbg_ptr, value);
    }
    /**
     * Set temperature.
     * @param {number} value
     */
    set temperature(value) {
        wasm.generateconfig_set_temperature(this.__wbg_ptr, value);
    }
    /**
     * Set top-k value.
     * @param {number} value
     */
    set topK(value) {
        wasm.generateconfig_set_topK(this.__wbg_ptr, value);
    }
    /**
     * Set top-p value.
     * @param {number} value
     */
    set topP(value) {
        wasm.generateconfig_set_topP(this.__wbg_ptr, value);
    }
    /**
     * Get temperature.
     * @returns {number}
     */
    get temperature() {
        const ret = wasm.generateconfig_temperature(this.__wbg_ptr);
        return ret;
    }
    /**
     * Convert to JSON string.
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.generateconfig_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get top-k value.
     * @returns {number}
     */
    get topK() {
        const ret = wasm.generateconfig_topK(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get top-p value.
     * @returns {number}
     */
    get topP() {
        const ret = wasm.generateconfig_topP(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) GenerateConfig.prototype[Symbol.dispose] = GenerateConfig.prototype.free;
exports.GenerateConfig = GenerateConfig;

/**
 * HNSW Semantic Router for browser-compatible pattern routing
 *
 * Provides approximate nearest neighbor search over pattern embeddings
 * using the HNSW (Hierarchical Navigable Small World) algorithm.
 *
 * ## Memory Efficiency
 *
 * The router enforces a maximum number of patterns to prevent unbounded
 * memory growth in browser environments. When the limit is reached, adding
 * new patterns will fail.
 *
 * ## Thread Safety
 *
 * This implementation is single-threaded and designed for use in browser
 * main thread or Web Workers.
 */
class HnswRouterWasm {
    static __wrap(ptr) {
        const obj = Object.create(HnswRouterWasm.prototype);
        obj.__wbg_ptr = ptr;
        HnswRouterWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HnswRouterWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_hnswrouterwasm_free(ptr, 0);
    }
    /**
     * Add a pattern to the router
     *
     * # Parameters
     *
     * - `embedding`: Float32Array of embedding values (must match dimensions)
     * - `name`: Pattern name/identifier
     * - `metadata`: JSON string with additional metadata
     *
     * # Returns
     *
     * `true` if pattern was added, `false` if max_patterns limit reached
     *
     * # Example
     *
     * ```javascript
     * const embedding = new Float32Array([0.1, 0.2, 0.3, ...]); // 384 dims
     * const success = router.addPattern(
     *   embedding,
     *   "rust-expert",
     *   JSON.stringify({ domain: "rust", expertise: "high" })
     * );
     * ```
     * @param {Float32Array} embedding
     * @param {string} name
     * @param {string} metadata
     * @returns {boolean}
     */
    addPattern(embedding, name, metadata) {
        const ptr0 = passArrayF32ToWasm0(embedding, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(metadata, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.hnswrouterwasm_addPattern(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        return ret !== 0;
    }
    /**
     * Clear all patterns from the router
     *
     * Resets the router to empty state.
     */
    clear() {
        wasm.hnswrouterwasm_clear(this.__wbg_ptr);
    }
    /**
     * Get embedding dimensions
     * @returns {number}
     */
    get dimensions() {
        const ret = wasm.hnswrouterwasm_dimensions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get current efSearch parameter
     * @returns {number}
     */
    get efSearch() {
        const ret = wasm.hnswrouterwasm_efSearch(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Deserialize a router from JSON string
     *
     * # Example
     *
     * ```javascript
     * const json = localStorage.getItem('router');
     * const router = HnswRouterWasm.fromJson(json);
     * ```
     * @param {string} json
     * @returns {HnswRouterWasm}
     */
    static fromJson(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hnswrouterwasm_fromJson(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return HnswRouterWasm.__wrap(ret[0]);
    }
    /**
     * Get pattern by index
     *
     * # Parameters
     *
     * - `index`: Pattern index (0 to patternCount - 1)
     *
     * # Returns
     *
     * PatternWasm or null if index out of bounds
     * @param {number} index
     * @returns {PatternWasm | undefined}
     */
    getPattern(index) {
        const ret = wasm.hnswrouterwasm_getPattern(this.__wbg_ptr, index);
        return ret === 0 ? undefined : PatternWasm.__wrap(ret);
    }
    /**
     * Get maximum patterns limit
     * @returns {number}
     */
    get maxPatterns() {
        const ret = wasm.hnswrouterwasm_maxPatterns(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new HNSW router
     *
     * # Parameters
     *
     * - `dimensions`: Size of embedding vectors (e.g., 384 for all-MiniLM-L6-v2)
     * - `max_patterns`: Maximum number of patterns to store (memory limit)
     *
     * # Example
     *
     * ```javascript
     * const router = HnswRouterWasm.new(384, 1000);
     * ```
     * @param {number} dimensions
     * @param {number} max_patterns
     */
    constructor(dimensions, max_patterns) {
        const ret = wasm.hnswrouterwasm_new(dimensions, max_patterns);
        this.__wbg_ptr = ret;
        HnswRouterWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get current number of patterns
     * @returns {number}
     */
    get patternCount() {
        const ret = wasm.hnswrouterwasm_patternCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Route a query to find similar patterns
     *
     * # Parameters
     *
     * - `query`: Float32Array of query embedding (must match dimensions)
     * - `top_k`: Number of top results to return
     *
     * # Returns
     *
     * Array of RouteResultWasm ordered by similarity (highest first)
     *
     * # Example
     *
     * ```javascript
     * const query = new Float32Array([0.15, 0.18, ...]); // 384 dims
     * const results = router.route(query, 5);
     * results.forEach(result => {
     *   console.log(`${result.name}: ${result.score}`);
     * });
     * ```
     * @param {Float32Array} query
     * @param {number} top_k
     * @returns {RouteResultWasm[]}
     */
    route(query, top_k) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hnswrouterwasm_route(this.__wbg_ptr, ptr0, len0, top_k);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Set efSearch parameter for query-time accuracy tuning
     *
     * Higher values = more accurate but slower search.
     * Recommended range: 10-200.
     *
     * # Parameters
     *
     * - `ef_search`: Number of neighbors to explore during search
     * @param {number} ef_search
     */
    setEfSearch(ef_search) {
        wasm.hnswrouterwasm_setEfSearch(this.__wbg_ptr, ef_search);
    }
    /**
     * Serialize the router to JSON string
     *
     * Useful for persisting to IndexedDB or localStorage.
     *
     * # Example
     *
     * ```javascript
     * const json = router.toJson();
     * localStorage.setItem('router', json);
     * ```
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.hnswrouterwasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) HnswRouterWasm.prototype[Symbol.dispose] = HnswRouterWasm.prototype.free;
exports.HnswRouterWasm = HnswRouterWasm;

/**
 * Arena allocator for inference buffers.
 *
 * Provides fast bump allocation with O(1) reset for
 * generation-step temporaries.
 */
class InferenceArenaWasm {
    static __wrap(ptr) {
        const obj = Object.create(InferenceArenaWasm.prototype);
        obj.__wbg_ptr = ptr;
        InferenceArenaWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InferenceArenaWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_inferencearenawasm_free(ptr, 0);
    }
    /**
     * Get total capacity.
     * @returns {number}
     */
    get capacity() {
        const ret = wasm.inferencearenawasm_capacity(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create an arena sized for model dimensions.
     * @param {number} hidden_dim
     * @param {number} vocab_size
     * @param {number} batch_size
     * @returns {InferenceArenaWasm}
     */
    static forModel(hidden_dim, vocab_size, batch_size) {
        const ret = wasm.inferencearenawasm_forModel(hidden_dim, vocab_size, batch_size);
        return InferenceArenaWasm.__wrap(ret);
    }
    /**
     * Get high water mark (maximum bytes ever used).
     * @returns {number}
     */
    get highWaterMark() {
        const ret = wasm.inferencearenawasm_highWaterMark(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new arena with the specified capacity in bytes.
     * @param {number} capacity
     */
    constructor(capacity) {
        const ret = wasm.inferencearenawasm_new(capacity);
        this.__wbg_ptr = ret;
        InferenceArenaWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get remaining available bytes.
     * @returns {number}
     */
    get remaining() {
        const ret = wasm.inferencearenawasm_remaining(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reset the arena, making all memory available for reuse.
     */
    reset() {
        wasm.inferencearenawasm_reset(this.__wbg_ptr);
    }
    /**
     * Get statistics as JSON.
     * @returns {string}
     */
    statsJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.inferencearenawasm_statsJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get current bytes used.
     * @returns {number}
     */
    get used() {
        const ret = wasm.inferencearenawasm_used(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) InferenceArenaWasm.prototype[Symbol.dispose] = InferenceArenaWasm.prototype.free;
exports.InferenceArenaWasm = InferenceArenaWasm;

/**
 * KV cache configuration for WASM.
 */
class KvCacheConfigWasm {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KvCacheConfigWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kvcacheconfigwasm_free(ptr, 0);
    }
    /**
     * Get head dimension.
     * @returns {number}
     */
    get headDim() {
        const ret = wasm.kvcacheconfigwasm_headDim(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get max tokens.
     * @returns {number}
     */
    get maxTokens() {
        const ret = wasm.kvcacheconfigwasm_maxTokens(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new KV cache configuration.
     */
    constructor() {
        const ret = wasm.kvcacheconfigwasm_new();
        this.__wbg_ptr = ret;
        KvCacheConfigWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get number of KV heads.
     * @returns {number}
     */
    get numKvHeads() {
        const ret = wasm.kvcacheconfigwasm_numKvHeads(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Set head dimension.
     * @param {number} value
     */
    set headDim(value) {
        wasm.kvcacheconfigwasm_set_headDim(this.__wbg_ptr, value);
    }
    /**
     * Set max tokens.
     * @param {number} value
     */
    set maxTokens(value) {
        wasm.kvcacheconfigwasm_set_maxTokens(this.__wbg_ptr, value);
    }
    /**
     * Set number of KV heads.
     * @param {number} value
     */
    set numKvHeads(value) {
        wasm.kvcacheconfigwasm_set_numKvHeads(this.__wbg_ptr, value);
    }
    /**
     * Set tail length.
     * @param {number} value
     */
    set tailLength(value) {
        wasm.kvcacheconfigwasm_set_tailLength(this.__wbg_ptr, value);
    }
    /**
     * Get tail length.
     * @returns {number}
     */
    get tailLength() {
        const ret = wasm.kvcacheconfigwasm_tailLength(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) KvCacheConfigWasm.prototype[Symbol.dispose] = KvCacheConfigWasm.prototype.free;
exports.KvCacheConfigWasm = KvCacheConfigWasm;

/**
 * KV cache statistics.
 */
class KvCacheStatsWasm {
    static __wrap(ptr) {
        const obj = Object.create(KvCacheStatsWasm.prototype);
        obj.__wbg_ptr = ptr;
        KvCacheStatsWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KvCacheStatsWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kvcachestatswasm_free(ptr, 0);
    }
    /**
     * Get compression ratio.
     * @returns {number}
     */
    get compressionRatio() {
        const ret = wasm.kvcachestatswasm_compressionRatio(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get store tokens.
     * @returns {number}
     */
    get storeTokens() {
        const ret = wasm.kvcachestatswasm_storeTokens(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get tail tokens.
     * @returns {number}
     */
    get tailTokens() {
        const ret = wasm.kvcachestatswasm_tailTokens(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Convert to JSON.
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.kvcachestatswasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get total tokens.
     * @returns {number}
     */
    get totalTokens() {
        const ret = wasm.kvcachestatswasm_totalTokens(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) KvCacheStatsWasm.prototype[Symbol.dispose] = KvCacheStatsWasm.prototype.free;
exports.KvCacheStatsWasm = KvCacheStatsWasm;

/**
 * Two-tier KV cache for WASM.
 *
 * Provides memory-efficient caching with a high-precision tail
 * and quantized store for older tokens.
 */
class KvCacheWasm {
    static __wrap(ptr) {
        const obj = Object.create(KvCacheWasm.prototype);
        obj.__wbg_ptr = ptr;
        KvCacheWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KvCacheWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kvcachewasm_free(ptr, 0);
    }
    /**
     * Append KV pairs to the cache.
     * @param {Float32Array} keys
     * @param {Float32Array} values
     */
    append(keys, values) {
        const ptr0 = passArrayF32ToWasm0(keys, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(values, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.kvcachewasm_append(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Clear the cache.
     */
    clear() {
        wasm.kvcachewasm_clear(this.__wbg_ptr);
    }
    /**
     * Get all cached KV pairs.
     * @returns {any}
     */
    getAllKv() {
        const ret = wasm.kvcachewasm_getAllKv(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Create a new KV cache with the given configuration.
     * @param {KvCacheConfigWasm} config
     */
    constructor(config) {
        _assertClass(config, KvCacheConfigWasm);
        const ret = wasm.kvcachewasm_new(config.__wbg_ptr);
        this.__wbg_ptr = ret;
        KvCacheWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get cache statistics.
     * @returns {KvCacheStatsWasm}
     */
    stats() {
        const ret = wasm.kvcachewasm_stats(this.__wbg_ptr);
        return KvCacheStatsWasm.__wrap(ret);
    }
    /**
     * Get the total number of cached tokens.
     * @returns {number}
     */
    get tokenCount() {
        const ret = wasm.kvcachewasm_tokenCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create with default configuration.
     * @returns {KvCacheWasm}
     */
    static withDefaults() {
        const ret = wasm.kvcachewasm_withDefaults();
        return KvCacheWasm.__wrap(ret);
    }
}
if (Symbol.dispose) KvCacheWasm.prototype[Symbol.dispose] = KvCacheWasm.prototype.free;
exports.KvCacheWasm = KvCacheWasm;

/**
 * Configuration for MicroLoRA adapter.
 *
 * Controls the rank, scaling, and dimensions of the LoRA adapter.
 * TypeScript-friendly with getter/setter methods.
 */
class MicroLoraConfigWasm {
    static __wrap(ptr) {
        const obj = Object.create(MicroLoraConfigWasm.prototype);
        obj.__wbg_ptr = ptr;
        MicroLoraConfigWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MicroLoraConfigWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_microloraconfigwasm_free(ptr, 0);
    }
    /**
     * Get alpha scaling factor.
     * @returns {number}
     */
    get alpha() {
        const ret = wasm.microloraconfigwasm_alpha(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get computed scaling factor (alpha / rank).
     * @returns {number}
     */
    computeScaling() {
        const ret = wasm.microloraconfigwasm_computeScaling(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get input feature dimension.
     * @returns {number}
     */
    get inFeatures() {
        const ret = wasm.microloraconfigwasm_inFeatures(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Calculate memory footprint in bytes.
     * @returns {number}
     */
    memoryBytes() {
        const ret = wasm.microloraconfigwasm_memoryBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new config with default values (rank=2, alpha=4.0, 768x768).
     */
    constructor() {
        const ret = wasm.microloraconfigwasm_new();
        this.__wbg_ptr = ret;
        MicroLoraConfigWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get output feature dimension.
     * @returns {number}
     */
    get outFeatures() {
        const ret = wasm.microloraconfigwasm_outFeatures(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get rank.
     * @returns {number}
     */
    get rank() {
        const ret = wasm.microloraconfigwasm_rank(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Set alpha scaling factor.
     * @param {number} value
     */
    set alpha(value) {
        wasm.microloraconfigwasm_set_alpha(this.__wbg_ptr, value);
    }
    /**
     * Set input feature dimension.
     * @param {number} value
     */
    set inFeatures(value) {
        wasm.microloraconfigwasm_set_inFeatures(this.__wbg_ptr, value);
    }
    /**
     * Set output feature dimension.
     * @param {number} value
     */
    set outFeatures(value) {
        wasm.microloraconfigwasm_set_outFeatures(this.__wbg_ptr, value);
    }
    /**
     * Set rank (clamped to 1-4 for browser efficiency).
     * @param {number} value
     */
    set rank(value) {
        wasm.microloraconfigwasm_set_rank(this.__wbg_ptr, value);
    }
}
if (Symbol.dispose) MicroLoraConfigWasm.prototype[Symbol.dispose] = MicroLoraConfigWasm.prototype.free;
exports.MicroLoraConfigWasm = MicroLoraConfigWasm;

/**
 * Statistics for MicroLoRA adapter.
 */
class MicroLoraStatsWasm {
    static __wrap(ptr) {
        const obj = Object.create(MicroLoraStatsWasm.prototype);
        obj.__wbg_ptr = ptr;
        MicroLoraStatsWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MicroLoraStatsWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_microlorastatswasm_free(ptr, 0);
    }
    /**
     * Get average quality score.
     * @returns {number}
     */
    get avgQuality() {
        const ret = wasm.microlorastatswasm_avgQuality(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get memory usage in bytes.
     * @returns {number}
     */
    get memoryBytes() {
        const ret = wasm.microlorastatswasm_memoryBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get parameter count.
     * @returns {number}
     */
    get paramCount() {
        const ret = wasm.microlorastatswasm_paramCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get number of samples seen.
     * @returns {number}
     */
    get samplesSeen() {
        const ret = wasm.microlorastatswasm_samplesSeen(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Convert to JSON string.
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.microlorastatswasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) MicroLoraStatsWasm.prototype[Symbol.dispose] = MicroLoraStatsWasm.prototype.free;
exports.MicroLoraStatsWasm = MicroLoraStatsWasm;

/**
 * MicroLoRA adapter for browser-based real-time adaptation.
 *
 * Provides lightweight LoRA (Low-Rank Adaptation) with minimal memory footprint
 * suitable for browser environments. Supports per-request adaptation with
 * quality-based feedback.
 */
class MicroLoraWasm {
    static __wrap(ptr) {
        const obj = Object.create(MicroLoraWasm.prototype);
        obj.__wbg_ptr = ptr;
        MicroLoraWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MicroLoraWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_microlorawasm_free(ptr, 0);
    }
    /**
     * Adapt the LoRA weights based on feedback.
     *
     * Accumulates gradients based on the quality score. Call `applyUpdates()`
     * to actually apply the accumulated gradients.
     * @param {Float32Array} input
     * @param {AdaptFeedbackWasm} feedback
     */
    adapt(input, feedback) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(feedback, AdaptFeedbackWasm);
        const ret = wasm.microlorawasm_adapt(this.__wbg_ptr, ptr0, len0, feedback.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Apply LoRA transformation to input.
     *
     * Returns a new Float32Array with the transformed output.
     * The output is added to (not replaced) so you can combine with base model output.
     * @param {Float32Array} input
     * @returns {Float32Array}
     */
    apply(input) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.microlorawasm_apply(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Apply accumulated gradients with the given learning rate.
     *
     * Should be called after one or more `adapt()` calls to update the weights.
     * @param {number} learning_rate
     */
    applyUpdates(learning_rate) {
        wasm.microlorawasm_applyUpdates(this.__wbg_ptr, learning_rate);
    }
    /**
     * Deserialize from JSON string.
     * @param {string} json
     * @returns {MicroLoraWasm}
     */
    static fromJson(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.microlorawasm_fromJson(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MicroLoraWasm.__wrap(ret[0]);
    }
    /**
     * Get configuration.
     * @returns {MicroLoraConfigWasm}
     */
    getConfig() {
        const ret = wasm.microlorawasm_getConfig(this.__wbg_ptr);
        return MicroLoraConfigWasm.__wrap(ret);
    }
    /**
     * Create a new MicroLoRA adapter with the given configuration.
     * @param {MicroLoraConfigWasm} config
     */
    constructor(config) {
        _assertClass(config, MicroLoraConfigWasm);
        const ret = wasm.microlorawasm_new(config.__wbg_ptr);
        this.__wbg_ptr = ret;
        MicroLoraWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get number of pending gradient updates.
     * @returns {number}
     */
    pendingUpdates() {
        const ret = wasm.microlorawasm_pendingUpdates(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reset the adapter to its initial state.
     *
     * Clears B weights and all statistics.
     */
    reset() {
        wasm.microlorawasm_reset(this.__wbg_ptr);
    }
    /**
     * Get adapter statistics.
     * @returns {MicroLoraStatsWasm}
     */
    stats() {
        const ret = wasm.microlorawasm_stats(this.__wbg_ptr);
        return MicroLoraStatsWasm.__wrap(ret);
    }
    /**
     * Serialize to JSON string for persistence.
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.microlorawasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) MicroLoraWasm.prototype[Symbol.dispose] = MicroLoraWasm.prototype.free;
exports.MicroLoraWasm = MicroLoraWasm;

/**
 * Main parallel inference interface for WASM.
 *
 * Provides high-level API for parallel compute operations in the browser.
 * Automatically manages worker pool and shared memory.
 */
class ParallelInference {
    static __wrap(ptr) {
        const obj = Object.create(ParallelInference.prototype);
        obj.__wbg_ptr = ptr;
        ParallelInferenceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ParallelInferenceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_parallelinference_free(ptr, 0);
    }
    /**
     * Perform parallel multi-head attention.
     *
     * Computes softmax(Q * K^T / sqrt(d_k)) * V for each attention head.
     *
     * # Arguments
     * * `q` - Query tensor (batch_size, num_heads, seq_len, head_dim)
     * * `k` - Key tensor (batch_size, num_heads, seq_len, head_dim)
     * * `v` - Value tensor (batch_size, num_heads, seq_len, head_dim)
     * * `num_heads` - Number of attention heads
     * * `head_dim` - Dimension of each head
     * * `seq_len` - Sequence length
     *
     * # Returns
     * Output tensor (batch_size, num_heads, seq_len, head_dim)
     * @param {Float32Array} q
     * @param {Float32Array} k
     * @param {Float32Array} v
     * @param {number} num_heads
     * @param {number} head_dim
     * @param {number} seq_len
     * @returns {Promise<Float32Array>}
     */
    attention(q, k, v, num_heads, head_dim, seq_len) {
        const ptr0 = passArrayF32ToWasm0(q, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(k, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(v, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.parallelinference_attention(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, num_heads, head_dim, seq_len);
        return ret;
    }
    /**
     * Get statistics about worker pool.
     * @returns {string}
     */
    getStats() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.parallelinference_getStats(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Check if Atomics API is available.
     * @returns {boolean}
     */
    isAtomicsAvailable() {
        const ret = wasm.parallelinference_isAtomicsAvailable(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Check if the page is cross-origin isolated.
     * @returns {boolean}
     */
    isCrossOriginIsolated() {
        const ret = wasm.parallelinference_isCrossOriginIsolated(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Check if SharedArrayBuffer is available.
     * @returns {boolean}
     */
    isSharedMemoryAvailable() {
        const ret = wasm.parallelinference_isSharedMemoryAvailable(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Perform parallel layer normalization.
     *
     * # Arguments
     * * `input` - Input tensor
     * * `gamma` - Scale parameter
     * * `beta` - Shift parameter
     * * `epsilon` - Small constant for numerical stability
     *
     * # Returns
     * Normalized tensor
     * @param {Float32Array} input
     * @param {Float32Array} gamma
     * @param {Float32Array} beta
     * @param {number} epsilon
     * @returns {Promise<Float32Array>}
     */
    layerNorm(input, gamma, beta, epsilon) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(gamma, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(beta, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.parallelinference_layerNorm(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, epsilon);
        return ret;
    }
    /**
     * Perform parallel matrix multiplication.
     *
     * Computes C = A * B where:
     * - A is m x k
     * - B is k x n
     * - C is m x n
     *
     * # Arguments
     * * `a` - Matrix A as flat array (row-major)
     * * `b` - Matrix B as flat array (row-major)
     * * `m` - Number of rows in A
     * * `n` - Number of columns in B
     * * `k` - Number of columns in A / rows in B
     *
     * # Returns
     * Result matrix C as Float32Array
     * @param {Float32Array} a
     * @param {Float32Array} b
     * @param {number} m
     * @param {number} n
     * @param {number} k
     * @returns {Promise<Float32Array>}
     */
    matmul(a, b, m, n, k) {
        const ptr0 = passArrayF32ToWasm0(a, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(b, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.parallelinference_matmul(this.__wbg_ptr, ptr0, len0, ptr1, len1, m, n, k);
        return ret;
    }
    /**
     * Create a new ParallelInference instance.
     *
     * # Arguments
     * * `num_workers` - Number of workers to spawn. If None, uses optimal count.
     *
     * # Returns
     * A Promise that resolves to ParallelInference instance.
     *
     * # Example (JavaScript)
     * ```javascript
     * const inference = await ParallelInference.new(4);
     * ```
     * @param {number | null} [num_workers]
     */
    constructor(num_workers) {
        const ret = wasm.parallelinference_new(isLikeNone(num_workers) ? Number.MAX_SAFE_INTEGER : (num_workers) >>> 0);
        return ret;
    }
    /**
     * Get optimal worker count for the current hardware.
     * @returns {number}
     */
    static optimalWorkerCount() {
        const ret = wasm.parallelinference_optimalWorkerCount();
        return ret >>> 0;
    }
    /**
     * Terminate all workers and clean up resources.
     */
    terminate() {
        wasm.parallelinference_terminate(this.__wbg_ptr);
    }
    /**
     * Get the number of active workers.
     * @returns {number}
     */
    workerCount() {
        const ret = wasm.parallelinference_workerCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) ParallelInference.prototype[Symbol.dispose] = ParallelInference.prototype.free;
exports.ParallelInference = ParallelInference;

/**
 * A stored pattern with embedding and metadata
 *
 * Represents a routing pattern that can be matched against queries.
 * Each pattern has a name, embedding vector, and optional metadata.
 */
class PatternWasm {
    static __wrap(ptr) {
        const obj = Object.create(PatternWasm.prototype);
        obj.__wbg_ptr = ptr;
        PatternWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PatternWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_patternwasm_free(ptr, 0);
    }
    /**
     * Get pattern embedding as Float32Array
     * @returns {Float32Array}
     */
    get embedding() {
        const ret = wasm.patternwasm_embedding(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get pattern metadata JSON string
     * @returns {string}
     */
    get metadata() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.patternwasm_metadata(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get pattern name
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.patternwasm_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Create a new pattern
     *
     * # Parameters
     *
     * - `embedding`: Float32Array of embedding values
     * - `name`: Pattern name/identifier
     * - `metadata`: JSON string with additional metadata
     * @param {Float32Array} embedding
     * @param {string} name
     * @param {string} metadata
     */
    constructor(embedding, name, metadata) {
        const ptr0 = passArrayF32ToWasm0(embedding, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(metadata, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.patternwasm_new(ptr0, len0, ptr1, len1, ptr2, len2);
        this.__wbg_ptr = ret;
        PatternWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Set pattern metadata
     * @param {string} metadata
     */
    set metadata(metadata) {
        const ptr0 = passStringToWasm0(metadata, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.patternwasm_set_metadata(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Set pattern name
     * @param {string} name
     */
    set name(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.patternwasm_set_name(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) PatternWasm.prototype[Symbol.dispose] = PatternWasm.prototype.free;
exports.PatternWasm = PatternWasm;

/**
 * A routing search result with similarity score
 *
 * Represents a matched pattern from a semantic search query.
 */
class RouteResultWasm {
    static __wrap(ptr) {
        const obj = Object.create(RouteResultWasm.prototype);
        obj.__wbg_ptr = ptr;
        RouteResultWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RouteResultWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_routeresultwasm_free(ptr, 0);
    }
    /**
     * Get result embedding as Float32Array
     * @returns {Float32Array}
     */
    get embedding() {
        const ret = wasm.routeresultwasm_embedding(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get result metadata JSON string
     * @returns {string}
     */
    get metadata() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.routeresultwasm_metadata(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get result pattern name
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.routeresultwasm_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get similarity score (higher is better, 0.0-1.0 for cosine)
     * @returns {number}
     */
    get score() {
        const ret = wasm.routeresultwasm_score(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) RouteResultWasm.prototype[Symbol.dispose] = RouteResultWasm.prototype.free;
exports.RouteResultWasm = RouteResultWasm;

/**
 * Main RuvLLM WASM interface.
 *
 * Provides the primary entry point for LLM inference in the browser.
 * Manages KV cache, memory pools, and inference state.
 */
class RuvLLMWasm {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RuvLLMWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ruvllmwasm_free(ptr, 0);
    }
    /**
     * Format a chat conversation using a template.
     * @param {ChatTemplateWasm} template
     * @param {ChatMessageWasm[]} messages
     * @returns {string}
     */
    static formatChat(template, messages) {
        let deferred2_0;
        let deferred2_1;
        try {
            _assertClass(template, ChatTemplateWasm);
            const ptr0 = passArrayJsValueToWasm0(messages, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.ruvllmwasm_formatChat(template.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get buffer pool statistics.
     * @returns {string}
     */
    getPoolStats() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.ruvllmwasm_getPoolStats(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Initialize the engine with default configuration.
     */
    initialize() {
        const ret = wasm.ruvllmwasm_initialize(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Initialize with custom KV cache configuration.
     * @param {KvCacheConfigWasm} config
     */
    initializeWithConfig(config) {
        _assertClass(config, KvCacheConfigWasm);
        const ret = wasm.ruvllmwasm_initializeWithConfig(this.__wbg_ptr, config.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Check if the engine is initialized.
     * @returns {boolean}
     */
    get isInitialized() {
        const ret = wasm.ruvllmwasm_isInitialized(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Create a new RuvLLM WASM instance.
     */
    constructor() {
        const ret = wasm.ruvllmwasm_new();
        this.__wbg_ptr = ret;
        RuvLLMWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Clear all caches and reset state.
     */
    reset() {
        wasm.ruvllmwasm_reset(this.__wbg_ptr);
    }
    /**
     * Get version information.
     * @returns {string}
     */
    static version() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.ruvllmwasm_version();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) RuvLLMWasm.prototype[Symbol.dispose] = RuvLLMWasm.prototype.free;
exports.RuvLLMWasm = RuvLLMWasm;

/**
 * Result of instant adaptation
 */
class SonaAdaptResultWasm {
    static __wrap(ptr) {
        const obj = Object.create(SonaAdaptResultWasm.prototype);
        obj.__wbg_ptr = ptr;
        SonaAdaptResultWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SonaAdaptResultWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sonaadaptresultwasm_free(ptr, 0);
    }
    /**
     * Get applied status
     * @returns {boolean}
     */
    get applied() {
        const ret = wasm.sonaadaptresultwasm_applied(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Get current rank
     * @returns {number}
     */
    get currentRank() {
        const ret = wasm.sonaadaptresultwasm_currentRank(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get latency in microseconds
     * @returns {bigint}
     */
    get latencyUs() {
        const ret = wasm.sonaadaptresultwasm_latencyUs(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get quality delta
     * @returns {number}
     */
    get qualityDelta() {
        const ret = wasm.sonaadaptresultwasm_qualityDelta(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get quality EMA
     * @returns {number}
     */
    get qualityEma() {
        const ret = wasm.sonaadaptresultwasm_qualityEma(this.__wbg_ptr);
        return ret;
    }
    /**
     * Convert to JSON
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.sonaadaptresultwasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) SonaAdaptResultWasm.prototype[Symbol.dispose] = SonaAdaptResultWasm.prototype.free;
exports.SonaAdaptResultWasm = SonaAdaptResultWasm;

/**
 * Configuration for SONA Instant Loop (WASM)
 */
class SonaConfigWasm {
    static __wrap(ptr) {
        const obj = Object.create(SonaConfigWasm.prototype);
        obj.__wbg_ptr = ptr;
        SonaConfigWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SonaConfigWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sonaconfigwasm_free(ptr, 0);
    }
    /**
     * Get EMA decay
     * @returns {number}
     */
    get emaDecay() {
        const ret = wasm.sonaconfigwasm_emaDecay(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get EWC lambda
     * @returns {number}
     */
    get ewcLambda() {
        const ret = wasm.sonaconfigwasm_ewcLambda(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create from JSON
     * @param {string} json
     * @returns {SonaConfigWasm}
     */
    static fromJson(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sonaconfigwasm_fromJson(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SonaConfigWasm.__wrap(ret[0]);
    }
    /**
     * Get hidden dimension
     * @returns {number}
     */
    get hiddenDim() {
        const ret = wasm.sonaconfigwasm_hiddenDim(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get learning rate
     * @returns {number}
     */
    get learningRate() {
        const ret = wasm.sonaconfigwasm_learningRate(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get micro-LoRA rank
     * @returns {number}
     */
    get microLoraRank() {
        const ret = wasm.sonaconfigwasm_microLoraRank(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create new config with defaults
     */
    constructor() {
        const ret = wasm.sonaconfigwasm_new();
        this.__wbg_ptr = ret;
        SonaConfigWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get pattern capacity
     * @returns {number}
     */
    get patternCapacity() {
        const ret = wasm.sonaconfigwasm_patternCapacity(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Set EMA decay
     * @param {number} value
     */
    set emaDecay(value) {
        wasm.sonaconfigwasm_set_emaDecay(this.__wbg_ptr, value);
    }
    /**
     * Set EWC lambda
     * @param {number} value
     */
    set ewcLambda(value) {
        wasm.sonaconfigwasm_set_ewcLambda(this.__wbg_ptr, value);
    }
    /**
     * Set hidden dimension
     * @param {number} value
     */
    set hiddenDim(value) {
        wasm.sonaconfigwasm_set_hiddenDim(this.__wbg_ptr, value);
    }
    /**
     * Set learning rate
     * @param {number} value
     */
    set learningRate(value) {
        wasm.sonaconfigwasm_set_learningRate(this.__wbg_ptr, value);
    }
    /**
     * Set micro-LoRA rank
     * @param {number} value
     */
    set microLoraRank(value) {
        wasm.sonaconfigwasm_set_microLoraRank(this.__wbg_ptr, value);
    }
    /**
     * Set pattern capacity
     * @param {number} value
     */
    set patternCapacity(value) {
        wasm.sonaconfigwasm_set_patternCapacity(this.__wbg_ptr, value);
    }
    /**
     * Convert to JSON
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.sonaconfigwasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) SonaConfigWasm.prototype[Symbol.dispose] = SonaConfigWasm.prototype.free;
exports.SonaConfigWasm = SonaConfigWasm;

/**
 * SONA Instant Loop for WASM
 */
class SonaInstantWasm {
    static __wrap(ptr) {
        const obj = Object.create(SonaInstantWasm.prototype);
        obj.__wbg_ptr = ptr;
        SonaInstantWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SonaInstantWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sonainstantwasm_free(ptr, 0);
    }
    /**
     * Import state from JSON (partial - doesn't restore patterns)
     * @param {string} json
     * @returns {SonaInstantWasm}
     */
    static fromJson(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sonainstantwasm_fromJson(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SonaInstantWasm.__wrap(ret[0]);
    }
    /**
     * Get number of important weights tracked (EWC-lite)
     * @returns {number}
     */
    importantWeightCount() {
        const ret = wasm.sonainstantwasm_importantWeightCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Instant adaptation based on quality signal
     *
     * Target: <1ms latency
     * @param {number} quality
     * @returns {SonaAdaptResultWasm}
     */
    instantAdapt(quality) {
        const ret = wasm.sonainstantwasm_instantAdapt(this.__wbg_ptr, quality);
        return SonaAdaptResultWasm.__wrap(ret);
    }
    /**
     * Create new SONA instant loop
     * @param {SonaConfigWasm} config
     */
    constructor(config) {
        _assertClass(config, SonaConfigWasm);
        var ptr0 = config.__destroy_into_raw();
        const ret = wasm.sonainstantwasm_new(ptr0);
        this.__wbg_ptr = ret;
        SonaInstantWasmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Record a pattern outcome for future reference
     * @param {Float32Array} embedding
     * @param {boolean} success
     */
    recordPattern(embedding, success) {
        const ptr0 = passArrayF32ToWasm0(embedding, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.sonainstantwasm_recordPattern(this.__wbg_ptr, ptr0, len0, success);
    }
    /**
     * Reset all learning state
     */
    reset() {
        wasm.sonainstantwasm_reset(this.__wbg_ptr);
    }
    /**
     * Get current statistics
     * @returns {SonaStatsWasm}
     */
    stats() {
        const ret = wasm.sonainstantwasm_stats(this.__wbg_ptr);
        return SonaStatsWasm.__wrap(ret);
    }
    /**
     * Suggest action based on learned patterns
     *
     * Uses simple cosine similarity search (HNSW integration point for future)
     * @param {Float32Array} context
     * @returns {string | undefined}
     */
    suggestAction(context) {
        const ptr0 = passArrayF32ToWasm0(context, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sonainstantwasm_suggestAction(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Export state to JSON
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.sonainstantwasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) SonaInstantWasm.prototype[Symbol.dispose] = SonaInstantWasm.prototype.free;
exports.SonaInstantWasm = SonaInstantWasm;

/**
 * Learning statistics
 */
class SonaStatsWasm {
    static __wrap(ptr) {
        const obj = Object.create(SonaStatsWasm.prototype);
        obj.__wbg_ptr = ptr;
        SonaStatsWasmFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SonaStatsWasmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sonastatswasm_free(ptr, 0);
    }
    /**
     * Get adaptations count
     * @returns {bigint}
     */
    get adaptations() {
        const ret = wasm.sonastatswasm_adaptations(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get average latency
     * @returns {number}
     */
    get avgLatencyUs() {
        const ret = wasm.sonastatswasm_avgLatencyUs(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get average quality
     * @returns {number}
     */
    get avgQuality() {
        const ret = wasm.sonastatswasm_avgQuality(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get buffer size
     * @returns {number}
     */
    get bufferSize() {
        const ret = wasm.sonastatswasm_bufferSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get current rank
     * @returns {number}
     */
    get currentRank() {
        const ret = wasm.sonastatswasm_currentRank(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get patterns recorded
     * @returns {bigint}
     */
    get patternsRecorded() {
        const ret = wasm.sonastatswasm_patternsRecorded(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Success rate
     * @returns {number}
     */
    successRate() {
        const ret = wasm.sonastatswasm_successRate(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get successful patterns
     * @returns {bigint}
     */
    get successfulPatterns() {
        const ret = wasm.sonastatswasm_successfulPatterns(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Convert to JSON
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.sonastatswasm_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) SonaStatsWasm.prototype[Symbol.dispose] = SonaStatsWasm.prototype.free;
exports.SonaStatsWasm = SonaStatsWasm;

/**
 * Simple timer for measuring elapsed time in WASM.
 */
class Timer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TimerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_timer_free(ptr, 0);
    }
    /**
     * Get elapsed time in milliseconds.
     * @returns {number}
     */
    elapsed_ms() {
        const ret = wasm.timer_elapsed_ms(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create a new timer with the given label.
     *
     * # Arguments
     *
     * * `label` - A descriptive label for the timer
     * @param {string} label
     */
    constructor(label) {
        const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.timer_new(ptr0, len0);
        this.__wbg_ptr = ret;
        TimerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Reset the timer.
     */
    reset() {
        wasm.timer_reset(this.__wbg_ptr);
    }
    /**
     * Log elapsed time to console and return the duration.
     * @returns {number}
     */
    stop() {
        const ret = wasm.timer_stop(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Timer.prototype[Symbol.dispose] = Timer.prototype.free;
exports.Timer = Timer;

/**
 * Check if the page is cross-origin isolated.
 *
 * Cross-origin isolation is required for SharedArrayBuffer to work.
 * The page must be served with:
 * - `Cross-Origin-Opener-Policy: same-origin`
 * - `Cross-Origin-Embedder-Policy: require-corp`
 *
 * # Returns
 * `true` if cross-origin isolated, `false` otherwise.
 * @returns {boolean}
 */
function cross_origin_isolated() {
    const ret = wasm.cross_origin_isolated();
    return ret !== 0;
}
exports.cross_origin_isolated = cross_origin_isolated;

/**
 * Detect chat template from model ID.
 * @param {string} model_id
 * @returns {ChatTemplateWasm}
 */
function detectChatTemplate(model_id) {
    const ptr0 = passStringToWasm0(model_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.detectChatTemplate(ptr0, len0);
    return ChatTemplateWasm.__wrap(ret);
}
exports.detectChatTemplate = detectChatTemplate;

/**
 * Determine the capability level for parallel inference.
 *
 * # Returns
 * The capability level based on available features.
 * @returns {string}
 */
function detect_capability_level() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.detect_capability_level();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.detect_capability_level = detect_capability_level;

/**
 * Log an error to the browser console.
 *
 * # Arguments
 *
 * * `message` - The error message
 * @param {string} message
 */
function error(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.error(ptr0, len0);
}
exports.error = error;

/**
 * Get a summary of all available features.
 *
 * # Returns
 * JSON string with feature availability.
 * @returns {string}
 */
function feature_summary() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.feature_summary();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.feature_summary = feature_summary;

/**
 * Get the WASM module version.
 * @returns {string}
 */
function getVersion() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.getVersion();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.getVersion = getVersion;

/**
 * Perform a simple health check.
 *
 * Returns true if the WASM module is functioning correctly.
 * @returns {boolean}
 */
function healthCheck() {
    const ret = wasm.healthCheck();
    return ret !== 0;
}
exports.healthCheck = healthCheck;

/**
 * Initialize the WASM module.
 *
 * This should be called once at application startup to set up
 * panic hooks and any other initialization.
 */
function init() {
    wasm.init();
}
exports.init = init;

/**
 * Check if the WASM module is ready.
 * @returns {boolean}
 */
function isReady() {
    const ret = wasm.isReady();
    return ret !== 0;
}
exports.isReady = isReady;

/**
 * Check if Atomics API is available.
 *
 * Atomics provides atomic operations for synchronization between
 * the main thread and Web Workers.
 *
 * # Returns
 * `true` if Atomics is available, `false` otherwise.
 * @returns {boolean}
 */
function is_atomics_available() {
    const ret = wasm.is_atomics_available();
    return ret !== 0;
}
exports.is_atomics_available = is_atomics_available;

/**
 * Check if BigInt is available.
 *
 * BigInt is useful for 64-bit integer operations.
 *
 * # Returns
 * `true` if BigInt is available, `false` otherwise.
 * @returns {boolean}
 */
function is_bigint_available() {
    const ret = wasm.is_bigint_available();
    return ret !== 0;
}
exports.is_bigint_available = is_bigint_available;

/**
 * Check if SharedArrayBuffer is available.
 *
 * SharedArrayBuffer is required for zero-copy memory sharing between
 * the main thread and Web Workers.
 *
 * # Notes
 * - SharedArrayBuffer was temporarily disabled in all browsers after
 *   Spectre/Meltdown vulnerabilities were discovered.
 * - It's now available again, but requires cross-origin isolation:
 *   - `Cross-Origin-Opener-Policy: same-origin`
 *   - `Cross-Origin-Embedder-Policy: require-corp`
 *
 * # Returns
 * `true` if SharedArrayBuffer is available, `false` otherwise.
 * @returns {boolean}
 */
function is_shared_array_buffer_available() {
    const ret = wasm.is_shared_array_buffer_available();
    return ret !== 0;
}
exports.is_shared_array_buffer_available = is_shared_array_buffer_available;

/**
 * Check if SIMD (WebAssembly SIMD) is available.
 *
 * # Returns
 * `true` if WASM SIMD is available, `false` otherwise.
 * @returns {boolean}
 */
function is_simd_available() {
    const ret = wasm.is_simd_available();
    return ret !== 0;
}
exports.is_simd_available = is_simd_available;

/**
 * Check if Transferable objects are available.
 *
 * Transferable objects (ArrayBuffer, MessagePort, etc.) can be
 * transferred to workers without copying.
 *
 * # Returns
 * `true` if Transferable objects are available, `false` otherwise.
 * @returns {boolean}
 */
function is_transferable_available() {
    const ret = wasm.is_transferable_available();
    return ret !== 0;
}
exports.is_transferable_available = is_transferable_available;

/**
 * Check if Web Workers are available.
 *
 * # Returns
 * `true` if Web Workers are available, `false` otherwise.
 * @returns {boolean}
 */
function is_web_workers_available() {
    const ret = wasm.is_web_workers_available();
    return ret !== 0;
}
exports.is_web_workers_available = is_web_workers_available;

/**
 * Log a message to the browser console.
 *
 * # Arguments
 *
 * * `message` - The message to log
 * @param {string} message
 */
function log(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.log(ptr0, len0);
}
exports.log = log;

/**
 * Get current timestamp in milliseconds using Performance API.
 *
 * Returns high-resolution timestamp for performance measurements.
 * @returns {number}
 */
function now_ms() {
    const ret = wasm.now_ms();
    return ret;
}
exports.now_ms = now_ms;

/**
 * Get the optimal number of workers based on hardware concurrency.
 *
 * Uses `navigator.hardwareConcurrency` if available, otherwise falls
 * back to a reasonable default.
 *
 * # Notes
 * - Caps the result at MAX_WORKERS to prevent resource exhaustion.
 * - Leaves at least 1 core for the main thread.
 * - Falls back to 4 if hardware concurrency is not available.
 *
 * # Returns
 * Recommended number of workers.
 * @returns {number}
 */
function optimal_worker_count() {
    const ret = wasm.optimal_worker_count();
    return ret >>> 0;
}
exports.optimal_worker_count = optimal_worker_count;

/**
 * Get a message explaining why parallel inference is not available.
 *
 * # Returns
 * Explanation string, or empty string if parallel inference is available.
 * @returns {string}
 */
function parallel_inference_unavailable_reason() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.parallel_inference_unavailable_reason();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.parallel_inference_unavailable_reason = parallel_inference_unavailable_reason;

/**
 * Check if the environment supports parallel inference.
 *
 * # Arguments
 * * `require_shared_memory` - Whether to require SharedArrayBuffer
 *
 * # Returns
 * `true` if parallel inference is supported, `false` otherwise.
 * @param {boolean} require_shared_memory
 * @returns {boolean}
 */
function supports_parallel_inference(require_shared_memory) {
    const ret = wasm.supports_parallel_inference(require_shared_memory);
    return ret !== 0;
}
exports.supports_parallel_inference = supports_parallel_inference;

/**
 * Log a warning to the browser console.
 *
 * # Arguments
 *
 * * `message` - The warning message
 * @param {string} message
 */
function warn(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.warn(ptr0, len0);
}
exports.warn = warn;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_ef53bc310eb298a0: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_boolean_get_1a45e2c38d4d41b9: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_0accd80f45e5faa2: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_754e9f305ff6029e: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_87c3bfe968c6a5ad: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_string_c236cabd84a4d769: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_67b456be8673d3d7: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_number_get_9bb1761122181af2: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_61db23ac97f16c31: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_call_9c758de292015997: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_chatmessagewasm_unwrap: function(arg0) {
            const ret = ChatMessageWasm.__unwrap(arg0);
            return ret;
        },
        __wbg_createObjectURL_395ba916655726cd: function() { return handleError(function (arg0, arg1) {
            const ret = URL.createObjectURL(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_error_78ff5b3a29b770e0: function(arg0) {
            console.error(arg0);
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_get_de6a0f7d4d18a304: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_hardwareConcurrency_6ea7d2267444bcf4: function(arg0) {
            const ret = arg0.hardwareConcurrency;
            return ret;
        },
        __wbg_instanceof_Window_e093be59ee9a8e14: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_length_7abca14930109c1c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_log_cf2e968649f3384e: function(arg0) {
            console.log(arg0);
        },
        __wbg_navigator_3833ecdbc19d2757: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_2c48d7fdccf94f7a: function(arg0) {
            const ret = new Float32Array(arg0);
            return ret;
        },
        __wbg_new_578aeef4b6b94378: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_622fc80556be2e26: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_b682b81e8eaaf027: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h1cbaebde3e8f3d88(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_ce1ab61c1c2b300d: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_d35aa408f4bf4aa1: function(arg0) {
            const ret = new ArrayBuffer(arg0 >>> 0);
            return ret;
        },
        __wbg_new_d4c752f1281b2f74: function(arg0) {
            const ret = new SharedArrayBuffer(arg0 >>> 0);
            return ret;
        },
        __wbg_new_d90091b82fdf5b91: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_from_slice_18fa1f71286d66b8: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_956df4f769fb782c: function(arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_bf31d18f92484486: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h1cbaebde3e8f3d88(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_byte_offset_and_length_ae1b31d177f9a074: function(arg0, arg1, arg2) {
            const ret = new Float32Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_new_with_options_5c98ca2e0eb88040: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Worker(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_with_str_sequence_and_options_21cfcd771283a47d: function() { return handleError(function (arg0, arg1) {
            const ret = new Blob(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_now_f565250295e2d180: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_parallelinference_new: function(arg0) {
            const ret = ParallelInference.__wrap(arg0);
            return ret;
        },
        __wbg_performance_68499ca0718837f5: function(arg0) {
            const ret = arg0.performance;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_postMessage_cf975f9c13498b76: function() { return handleError(function (arg0, arg1) {
            arg0.postMessage(arg1);
        }, arguments); },
        __wbg_prototypesetcall_6239d0967941c8d9: function(arg0, arg1, arg2) {
            Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_a6822215aa43e71c: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_35c611f4a14830b2: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_queueMicrotask_404ed0a58e0b63cc: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_resolve_25a7e548d5881dca: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_revokeObjectURL_02f29532cbc52b60: function() { return handleError(function (arg0, arg1) {
            URL.revokeObjectURL(getStringFromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_routeresultwasm_new: function(arg0) {
            const ret = RouteResultWasm.__wrap(arg0);
            return ret;
        },
        __wbg_setTimeout_b5f25e402b6e8ff9: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.setTimeout(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_17b040da5ecb5861: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_52b1e1eb5bed906a: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_6e30c9374c26414c: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_c775d84916be79ea: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_dca99999bba88a9a: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_type_f2ba381718ed1039: function(arg0, arg1, arg2) {
            arg0.type = getStringFromWasm0(arg1, arg2);
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_9d53f2689e622ca1: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_a1a35cec07001a8a: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_4c59f6c7ea29a144: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_e70ae9f2eb052253: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_terminate_854183e37c3fd8fd: function(arg0) {
            arg0.terminate();
        },
        __wbg_then_18f476d590e58992: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_ac7b025999b52837: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_warn_410c3261e3c6d686: function(arg0) {
            console.warn(arg0);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 114, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hc8b0ff15296c7802);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0, arg1) {
            var v0 = getArrayF32FromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 4, 4);
            // Cast intrinsic for `Vector(F32) -> Externref`.
            const ret = v0;
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./monovector_ruvllm_wasm_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__hc8b0ff15296c7802(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__hc8b0ff15296c7802(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h1cbaebde3e8f3d88(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h1cbaebde3e8f3d88(arg0, arg1, arg2, arg3);
}

const AdaptFeedbackWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_adaptfeedbackwasm_free(ptr, 1));
const BufferPoolWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bufferpoolwasm_free(ptr, 1));
const ChatMessageWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_chatmessagewasm_free(ptr, 1));
const ChatTemplateWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_chattemplatewasm_free(ptr, 1));
const GenerateConfigFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_generateconfig_free(ptr, 1));
const HnswRouterWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_hnswrouterwasm_free(ptr, 1));
const InferenceArenaWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_inferencearenawasm_free(ptr, 1));
const KvCacheConfigWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kvcacheconfigwasm_free(ptr, 1));
const KvCacheStatsWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kvcachestatswasm_free(ptr, 1));
const KvCacheWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kvcachewasm_free(ptr, 1));
const MicroLoraConfigWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_microloraconfigwasm_free(ptr, 1));
const MicroLoraStatsWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_microlorastatswasm_free(ptr, 1));
const MicroLoraWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_microlorawasm_free(ptr, 1));
const ParallelInferenceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_parallelinference_free(ptr, 1));
const PatternWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_patternwasm_free(ptr, 1));
const RouteResultWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_routeresultwasm_free(ptr, 1));
const RuvLLMWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ruvllmwasm_free(ptr, 1));
const SonaAdaptResultWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sonaadaptresultwasm_free(ptr, 1));
const SonaConfigWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sonaconfigwasm_free(ptr, 1));
const SonaInstantWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sonainstantwasm_free(ptr, 1));
const SonaStatsWasmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sonastatswasm_free(ptr, 1));
const TimerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_timer_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/monovector_ruvllm_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
