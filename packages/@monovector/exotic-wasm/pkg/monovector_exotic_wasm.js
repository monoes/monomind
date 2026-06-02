/* @ts-self-types="./monovector_exotic_wasm.d.ts" */

/**
 * Create a demonstration of all three exotic mechanisms working together
 */
class ExoticEcosystem {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ExoticEcosystemFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_exoticecosystem_free(ptr, 0);
    }
    /**
     * Get current cell count (from morphogenetic network)
     * @returns {number}
     */
    cellCount() {
        const ret = wasm.exoticecosystem_cellCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Crystallize the time crystal
     */
    crystallize() {
        wasm.exoticecosystem_crystallize(this.__wbg_ptr);
    }
    /**
     * Get current step
     * @returns {number}
     */
    currentStep() {
        const ret = wasm.exoticecosystem_currentStep(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Execute a proposal
     * @param {string} proposal_id
     * @returns {boolean}
     */
    execute(proposal_id) {
        const ptr0 = passStringToWasm0(proposal_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.exoticecosystem_execute(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Get current member count (from NAO)
     * @returns {number}
     */
    memberCount() {
        const ret = wasm.exoticecosystem_memberCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new exotic ecosystem with interconnected mechanisms
     * @param {number} agents
     * @param {number} grid_size
     * @param {number} oscillators
     */
    constructor(agents, grid_size, oscillators) {
        const ret = wasm.exoticecosystem_new(agents, grid_size, oscillators);
        this.__wbg_ptr = ret;
        ExoticEcosystemFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Propose an action in the NAO
     * @param {string} action
     * @returns {string}
     */
    propose(action) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(action, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.exoticecosystem_propose(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Advance all systems by one step
     */
    step() {
        wasm.exoticecosystem_step(this.__wbg_ptr);
    }
    /**
     * Get ecosystem summary as JSON
     * @returns {any}
     */
    summaryJson() {
        const ret = wasm.exoticecosystem_summaryJson(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get current synchronization level (from time crystal)
     * @returns {number}
     */
    synchronization() {
        const ret = wasm.exoticecosystem_synchronization(this.__wbg_ptr);
        return ret;
    }
    /**
     * Vote on a proposal
     * @param {string} proposal_id
     * @param {string} agent_id
     * @param {number} weight
     * @returns {boolean}
     */
    vote(proposal_id, agent_id, weight) {
        const ptr0 = passStringToWasm0(proposal_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.exoticecosystem_vote(this.__wbg_ptr, ptr0, len0, ptr1, len1, weight);
        return ret !== 0;
    }
}
if (Symbol.dispose) ExoticEcosystem.prototype[Symbol.dispose] = ExoticEcosystem.prototype.free;
exports.ExoticEcosystem = ExoticEcosystem;

/**
 * WASM-bindgen wrapper for MorphogeneticNetwork
 */
class WasmMorphogeneticNetwork {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMorphogeneticNetworkFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmorphogeneticnetwork_free(ptr, 0);
    }
    /**
     * Add a growth factor source
     * @param {number} x
     * @param {number} y
     * @param {string} name
     * @param {number} concentration
     */
    addGrowthSource(x, y, name, concentration) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmmorphogeneticnetwork_addGrowthSource(this.__wbg_ptr, x, y, ptr0, len0, concentration);
    }
    /**
     * Get cell count
     * @returns {number}
     */
    cellCount() {
        const ret = wasm.wasmmorphogeneticnetwork_cellCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get all cells as JSON
     * @returns {any}
     */
    cellsJson() {
        const ret = wasm.wasmmorphogeneticnetwork_cellsJson(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get compute cell count
     * @returns {number}
     */
    computeCount() {
        const ret = wasm.wasmmorphogeneticnetwork_computeCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get current tick
     * @returns {number}
     */
    currentTick() {
        const ret = wasm.wasmmorphogeneticnetwork_currentTick(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Differentiate stem cells
     */
    differentiate() {
        wasm.wasmmorphogeneticnetwork_differentiate(this.__wbg_ptr);
    }
    /**
     * Grow the network
     * @param {number} dt
     */
    grow(dt) {
        wasm.wasmmorphogeneticnetwork_grow(this.__wbg_ptr, dt);
    }
    /**
     * Create a new morphogenetic network
     * @param {number} width
     * @param {number} height
     */
    constructor(width, height) {
        const ret = wasm.wasmmorphogeneticnetwork_new(width, height);
        this.__wbg_ptr = ret;
        WasmMorphogeneticNetworkFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Prune weak connections and dead cells
     * @param {number} threshold
     */
    prune(threshold) {
        wasm.wasmmorphogeneticnetwork_prune(this.__wbg_ptr, threshold);
    }
    /**
     * Seed a signaling cell at position
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    seedSignaling(x, y) {
        const ret = wasm.wasmmorphogeneticnetwork_seedSignaling(this.__wbg_ptr, x, y);
        return ret >>> 0;
    }
    /**
     * Seed a stem cell at position
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    seedStem(x, y) {
        const ret = wasm.wasmmorphogeneticnetwork_seedStem(this.__wbg_ptr, x, y);
        return ret >>> 0;
    }
    /**
     * Get signaling cell count
     * @returns {number}
     */
    signalingCount() {
        const ret = wasm.wasmmorphogeneticnetwork_signalingCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get statistics as JSON
     * @returns {any}
     */
    statsJson() {
        const ret = wasm.wasmmorphogeneticnetwork_statsJson(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get stem cell count
     * @returns {number}
     */
    stemCount() {
        const ret = wasm.wasmmorphogeneticnetwork_stemCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmMorphogeneticNetwork.prototype[Symbol.dispose] = WasmMorphogeneticNetwork.prototype.free;
exports.WasmMorphogeneticNetwork = WasmMorphogeneticNetwork;

/**
 * WASM-bindgen wrapper for NeuralAutonomousOrg
 */
class WasmNAO {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmNAOFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmnao_free(ptr, 0);
    }
    /**
     * Get active proposal count
     * @returns {number}
     */
    activeProposalCount() {
        const ret = wasm.wasmnao_activeProposalCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Add a member agent with initial stake
     * @param {string} agent_id
     * @param {number} stake
     */
    addMember(agent_id, stake) {
        const ptr0 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmnao_addMember(this.__wbg_ptr, ptr0, len0, stake);
    }
    /**
     * Get coherence between two agents (0-1)
     * @param {string} agent_a
     * @param {string} agent_b
     * @returns {number}
     */
    agentCoherence(agent_a, agent_b) {
        const ptr0 = passStringToWasm0(agent_a, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agent_b, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmnao_agentCoherence(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * Get current tick
     * @returns {number}
     */
    currentTick() {
        const ret = wasm.wasmnao_currentTick(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Execute a proposal if consensus reached
     * @param {string} proposal_id
     * @returns {boolean}
     */
    execute(proposal_id) {
        const ptr0 = passStringToWasm0(proposal_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmnao_execute(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Get member count
     * @returns {number}
     */
    memberCount() {
        const ret = wasm.wasmnao_memberCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new NAO with the given quorum threshold (0.0 - 1.0)
     * @param {number} quorum_threshold
     */
    constructor(quorum_threshold) {
        const ret = wasm.wasmnao_new(quorum_threshold);
        this.__wbg_ptr = ret;
        WasmNAOFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Create a new proposal, returns proposal ID
     * @param {string} action
     * @returns {string}
     */
    propose(action) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(action, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmnao_propose(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Remove a member agent
     * @param {string} agent_id
     */
    removeMember(agent_id) {
        const ptr0 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmnao_removeMember(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Get current synchronization level (0-1)
     * @returns {number}
     */
    synchronization() {
        const ret = wasm.wasmnao_synchronization(this.__wbg_ptr);
        return ret;
    }
    /**
     * Advance simulation by one tick
     * @param {number} dt
     */
    tick(dt) {
        wasm.wasmnao_tick(this.__wbg_ptr, dt);
    }
    /**
     * Get all data as JSON
     * @returns {any}
     */
    toJson() {
        const ret = wasm.wasmnao_toJson(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get total voting power
     * @returns {number}
     */
    totalVotingPower() {
        const ret = wasm.wasmnao_totalVotingPower(this.__wbg_ptr);
        return ret;
    }
    /**
     * Vote on a proposal
     * @param {string} proposal_id
     * @param {string} agent_id
     * @param {number} weight
     * @returns {boolean}
     */
    vote(proposal_id, agent_id, weight) {
        const ptr0 = passStringToWasm0(proposal_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmnao_vote(this.__wbg_ptr, ptr0, len0, ptr1, len1, weight);
        return ret !== 0;
    }
}
if (Symbol.dispose) WasmNAO.prototype[Symbol.dispose] = WasmNAO.prototype.free;
exports.WasmNAO = WasmNAO;

/**
 * WASM-bindgen wrapper for TimeCrystal
 */
class WasmTimeCrystal {
    static __wrap(ptr) {
        const obj = Object.create(WasmTimeCrystal.prototype);
        obj.__wbg_ptr = ptr;
        WasmTimeCrystalFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTimeCrystalFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtimecrystal_free(ptr, 0);
    }
    /**
     * Get collective spin
     * @returns {number}
     */
    collectiveSpin() {
        const ret = wasm.wasmtimecrystal_collectiveSpin(this.__wbg_ptr);
        return ret;
    }
    /**
     * Crystallize to establish periodic order
     */
    crystallize() {
        wasm.wasmtimecrystal_crystallize(this.__wbg_ptr);
    }
    /**
     * Get current step
     * @returns {number}
     */
    currentStep() {
        const ret = wasm.wasmtimecrystal_currentStep(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Check if crystallized
     * @returns {boolean}
     */
    isCrystallized() {
        const ret = wasm.wasmtimecrystal_isCrystallized(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Create a new time crystal with n oscillators
     * @param {number} n
     * @param {number} period_ms
     */
    constructor(n, period_ms) {
        const ret = wasm.wasmtimecrystal_new(n, period_ms);
        this.__wbg_ptr = ret;
        WasmTimeCrystalFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get order parameter (synchronization level)
     * @returns {number}
     */
    orderParameter() {
        const ret = wasm.wasmtimecrystal_orderParameter(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get number of oscillators
     * @returns {number}
     */
    oscillatorCount() {
        const ret = wasm.wasmtimecrystal_oscillatorCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get current pattern type as string
     * @returns {string}
     */
    patternType() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtimecrystal_patternType(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get period in milliseconds
     * @returns {number}
     */
    periodMs() {
        const ret = wasm.wasmtimecrystal_periodMs(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Apply perturbation
     * @param {number} strength
     */
    perturb(strength) {
        wasm.wasmtimecrystal_perturb(this.__wbg_ptr, strength);
    }
    /**
     * Get phases as JSON array
     * @returns {any}
     */
    phasesJson() {
        const ret = wasm.wasmtimecrystal_phasesJson(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get robustness measure
     * @returns {number}
     */
    robustness() {
        const ret = wasm.wasmtimecrystal_robustness(this.__wbg_ptr);
        return ret;
    }
    /**
     * Set coupling strength
     * @param {number} coupling
     */
    setCoupling(coupling) {
        wasm.wasmtimecrystal_setCoupling(this.__wbg_ptr, coupling);
    }
    /**
     * Set disorder level
     * @param {number} disorder
     */
    setDisorder(disorder) {
        wasm.wasmtimecrystal_setDisorder(this.__wbg_ptr, disorder);
    }
    /**
     * Set driving strength
     * @param {number} strength
     */
    setDriving(strength) {
        wasm.wasmtimecrystal_setDriving(this.__wbg_ptr, strength);
    }
    /**
     * Get signals as JSON array
     * @returns {any}
     */
    signalsJson() {
        const ret = wasm.wasmtimecrystal_signalsJson(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Create a synchronized crystal
     * @param {number} n
     * @param {number} period_ms
     * @returns {WasmTimeCrystal}
     */
    static synchronized(n, period_ms) {
        const ret = wasm.wasmtimecrystal_synchronized(n, period_ms);
        return WasmTimeCrystal.__wrap(ret);
    }
    /**
     * Advance one tick, returns coordination pattern as Uint8Array
     * @returns {Uint8Array}
     */
    tick() {
        const ret = wasm.wasmtimecrystal_tick(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) WasmTimeCrystal.prototype[Symbol.dispose] = WasmTimeCrystal.prototype.free;
exports.WasmTimeCrystal = WasmTimeCrystal;

/**
 * Get information about available exotic mechanisms
 * @returns {any}
 */
function available_mechanisms() {
    const ret = wasm.available_mechanisms();
    return ret;
}
exports.available_mechanisms = available_mechanisms;

/**
 * Initialize the WASM module with panic hook
 */
function init() {
    wasm.init();
}
exports.init = init;

/**
 * Get the version of the ruvector-exotic-wasm crate
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
        __wbg___wbindgen_is_string_c236cabd84a4d769: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_67b456be8673d3d7: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_9c758de292015997: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_4a591ecaa01354d9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_622fc80556be2e26: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_ce1ab61c1c2b300d: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_d90091b82fdf5b91: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_with_length_36a4998e27b014c5: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_3249fc62a0fafa30: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_set_52b1e1eb5bed906a: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_dca99999bba88a9a: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
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
        __wbg_subarray_4aa221f6a4f5ab22: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
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
        "./monovector_exotic_wasm_bg.js": import0,
    };
}

const ExoticEcosystemFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_exoticecosystem_free(ptr, 1));
const WasmMorphogeneticNetworkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmorphogeneticnetwork_free(ptr, 1));
const WasmNAOFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmnao_free(ptr, 1));
const WasmTimeCrystalFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtimecrystal_free(ptr, 1));

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

const wasmPath = `${__dirname}/monovector_exotic_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
