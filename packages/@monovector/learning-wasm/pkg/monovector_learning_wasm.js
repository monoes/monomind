/* @ts-self-types="./monovector_learning_wasm.d.ts" */

/**
 * WASM-exposed MicroLoRA engine
 */
class WasmMicroLoRA {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMicroLoRAFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmicrolora_free(ptr, 0);
    }
    /**
     * Adapt using input buffer as gradient
     */
    adapt() {
        wasm.wasmmicrolora_adapt(this.__wbg_ptr);
    }
    /**
     * Adapt with typed array gradient
     * @param {Float32Array} gradient
     */
    adapt_array(gradient) {
        const ptr0 = passArrayF32ToWasm0(gradient, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmmicrolora_adapt_array(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Get adaptation count
     * @returns {bigint}
     */
    adapt_count() {
        const ret = wasm.wasmmicrolora_adapt_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Adapt with improvement reward using input buffer as gradient
     * @param {number} improvement
     */
    adapt_with_reward(improvement) {
        wasm.wasmmicrolora_adapt_with_reward(this.__wbg_ptr, improvement);
    }
    /**
     * Get delta norm (weight change magnitude)
     * @returns {number}
     */
    delta_norm() {
        const ret = wasm.wasmmicrolora_delta_norm(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get embedding dimension
     * @returns {number}
     */
    dim() {
        const ret = wasm.wasmmicrolora_dim(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Forward pass using internal buffers (zero-allocation)
     *
     * Write input to get_input_ptr(), call forward(), read from get_output_ptr()
     */
    forward() {
        wasm.wasmmicrolora_forward(this.__wbg_ptr);
    }
    /**
     * Forward pass with typed array input (allocates output)
     * @param {Float32Array} input
     * @returns {Float32Array}
     */
    forward_array(input) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmicrolora_forward_array(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Get forward pass count
     * @returns {bigint}
     */
    forward_count() {
        const ret = wasm.wasmmicrolora_forward_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get pointer to input buffer for direct memory access
     * @returns {number}
     */
    get_input_ptr() {
        const ret = wasm.wasmmicrolora_get_input_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to output buffer for direct memory access
     * @returns {number}
     */
    get_output_ptr() {
        const ret = wasm.wasmmicrolora_get_output_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new MicroLoRA engine
     *
     * @param dim - Embedding dimension (default 256, max 256)
     * @param alpha - Scaling factor (default 0.1)
     * @param learning_rate - Learning rate (default 0.01)
     * @param {number | null} [dim]
     * @param {number | null} [alpha]
     * @param {number | null} [learning_rate]
     */
    constructor(dim, alpha, learning_rate) {
        const ret = wasm.wasmmicrolora_new(isLikeNone(dim) ? Number.MAX_SAFE_INTEGER : (dim) >>> 0, isLikeNone(alpha) ? Number.MAX_SAFE_INTEGER : Math.fround(alpha), isLikeNone(learning_rate) ? Number.MAX_SAFE_INTEGER : Math.fround(learning_rate));
        this.__wbg_ptr = ret;
        WasmMicroLoRAFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get parameter count
     * @returns {number}
     */
    param_count() {
        const ret = wasm.wasmmicrolora_param_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reset the engine
     */
    reset() {
        wasm.wasmmicrolora_reset(this.__wbg_ptr);
    }
}
if (Symbol.dispose) WasmMicroLoRA.prototype[Symbol.dispose] = WasmMicroLoRA.prototype.free;
exports.WasmMicroLoRA = WasmMicroLoRA;

/**
 * WASM-exposed Scoped LoRA manager
 */
class WasmScopedLoRA {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmScopedLoRAFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmscopedlora_free(ptr, 0);
    }
    /**
     * Adapt for operator type using input buffer as gradient
     * @param {number} op_type
     */
    adapt(op_type) {
        wasm.wasmscopedlora_adapt(this.__wbg_ptr, op_type);
    }
    /**
     * Adapt with typed array
     * @param {number} op_type
     * @param {Float32Array} gradient
     */
    adapt_array(op_type, gradient) {
        const ptr0 = passArrayF32ToWasm0(gradient, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmscopedlora_adapt_array(this.__wbg_ptr, op_type, ptr0, len0);
    }
    /**
     * Get adapt count for operator
     * @param {number} op_type
     * @returns {bigint}
     */
    adapt_count(op_type) {
        const ret = wasm.wasmscopedlora_adapt_count(this.__wbg_ptr, op_type);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Adapt with improvement reward
     * @param {number} op_type
     * @param {number} improvement
     */
    adapt_with_reward(op_type, improvement) {
        wasm.wasmscopedlora_adapt_with_reward(this.__wbg_ptr, op_type, improvement);
    }
    /**
     * Get delta norm for operator
     * @param {number} op_type
     * @returns {number}
     */
    delta_norm(op_type) {
        const ret = wasm.wasmscopedlora_delta_norm(this.__wbg_ptr, op_type);
        return ret;
    }
    /**
     * Forward pass for operator type (uses internal buffers)
     *
     * @param op_type - Operator type (0-16)
     * @param {number} op_type
     */
    forward(op_type) {
        wasm.wasmscopedlora_forward(this.__wbg_ptr, op_type);
    }
    /**
     * Forward pass with typed array
     * @param {number} op_type
     * @param {Float32Array} input
     * @returns {Float32Array}
     */
    forward_array(op_type, input) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmscopedlora_forward_array(this.__wbg_ptr, op_type, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Get forward count for operator
     * @param {number} op_type
     * @returns {bigint}
     */
    forward_count(op_type) {
        const ret = wasm.wasmscopedlora_forward_count(this.__wbg_ptr, op_type);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get input buffer pointer
     * @returns {number}
     */
    get_input_ptr() {
        const ret = wasm.wasmscopedlora_get_input_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get output buffer pointer
     * @returns {number}
     */
    get_output_ptr() {
        const ret = wasm.wasmscopedlora_get_output_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new scoped LoRA manager
     *
     * @param dim - Embedding dimension (max 256)
     * @param alpha - Scaling factor (default 0.1)
     * @param learning_rate - Learning rate (default 0.01)
     * @param {number | null} [dim]
     * @param {number | null} [alpha]
     * @param {number | null} [learning_rate]
     */
    constructor(dim, alpha, learning_rate) {
        const ret = wasm.wasmscopedlora_new(isLikeNone(dim) ? Number.MAX_SAFE_INTEGER : (dim) >>> 0, isLikeNone(alpha) ? Number.MAX_SAFE_INTEGER : Math.fround(alpha), isLikeNone(learning_rate) ? Number.MAX_SAFE_INTEGER : Math.fround(learning_rate));
        this.__wbg_ptr = ret;
        WasmScopedLoRAFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Reset all adapters
     */
    reset_all() {
        wasm.wasmscopedlora_reset_all(this.__wbg_ptr);
    }
    /**
     * Reset specific operator adapter
     * @param {number} op_type
     */
    reset_scope(op_type) {
        wasm.wasmscopedlora_reset_scope(this.__wbg_ptr, op_type);
    }
    /**
     * Get operator scope name
     * @param {number} op_type
     * @returns {string}
     */
    static scope_name(op_type) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmscopedlora_scope_name(op_type);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Enable/disable category fallback
     * @param {boolean} enabled
     */
    set_category_fallback(enabled) {
        wasm.wasmscopedlora_set_category_fallback(this.__wbg_ptr, enabled);
    }
    /**
     * Get total adapt count
     * @returns {bigint}
     */
    total_adapt_count() {
        const ret = wasm.wasmscopedlora_total_adapt_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get total forward count
     * @returns {bigint}
     */
    total_forward_count() {
        const ret = wasm.wasmscopedlora_total_forward_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
}
if (Symbol.dispose) WasmScopedLoRA.prototype[Symbol.dispose] = WasmScopedLoRA.prototype.free;
exports.WasmScopedLoRA = WasmScopedLoRA;

/**
 * WASM-exposed trajectory buffer
 */
class WasmTrajectoryBuffer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTrajectoryBufferFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtrajectorybuffer_free(ptr, 0);
    }
    /**
     * Get best attention type
     * @returns {number}
     */
    best_attention() {
        const ret = wasm.wasmtrajectorybuffer_best_attention(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get best improvement
     * @returns {number}
     */
    best_improvement() {
        const ret = wasm.wasmtrajectorybuffer_best_improvement(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get trajectory count for operator
     * @param {number} op_type
     * @returns {number}
     */
    count_by_operator(op_type) {
        const ret = wasm.wasmtrajectorybuffer_count_by_operator(this.__wbg_ptr, op_type);
        return ret >>> 0;
    }
    /**
     * Get high quality trajectory count
     * @param {number} threshold
     * @returns {number}
     */
    high_quality_count(threshold) {
        const ret = wasm.wasmtrajectorybuffer_high_quality_count(this.__wbg_ptr, threshold);
        return ret >>> 0;
    }
    /**
     * Check if empty
     * @returns {boolean}
     */
    is_empty() {
        const ret = wasm.wasmtrajectorybuffer_is_empty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Get buffer length
     * @returns {number}
     */
    len() {
        const ret = wasm.wasmtrajectorybuffer_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get mean improvement
     * @returns {number}
     */
    mean_improvement() {
        const ret = wasm.wasmtrajectorybuffer_mean_improvement(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create a new trajectory buffer
     *
     * @param capacity - Maximum number of trajectories to store
     * @param embedding_dim - Dimension of embeddings (default 256)
     * @param {number | null} [capacity]
     * @param {number | null} [embedding_dim]
     */
    constructor(capacity, embedding_dim) {
        const ret = wasm.wasmtrajectorybuffer_new(isLikeNone(capacity) ? Number.MAX_SAFE_INTEGER : (capacity) >>> 0, isLikeNone(embedding_dim) ? Number.MAX_SAFE_INTEGER : (embedding_dim) >>> 0);
        this.__wbg_ptr = ret;
        WasmTrajectoryBufferFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Record a trajectory
     *
     * @param embedding - Embedding vector (Float32Array)
     * @param op_type - Operator type (0-16)
     * @param attention_type - Attention mechanism used
     * @param execution_ms - Actual execution time
     * @param baseline_ms - Baseline execution time
     * @param {Float32Array} embedding
     * @param {number} op_type
     * @param {number} attention_type
     * @param {number} execution_ms
     * @param {number} baseline_ms
     */
    record(embedding, op_type, attention_type, execution_ms, baseline_ms) {
        const ptr0 = passArrayF32ToWasm0(embedding, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmtrajectorybuffer_record(this.__wbg_ptr, ptr0, len0, op_type, attention_type, execution_ms, baseline_ms);
    }
    /**
     * Reset buffer
     */
    reset() {
        wasm.wasmtrajectorybuffer_reset(this.__wbg_ptr);
    }
    /**
     * Get success rate
     * @returns {number}
     */
    success_rate() {
        const ret = wasm.wasmtrajectorybuffer_success_rate(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get total count
     * @returns {bigint}
     */
    total_count() {
        const ret = wasm.wasmtrajectorybuffer_total_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get variance
     * @returns {number}
     */
    variance() {
        const ret = wasm.wasmtrajectorybuffer_variance(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmTrajectoryBuffer.prototype[Symbol.dispose] = WasmTrajectoryBuffer.prototype.free;
exports.WasmTrajectoryBuffer = WasmTrajectoryBuffer;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
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
        "./monovector_learning_wasm_bg.js": import0,
    };
}

const WasmMicroLoRAFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmicrolora_free(ptr, 1));
const WasmScopedLoRAFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmscopedlora_free(ptr, 1));
const WasmTrajectoryBufferFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtrajectorybuffer_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/monovector_learning_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
