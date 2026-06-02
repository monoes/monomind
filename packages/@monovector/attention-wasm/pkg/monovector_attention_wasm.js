/* @ts-self-types="./monovector_attention_wasm.d.ts" */

/**
 * Adam optimizer
 */
class WasmAdam {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAdamFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmadam_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get learning_rate() {
        const ret = wasm.wasmadam_learning_rate(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} param_count
     * @param {number} learning_rate
     */
    constructor(param_count, learning_rate) {
        const ret = wasm.wasmadam_new(param_count, learning_rate);
        this.__wbg_ptr = ret;
        WasmAdamFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        wasm.wasmadam_reset(this.__wbg_ptr);
    }
    /**
     * @param {number} lr
     */
    set learning_rate(lr) {
        wasm.wasmadam_set_learning_rate(this.__wbg_ptr, lr);
    }
    /**
     * @param {Float32Array} params
     * @param {Float32Array} gradients
     */
    step(params, gradients) {
        var ptr0 = passArrayF32ToWasm0(params, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(gradients, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.wasmadam_step(this.__wbg_ptr, ptr0, len0, params, ptr1, len1);
    }
}
if (Symbol.dispose) WasmAdam.prototype[Symbol.dispose] = WasmAdam.prototype.free;
exports.WasmAdam = WasmAdam;

/**
 * AdamW optimizer (Adam with decoupled weight decay)
 */
class WasmAdamW {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAdamWFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmadamw_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get learning_rate() {
        const ret = wasm.wasmadamw_learning_rate(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} param_count
     * @param {number} learning_rate
     * @param {number} weight_decay
     */
    constructor(param_count, learning_rate, weight_decay) {
        const ret = wasm.wasmadamw_new(param_count, learning_rate, weight_decay);
        this.__wbg_ptr = ret;
        WasmAdamWFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        wasm.wasmadamw_reset(this.__wbg_ptr);
    }
    /**
     * @param {number} lr
     */
    set learning_rate(lr) {
        wasm.wasmadamw_set_learning_rate(this.__wbg_ptr, lr);
    }
    /**
     * @param {Float32Array} params
     * @param {Float32Array} gradients
     */
    step(params, gradients) {
        var ptr0 = passArrayF32ToWasm0(params, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(gradients, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.wasmadamw_step(this.__wbg_ptr, ptr0, len0, params, ptr1, len1);
    }
    /**
     * @returns {number}
     */
    get weight_decay() {
        const ret = wasm.wasmadamw_weight_decay(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmAdamW.prototype[Symbol.dispose] = WasmAdamW.prototype.free;
exports.WasmAdamW = WasmAdamW;

/**
 * Flash attention mechanism
 */
class WasmFlashAttention {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmFlashAttentionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmflashattention_free(ptr, 0);
    }
    /**
     * @param {Float32Array} query
     * @param {any} keys
     * @param {any} values
     * @returns {Float32Array}
     */
    compute(query, keys, values) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmflashattention_compute(this.__wbg_ptr, ptr0, len0, keys, values);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {number} dim
     * @param {number} block_size
     */
    constructor(dim, block_size) {
        const ret = wasm.wasmflashattention_new(dim, block_size);
        this.__wbg_ptr = ret;
        WasmFlashAttentionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmFlashAttention.prototype[Symbol.dispose] = WasmFlashAttention.prototype.free;
exports.WasmFlashAttention = WasmFlashAttention;

/**
 * Hyperbolic attention mechanism
 */
class WasmHyperbolicAttention {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmHyperbolicAttentionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmhyperbolicattention_free(ptr, 0);
    }
    /**
     * @param {Float32Array} query
     * @param {any} keys
     * @param {any} values
     * @returns {Float32Array}
     */
    compute(query, keys, values) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmhyperbolicattention_compute(this.__wbg_ptr, ptr0, len0, keys, values);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @returns {number}
     */
    get curvature() {
        const ret = wasm.wasmhyperbolicattention_curvature(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} dim
     * @param {number} curvature
     */
    constructor(dim, curvature) {
        const ret = wasm.wasmhyperbolicattention_new(dim, curvature);
        this.__wbg_ptr = ret;
        WasmHyperbolicAttentionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmHyperbolicAttention.prototype[Symbol.dispose] = WasmHyperbolicAttention.prototype.free;
exports.WasmHyperbolicAttention = WasmHyperbolicAttention;

/**
 * InfoNCE contrastive loss for training
 */
class WasmInfoNCELoss {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmInfoNCELossFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasminfonceloss_free(ptr, 0);
    }
    /**
     * Compute InfoNCE loss
     * @param {Float32Array} anchor
     * @param {Float32Array} positive
     * @param {any} negatives
     * @returns {number}
     */
    compute(anchor, positive, negatives) {
        const ptr0 = passArrayF32ToWasm0(anchor, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(positive, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasminfonceloss_compute(this.__wbg_ptr, ptr0, len0, ptr1, len1, negatives);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * Create a new InfoNCE loss instance
     * @param {number} temperature
     */
    constructor(temperature) {
        const ret = wasm.wasminfonceloss_new(temperature);
        this.__wbg_ptr = ret;
        WasmInfoNCELossFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmInfoNCELoss.prototype[Symbol.dispose] = WasmInfoNCELoss.prototype.free;
exports.WasmInfoNCELoss = WasmInfoNCELoss;

/**
 * Learning rate scheduler
 */
class WasmLRScheduler {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLRSchedulerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlrscheduler_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get_lr() {
        const ret = wasm.wasmlrscheduler_get_lr(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} initial_lr
     * @param {number} warmup_steps
     * @param {number} total_steps
     */
    constructor(initial_lr, warmup_steps, total_steps) {
        const ret = wasm.wasmlrscheduler_new(initial_lr, warmup_steps, total_steps);
        this.__wbg_ptr = ret;
        WasmLRSchedulerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        wasm.wasmlrscheduler_reset(this.__wbg_ptr);
    }
    step() {
        wasm.wasmlrscheduler_step(this.__wbg_ptr);
    }
}
if (Symbol.dispose) WasmLRScheduler.prototype[Symbol.dispose] = WasmLRScheduler.prototype.free;
exports.WasmLRScheduler = WasmLRScheduler;

/**
 * Linear attention (Performer-style)
 */
class WasmLinearAttention {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLinearAttentionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlinearattention_free(ptr, 0);
    }
    /**
     * @param {Float32Array} query
     * @param {any} keys
     * @param {any} values
     * @returns {Float32Array}
     */
    compute(query, keys, values) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlinearattention_compute(this.__wbg_ptr, ptr0, len0, keys, values);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {number} dim
     * @param {number} num_features
     */
    constructor(dim, num_features) {
        const ret = wasm.wasmlinearattention_new(dim, num_features);
        this.__wbg_ptr = ret;
        WasmLinearAttentionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmLinearAttention.prototype[Symbol.dispose] = WasmLinearAttention.prototype.free;
exports.WasmLinearAttention = WasmLinearAttention;

/**
 * Local-global attention mechanism
 */
class WasmLocalGlobalAttention {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLocalGlobalAttentionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlocalglobalattention_free(ptr, 0);
    }
    /**
     * @param {Float32Array} query
     * @param {any} keys
     * @param {any} values
     * @returns {Float32Array}
     */
    compute(query, keys, values) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmlocalglobalattention_compute(this.__wbg_ptr, ptr0, len0, keys, values);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {number} dim
     * @param {number} local_window
     * @param {number} global_tokens
     */
    constructor(dim, local_window, global_tokens) {
        const ret = wasm.wasmlocalglobalattention_new(dim, local_window, global_tokens);
        this.__wbg_ptr = ret;
        WasmLocalGlobalAttentionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmLocalGlobalAttention.prototype[Symbol.dispose] = WasmLocalGlobalAttention.prototype.free;
exports.WasmLocalGlobalAttention = WasmLocalGlobalAttention;

/**
 * Mixture of Experts (MoE) attention
 */
class WasmMoEAttention {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMoEAttentionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmoeattention_free(ptr, 0);
    }
    /**
     * @param {Float32Array} query
     * @param {any} keys
     * @param {any} values
     * @returns {Float32Array}
     */
    compute(query, keys, values) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmoeattention_compute(this.__wbg_ptr, ptr0, len0, keys, values);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {number} dim
     * @param {number} num_experts
     * @param {number} top_k
     */
    constructor(dim, num_experts, top_k) {
        const ret = wasm.wasmmoeattention_new(dim, num_experts, top_k);
        this.__wbg_ptr = ret;
        WasmMoEAttentionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmMoEAttention.prototype[Symbol.dispose] = WasmMoEAttention.prototype.free;
exports.WasmMoEAttention = WasmMoEAttention;

/**
 * Multi-head attention mechanism
 */
class WasmMultiHeadAttention {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMultiHeadAttentionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmultiheadattention_free(ptr, 0);
    }
    /**
     * @param {Float32Array} query
     * @param {any} keys
     * @param {any} values
     * @returns {Float32Array}
     */
    compute(query, keys, values) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmultiheadattention_compute(this.__wbg_ptr, ptr0, len0, keys, values);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @returns {number}
     */
    get dim() {
        const ret = wasm.wasmmultiheadattention_dim(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} dim
     * @param {number} num_heads
     */
    constructor(dim, num_heads) {
        const ret = wasm.wasmmultiheadattention_new(dim, num_heads);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmMultiHeadAttentionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get num_heads() {
        const ret = wasm.wasmmultiheadattention_num_heads(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmMultiHeadAttention.prototype[Symbol.dispose] = WasmMultiHeadAttention.prototype.free;
exports.WasmMultiHeadAttention = WasmMultiHeadAttention;

/**
 * SGD optimizer with momentum
 */
class WasmSGD {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSGDFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsgd_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get learning_rate() {
        const ret = wasm.wasmsgd_learning_rate(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} param_count
     * @param {number} learning_rate
     * @param {number | null} [momentum]
     */
    constructor(param_count, learning_rate, momentum) {
        const ret = wasm.wasmsgd_new(param_count, learning_rate, isLikeNone(momentum) ? Number.MAX_SAFE_INTEGER : Math.fround(momentum));
        this.__wbg_ptr = ret;
        WasmSGDFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        wasm.wasmsgd_reset(this.__wbg_ptr);
    }
    /**
     * @param {number} lr
     */
    set learning_rate(lr) {
        wasm.wasmsgd_set_learning_rate(this.__wbg_ptr, lr);
    }
    /**
     * @param {Float32Array} params
     * @param {Float32Array} gradients
     */
    step(params, gradients) {
        var ptr0 = passArrayF32ToWasm0(params, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(gradients, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.wasmsgd_step(this.__wbg_ptr, ptr0, len0, params, ptr1, len1);
    }
}
if (Symbol.dispose) WasmSGD.prototype[Symbol.dispose] = WasmSGD.prototype.free;
exports.WasmSGD = WasmSGD;

/**
 * Compute attention weights from scores
 * @param {Float32Array} scores
 * @param {number | null} [temperature]
 */
function attention_weights(scores, temperature) {
    var ptr0 = passArrayF32ToWasm0(scores, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.attention_weights(ptr0, len0, scores, isLikeNone(temperature) ? Number.MAX_SAFE_INTEGER : Math.fround(temperature));
}
exports.attention_weights = attention_weights;

/**
 * Get information about available attention mechanisms
 * @returns {any}
 */
function available_mechanisms() {
    const ret = wasm.available_mechanisms();
    return ret;
}
exports.available_mechanisms = available_mechanisms;

/**
 * Batch normalize vectors
 * @param {any} vectors
 * @param {number | null} [epsilon]
 * @returns {Float32Array}
 */
function batch_normalize(vectors, epsilon) {
    const ret = wasm.batch_normalize(vectors, isLikeNone(epsilon) ? Number.MAX_SAFE_INTEGER : Math.fround(epsilon));
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}
exports.batch_normalize = batch_normalize;

/**
 * Compute cosine similarity between two vectors
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
function cosine_similarity(a, b) {
    const ptr0 = passArrayF32ToWasm0(a, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(b, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.cosine_similarity(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}
exports.cosine_similarity = cosine_similarity;

/**
 * Initialize the WASM module with panic hook
 */
function init() {
    wasm.init();
}
exports.init = init;

/**
 * Compute L2 norm of a vector
 * @param {Float32Array} vec
 * @returns {number}
 */
function l2_norm(vec) {
    const ptr0 = passArrayF32ToWasm0(vec, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.l2_norm(ptr0, len0);
    return ret;
}
exports.l2_norm = l2_norm;

/**
 * Log a message to the browser console
 * @param {string} message
 */
function log(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.log(ptr0, len0);
}
exports.log = log;

/**
 * Log an error to the browser console
 * @param {string} message
 */
function log_error(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.log_error(ptr0, len0);
}
exports.log_error = log_error;

/**
 * Normalize a vector to unit length
 * @param {Float32Array} vec
 */
function normalize(vec) {
    var ptr0 = passArrayF32ToWasm0(vec, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalize(ptr0, len0, vec);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}
exports.normalize = normalize;

/**
 * Compute pairwise distances between vectors
 * @param {any} vectors
 * @returns {Float32Array}
 */
function pairwise_distances(vectors) {
    const ret = wasm.pairwise_distances(vectors);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}
exports.pairwise_distances = pairwise_distances;

/**
 * Generate random orthogonal matrix (for initialization)
 * @param {number} dim
 * @returns {Float32Array}
 */
function random_orthogonal_matrix(dim) {
    const ret = wasm.random_orthogonal_matrix(dim);
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}
exports.random_orthogonal_matrix = random_orthogonal_matrix;

/**
 * Compute scaled dot-product attention
 * @param {Float32Array} query
 * @param {any} keys
 * @param {any} values
 * @param {number | null} [scale]
 * @returns {Float32Array}
 */
function scaled_dot_attention(query, keys, values, scale) {
    const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.scaled_dot_attention(ptr0, len0, keys, values, isLikeNone(scale) ? Number.MAX_SAFE_INTEGER : Math.fround(scale));
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}
exports.scaled_dot_attention = scaled_dot_attention;

/**
 * Compute softmax of a vector
 * @param {Float32Array} vec
 */
function softmax(vec) {
    var ptr0 = passArrayF32ToWasm0(vec, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.softmax(ptr0, len0, vec);
}
exports.softmax = softmax;

/**
 * Get the version of the ruvector-attention-wasm crate
 * @returns {string}
 */
function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.version = version;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_ef53bc310eb298a0: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_boolean_get_1a45e2c38d4d41b9: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_copy_to_typed_array_7a3f7b938f93cf12: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
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
        __wbg___wbindgen_is_object_56732c2bc353f41d: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_2c56564c75129511: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_9bb1761122181af2: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_72bdf95d3ae505b1: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_8a89609d89f6608a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_60cf307fcc680536: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
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
        __wbg_from_d300fe49deab18f5: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_get_1f8f054ddbaa7db2: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_2b48c7d0d006a781: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_unchecked_33f6e5c9e2f2d6b2: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_8f49811467741499: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_86f30649f63ef9c2: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_67c2c9c4313f4448: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_iterator_8732428d309e270e: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_4a591ecaa01354d9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_66f1a4b2e9026940: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_7abca14930109c1c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_log_cf2e968649f3384e: function(arg0) {
            console.log(arg0);
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
        __wbg_new_d90091b82fdf5b91: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_next_9e03acdf51c4960d: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_eb8ca7351fa27906: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_prototypesetcall_3249fc62a0fafa30: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_prototypesetcall_6239d0967941c8d9: function(arg0, arg1, arg2) {
            Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), arg2);
        },
        __wbg_random_33cfffca5c784d5e: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_set_dca99999bba88a9a: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_f3625092ee4b37f4: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
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
        "./monovector_attention_wasm_bg.js": import0,
    };
}

const WasmAdamFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmadam_free(ptr, 1));
const WasmAdamWFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmadamw_free(ptr, 1));
const WasmFlashAttentionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmflashattention_free(ptr, 1));
const WasmHyperbolicAttentionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmhyperbolicattention_free(ptr, 1));
const WasmInfoNCELossFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasminfonceloss_free(ptr, 1));
const WasmLRSchedulerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlrscheduler_free(ptr, 1));
const WasmLinearAttentionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlinearattention_free(ptr, 1));
const WasmLocalGlobalAttentionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlocalglobalattention_free(ptr, 1));
const WasmMoEAttentionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmoeattention_free(ptr, 1));
const WasmMultiHeadAttentionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmultiheadattention_free(ptr, 1));
const WasmSGDFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsgd_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

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

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
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

const wasmPath = `${__dirname}/monovector_attention_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
