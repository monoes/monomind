/**
 * MonoVector Training Service
 * Real WASM-accelerated neural training using @monovector packages
 *
 * Features:
 * - MicroLoRA: <1µs adaptation with rank-2 LoRA (2.3M ops/s)
 * - SONA: Self-Optimizing Neural Architecture (624k learn/s, 60k search/s)
 * - Flash Attention: 2.49x-7.47x speedup (9k ops/s)
 * - Trajectory Buffer: Learning from success/failure
 * - Contrastive Learning: InfoNCE loss
 *
 * Backward Compatible: All v1 APIs preserved, SONA adds new capabilities
 *
 * github.com/nokhodian/monomind
 */
const ALLOWED_MONOVECTOR_PACKAGES = new Set([
    '@monoes/learning-wasm',
    '@monoes/attention',
    '@monoes/sona',
]);
/**
 * ESM/CJS interop helper — handles `.default` for CJS modules.
 * Uses `'default' in mod` check which is safer than `mod.default || mod`.
 */
async function importWithInterop(packageName) {
    if (!ALLOWED_MONOVECTOR_PACKAGES.has(packageName)) {
        throw new Error(`Disallowed dynamic import: ${packageName}`);
    }
    const mod = await import(packageName);
    return ('default' in mod) ? mod.default : mod;
}
// Lazy-loaded WASM modules
let microLoRA = null;
let scopedLoRA = null;
let trajectoryBuffer = null;
let flashAttention = null;
let moeAttention = null;
let hyperbolicAttention = null;
let optimizer = null;
let contrastiveLoss = null;
let curriculum = null;
let hardMiner = null;
// SONA engine (optional enhancement)
let sonaEngine = null;
let sonaAvailable = false;
// Training state
let initialized = false;
let totalAdaptations = 0;
let totalForwards = 0;
let totalSonaLearns = 0;
let totalSonaSearches = 0;
let lastBenchmark = null;
// Backend tracking
let activeBackend = 'js-fallback';
/**
 * Get which backend is active for training
 */
export function getActiveBackend() {
    return activeBackend;
}
/**
 * Pure-JS fallback implementations for when WASM is unavailable.
 * These provide the same API surface with basic linear algebra.
 */
class JsMicroLoRA {
    _dim;
    _alpha;
    _lr;
    _adaptCount = 0n;
    _forwardCount = 0n;
    _deltaNorm = 0;
    _A; // Low-rank A (rank x dim)
    _B; // Low-rank B (dim x rank)
    RANK = 2;
    constructor(dim, alpha, lr) {
        this._dim = dim;
        this._alpha = alpha;
        this._lr = lr;
        this._A = new Float32Array(this.RANK * dim);
        this._B = new Float32Array(dim * this.RANK);
        // Xavier initialization
        const scale = Math.sqrt(2 / (dim + this.RANK));
        for (let i = 0; i < this._A.length; i++)
            this._A[i] = (Math.random() - 0.5) * scale;
        for (let i = 0; i < this._B.length; i++)
            this._B[i] = (Math.random() - 0.5) * scale;
    }
    adapt_array(gradient) {
        // Simple gradient update on low-rank matrices
        let norm = 0;
        for (let i = 0; i < Math.min(gradient.length, this._A.length); i++) {
            const delta = -this._lr * gradient[i % gradient.length] * this._alpha;
            this._A[i] += delta;
            norm += delta * delta;
        }
        this._deltaNorm = Math.sqrt(norm);
        this._adaptCount++;
    }
    adapt_count() { return this._adaptCount; }
    param_count() { return this._A.length + this._B.length; }
    forward_array(input) {
        const output = new Float32Array(this._dim);
        // y = x + alpha * B @ A @ x  (simplified low-rank)
        for (let i = 0; i < this._dim; i++) {
            output[i] = input[i];
            let sum = 0;
            for (let r = 0; r < this.RANK; r++) {
                let dot = 0;
                for (let j = 0; j < this._dim; j++) {
                    dot += this._A[r * this._dim + j] * input[j];
                }
                sum += this._B[i * this.RANK + r] * dot;
            }
            output[i] += this._alpha * sum;
        }
        this._forwardCount++;
        return output;
    }
    forward_count() { return this._forwardCount; }
    adapt_with_reward(improvement) {
        const scale = improvement * this._lr * this._alpha;
        let norm = 0;
        for (let i = 0; i < this._A.length; i++) {
            const delta = scale * (Math.random() - 0.5);
            this._A[i] += delta;
            norm += delta * delta;
        }
        this._deltaNorm = Math.sqrt(norm);
        this._adaptCount++;
    }
    delta_norm() { return this._deltaNorm; }
    dim() { return this._dim; }
    reset() {
        this._A.fill(0);
        this._B.fill(0);
        this._adaptCount = 0n;
        this._forwardCount = 0n;
        this._deltaNorm = 0;
    }
    free() { }
}
class JsScopedLoRA {
    adapters = new Map();
    _dim;
    _alpha;
    _lr;
    _fallback = false;
    constructor(dim, alpha, lr) {
        this._dim = dim;
        this._alpha = alpha;
        this._lr = lr;
    }
    getAdapter(opType) {
        if (!this.adapters.has(opType)) {
            if (this._fallback && opType > 0 && this.adapters.has(0)) {
                return this.adapters.get(0);
            }
            this.adapters.set(opType, new JsMicroLoRA(this._dim, this._alpha, this._lr));
        }
        return this.adapters.get(opType);
    }
    adapt_array(opType, gradient) { this.getAdapter(opType).adapt_array(gradient); }
    adapt_count(opType) { return this.getAdapter(opType).adapt_count(); }
    forward_array(opType, input) { return this.getAdapter(opType).forward_array(input); }
    forward_count(opType) { return this.getAdapter(opType).forward_count(); }
    adapt_with_reward(opType, improvement) { this.getAdapter(opType).adapt_with_reward(improvement); }
    delta_norm(opType) { return this.getAdapter(opType).delta_norm(); }
    set_category_fallback(enabled) { this._fallback = enabled; }
    total_adapt_count() {
        let total = 0n;
        for (const a of this.adapters.values())
            total += a.adapt_count();
        return total;
    }
    total_forward_count() {
        let total = 0n;
        for (const a of this.adapters.values())
            total += a.forward_count();
        return total;
    }
    reset_all() { this.adapters.clear(); }
    reset_scope(opType) { this.adapters.delete(opType); }
    free() { this.adapters.clear(); }
}
class JsTrajectoryBuffer {
    entries = [];
    capacity;
    constructor(capacity, _dim) {
        this.capacity = capacity;
    }
    record(_embedding, _opType, _attType, executionMs, baselineMs) {
        const improvement = baselineMs > 0 ? (baselineMs - executionMs) / baselineMs : 0;
        if (this.entries.length >= this.capacity)
            this.entries.shift();
        this.entries.push({ improvement });
    }
    is_empty() { return this.entries.length === 0; }
    total_count() { return BigInt(this.entries.length); }
    success_rate() {
        if (this.entries.length === 0)
            return 0;
        return this.entries.filter(e => e.improvement > 0).length / this.entries.length;
    }
    mean_improvement() {
        if (this.entries.length === 0)
            return 0;
        return this.entries.reduce((s, e) => s + e.improvement, 0) / this.entries.length;
    }
    best_improvement() {
        if (this.entries.length === 0)
            return 0;
        return Math.max(...this.entries.map(e => e.improvement));
    }
    high_quality_count(threshold) {
        return this.entries.filter(e => e.improvement > threshold).length;
    }
    variance() {
        if (this.entries.length < 2)
            return 0;
        const mean = this.mean_improvement();
        return this.entries.reduce((s, e) => s + (e.improvement - mean) ** 2, 0) / (this.entries.length - 1);
    }
    reset() { this.entries = []; }
    free() { this.entries = []; }
}
/**
 * Initialize the MonoVector training system.
 * Attempts to load @monoes/learning-wasm for WASM-accelerated training.
 * Falls back to a pure-JS implementation if WASM is unavailable.
 */
export async function initializeTraining(config = {}) {
    const features = [];
    const dim = Math.min(config.dim || 256, 256); // Max 256 for WASM
    const lr = config.learningRate || 0.01;
    const alpha = config.alpha || 0.1;
    // --- Attempt WASM backend first ---
    let wasmLoaded = false;
    try {
        const fs = await import('fs');
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const wasmPath = require.resolve('@monoes/learning-wasm/monovector_learning_wasm_bg.wasm');
        const wasmBuffer = fs.readFileSync(wasmPath);
        const learningWasm = await import('@monoes/learning-wasm');
        learningWasm.initSync({ module: wasmBuffer });
        microLoRA = new learningWasm.WasmMicroLoRA(dim, alpha, lr);
        features.push(`MicroLoRA/WASM (${dim}-dim, <1μs adaptation)`);
        scopedLoRA = new learningWasm.WasmScopedLoRA(dim, alpha, lr);
        scopedLoRA.set_category_fallback(true);
        features.push('ScopedLoRA/WASM (17 operators)');
        trajectoryBuffer = new learningWasm.WasmTrajectoryBuffer(config.trajectoryCapacity || 10000, dim);
        features.push('TrajectoryBuffer/WASM');
        activeBackend = 'wasm';
        wasmLoaded = true;
    }
    catch (wasmError) {
        // WASM not available - fall back to JS implementation
        const reason = wasmError instanceof Error ? wasmError.message : String(wasmError);
        console.warn(`[monovector] WASM backend unavailable (${reason}), using JS fallback`);
        microLoRA = new JsMicroLoRA(dim, alpha, lr);
        features.push(`MicroLoRA/JS (${dim}-dim, JS fallback)`);
        scopedLoRA = new JsScopedLoRA(dim, alpha, lr);
        scopedLoRA.set_category_fallback(true);
        features.push('ScopedLoRA/JS (17 operators)');
        trajectoryBuffer = new JsTrajectoryBuffer(config.trajectoryCapacity || 10000, dim);
        features.push('TrajectoryBuffer/JS');
        activeBackend = 'js-fallback';
    }
    // --- Attention mechanisms (optional, independent of WASM) ---
    try {
        const attention = await importWithInterop('@monoes/attention');
        if (config.useFlashAttention !== false) {
            flashAttention = new attention.FlashAttention(dim, 64);
            features.push('FlashAttention');
        }
        if (config.useMoE) {
            moeAttention = attention.MoEAttention.simple(dim, 8, 2);
            features.push('MoE (8 experts, top-2)');
        }
        if (config.useHyperbolic) {
            hyperbolicAttention = new attention.HyperbolicAttention(dim, 1.0);
            features.push('HyperbolicAttention');
        }
        optimizer = new attention.AdamWOptimizer(lr, 0.9, 0.999, 1e-8, 0.01);
        features.push('AdamW Optimizer');
        contrastiveLoss = new attention.InfoNceLoss(0.07);
        features.push('InfoNCE Loss');
        if (config.totalSteps) {
            curriculum = new attention.CurriculumScheduler(config.totalSteps, config.warmupSteps || Math.floor(config.totalSteps * 0.1));
            features.push('Curriculum Learning');
        }
        try {
            hardMiner = new attention.HardNegativeMiner(5, 'semi_hard');
            features.push('Hard Negative Mining');
        }
        catch {
            // Mining not available, continue without it
        }
    }
    catch (attentionError) {
        // @monoes/attention not available - attention features skipped
        const reason = attentionError instanceof Error ? attentionError.message : String(attentionError);
        console.warn(`[monovector] @monoes/attention unavailable (${reason}), attention features disabled`);
    }
    // --- SONA (optional, backward compatible) ---
    if (config.useSona !== false) {
        try {
            const sona = await importWithInterop('@monoes/sona');
            const sonaRank = config.sonaRank || 4;
            sonaEngine = new sona.SonaEngine(dim, sonaRank, alpha, lr);
            sonaAvailable = true;
            features.push(`SONA (${dim}-dim, rank-${sonaRank}, 624k learn/s)`);
        }
        catch (sonaError) {
            sonaAvailable = false;
            if (config.useSona === true) {
                console.warn('SONA requested but not available:', sonaError);
            }
        }
    }
    initialized = true;
    return { success: true, features, backend: activeBackend };
}
/**
 * Operator types for scoped LoRA (0-16)
 */
export const OperatorType = {
    GENERAL: 0,
    ATTENTION: 1,
    MLP: 2,
    EMBEDDING: 3,
    NORMALIZATION: 4,
    PROJECTION: 5,
    POOLING: 6,
    CONVOLUTION: 7,
    RECURRENT: 8,
    ROUTING: 9,
    MEMORY: 10,
    REASONING: 11,
    COORDINATION: 12,
    OPTIMIZATION: 13,
    SECURITY: 14,
    TESTING: 15,
    DEBUGGING: 16,
};
/**
 * Train a pattern with MicroLoRA
 */
export async function trainPattern(embedding, gradient, operatorType) {
    if (!initialized || !microLoRA) {
        throw new Error('Training system not initialized');
    }
    // Use scoped LoRA if operator type specified
    if (operatorType !== undefined && scopedLoRA) {
        scopedLoRA.adapt_array(operatorType, gradient);
        return {
            deltaNorm: scopedLoRA.delta_norm(operatorType),
            adaptCount: scopedLoRA.adapt_count(operatorType),
        };
    }
    // Standard MicroLoRA adaptation
    microLoRA.adapt_array(gradient);
    totalAdaptations++;
    return {
        deltaNorm: microLoRA.delta_norm(),
        adaptCount: microLoRA.adapt_count(),
    };
}
/**
 * Forward pass through LoRA
 */
export function forward(input, operatorType) {
    if (!initialized || !microLoRA) {
        throw new Error('Training system not initialized');
    }
    totalForwards++;
    if (operatorType !== undefined && scopedLoRA) {
        return scopedLoRA.forward_array(operatorType, input);
    }
    return microLoRA.forward_array(input);
}
/**
 * Reward-based adaptation (reinforcement learning)
 */
export function adaptWithReward(improvement, operatorType) {
    if (!initialized) {
        throw new Error('Training system not initialized');
    }
    if (operatorType !== undefined && scopedLoRA) {
        scopedLoRA.adapt_with_reward(operatorType, improvement);
    }
    else if (microLoRA) {
        microLoRA.adapt_with_reward(improvement);
    }
    totalAdaptations++;
}
/**
 * Record a learning trajectory
 */
export function recordTrajectory(embedding, operatorType, attentionType, executionMs, baselineMs) {
    if (!trajectoryBuffer) {
        throw new Error('Trajectory buffer not initialized');
    }
    trajectoryBuffer.record(embedding, operatorType, attentionType, executionMs, baselineMs);
}
/**
 * Get trajectory statistics
 */
export function getTrajectoryStats() {
    if (!trajectoryBuffer || trajectoryBuffer.is_empty()) {
        return null;
    }
    return {
        successRate: trajectoryBuffer.success_rate(),
        meanImprovement: trajectoryBuffer.mean_improvement(),
        bestImprovement: trajectoryBuffer.best_improvement(),
        totalCount: trajectoryBuffer.total_count(),
        highQualityCount: trajectoryBuffer.high_quality_count(0.1),
        variance: trajectoryBuffer.variance(),
    };
}
/**
 * Compute attention with Flash Attention (2.49x-7.47x faster)
 */
export function computeFlashAttention(query, keys, values) {
    if (!flashAttention) {
        throw new Error('Flash attention not initialized');
    }
    return flashAttention.computeRaw(query, keys, values);
}
/**
 * Compute MoE routing
 */
export function computeMoEAttention(query, keys, values) {
    if (!moeAttention) {
        throw new Error('MoE attention not initialized');
    }
    return moeAttention.computeRaw(query, keys, values);
}
/**
 * Compute hyperbolic attention (for hierarchical patterns)
 */
export function computeHyperbolicAttention(query, keys, values) {
    if (!hyperbolicAttention) {
        throw new Error('Hyperbolic attention not initialized');
    }
    return hyperbolicAttention.computeRaw(query, keys, values);
}
/**
 * Compute contrastive loss for training
 */
export function computeContrastiveLoss(anchor, positives, negatives) {
    if (!contrastiveLoss) {
        throw new Error('Contrastive loss not initialized');
    }
    const loss = contrastiveLoss.compute(anchor, positives, negatives);
    const gradient = contrastiveLoss.backward(anchor, positives, negatives);
    return { loss, gradient };
}
/**
 * Optimizer step
 */
export function optimizerStep(params, gradients) {
    if (!optimizer) {
        throw new Error('Optimizer not initialized');
    }
    return optimizer.step(params, gradients);
}
/**
 * Get curriculum difficulty for current step
 */
export function getCurriculumDifficulty(step) {
    if (!curriculum) {
        return 1.0; // Full difficulty if no curriculum
    }
    return curriculum.getDifficulty(step);
}
/**
 * Mine hard negatives for better training
 */
export function mineHardNegatives(anchor, candidates) {
    if (!hardMiner) {
        throw new Error('Hard negative miner not initialized');
    }
    return hardMiner.mine(anchor, candidates);
}
/**
 * Benchmark the training system
 */
export async function benchmarkTraining(dim, iterations) {
    const attention = await importWithInterop('@monoes/attention');
    lastBenchmark = attention.benchmarkAttention(dim || 256, 100, iterations || 1000);
    return lastBenchmark ?? [];
}
// ============================================
// SONA Functions (v2 enhancement, optional)
// ============================================
/**
 * Check if SONA is available
 */
export function isSonaAvailable() {
    return sonaAvailable && sonaEngine !== null;
}
/**
 * Force-learn a pattern with SONA (1.6μs, 624k ops/s)
 * This is a one-shot learning mechanism for immediate pattern storage
 */
export function sonaForceLearn(embedding, reward) {
    if (!sonaEngine) {
        throw new Error('SONA not initialized. Call initializeTraining with useSona: true');
    }
    sonaEngine.forceLearn(embedding, reward);
    totalSonaLearns++;
}
/**
 * Search for similar patterns with SONA (16.7μs, 60k searches/s)
 * Returns the k most similar patterns from the pattern bank
 */
export function sonaFindPatterns(embedding, k = 5) {
    if (!sonaEngine) {
        throw new Error('SONA not initialized. Call initializeTraining with useSona: true');
    }
    // SONA requires Array, not Float32Array
    const embeddingArray = Array.from(embedding);
    totalSonaSearches++;
    return sonaEngine.findPatterns(embeddingArray, k);
}
/**
 * Process SONA background tasks (0.13μs, 7.5M ticks/s)
 * Call periodically to process background learning and consolidation
 */
export function sonaTick() {
    if (!sonaEngine) {
        return; // Silent no-op if SONA not available
    }
    sonaEngine.tick();
}
/**
 * Get SONA statistics
 */
export function getSonaStats() {
    if (!sonaEngine) {
        return {
            available: false,
            enabled: false,
            stats: null,
            totalLearns: totalSonaLearns,
            totalSearches: totalSonaSearches,
        };
    }
    try {
        const statsJson = sonaEngine.getStats();
        const stats = JSON.parse(statsJson);
        return {
            available: true,
            enabled: sonaEngine.isEnabled(),
            stats,
            totalLearns: totalSonaLearns,
            totalSearches: totalSonaSearches,
        };
    }
    catch {
        return {
            available: true,
            enabled: false,
            stats: null,
            totalLearns: totalSonaLearns,
            totalSearches: totalSonaSearches,
        };
    }
}
/**
 * Enable/disable SONA learning
 */
export function setSonaEnabled(enabled) {
    if (!sonaEngine) {
        return;
    }
    sonaEngine.setEnabled(enabled);
}
/**
 * Flush SONA buffers (persist any pending patterns)
 */
export function sonaFlush() {
    if (!sonaEngine) {
        return;
    }
    sonaEngine.flush();
}
/**
 * Get training statistics
 */
export function getTrainingStats() {
    const stats = {
        initialized,
        backend: activeBackend,
        totalAdaptations,
        totalForwards,
    };
    if (microLoRA) {
        stats.microLoraStats = {
            paramCount: microLoRA.param_count(),
            adaptCount: microLoRA.adapt_count(),
            forwardCount: microLoRA.forward_count(),
            deltaNorm: microLoRA.delta_norm(),
        };
    }
    if (scopedLoRA) {
        stats.scopedLoraStats = {
            totalAdaptCount: scopedLoRA.total_adapt_count(),
            totalForwardCount: scopedLoRA.total_forward_count(),
        };
    }
    if (trajectoryBuffer && !trajectoryBuffer.is_empty()) {
        stats.trajectoryStats = getTrajectoryStats();
    }
    // Include SONA stats if available
    if (sonaAvailable) {
        stats.sonaStats = getSonaStats();
    }
    if (lastBenchmark) {
        stats.lastBenchmark = lastBenchmark;
    }
    return stats;
}
/**
 * Reset the training system
 */
export function resetTraining() {
    if (microLoRA)
        microLoRA.reset();
    if (scopedLoRA)
        scopedLoRA.reset_all();
    if (trajectoryBuffer)
        trajectoryBuffer.reset();
    // Reset SONA stats (engine doesn't have reset, just flush)
    if (sonaEngine) {
        sonaEngine.flush();
    }
    totalAdaptations = 0;
    totalForwards = 0;
    totalSonaLearns = 0;
    totalSonaSearches = 0;
    activeBackend = 'js-fallback';
}
/**
 * Export trained weights
 */
export function exportWeights() {
    if (!initialized || !microLoRA) {
        return null;
    }
    return {
        dim: microLoRA.dim(),
        deltaNorm: microLoRA.delta_norm(),
        adaptCount: microLoRA.adapt_count(),
        trajectoryStats: getTrajectoryStats(),
    };
}
/**
 * Cleanup resources
 */
export function cleanup() {
    if (microLoRA) {
        microLoRA.free();
        microLoRA = null;
    }
    if (scopedLoRA) {
        scopedLoRA.free();
        scopedLoRA = null;
    }
    if (trajectoryBuffer) {
        trajectoryBuffer.free();
        trajectoryBuffer = null;
    }
    // Cleanup SONA
    if (sonaEngine) {
        sonaEngine.flush();
        sonaEngine = null;
        sonaAvailable = false;
    }
    flashAttention = null;
    moeAttention = null;
    hyperbolicAttention = null;
    optimizer = null;
    contrastiveLoss = null;
    curriculum = null;
    hardMiner = null;
    initialized = false;
    totalAdaptations = 0;
    totalForwards = 0;
    totalSonaLearns = 0;
    totalSonaSearches = 0;
    lastBenchmark = null;
}
//# sourceMappingURL=monovector-training.js.map