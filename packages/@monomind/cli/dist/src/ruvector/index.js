/**
 * RuVector Integration Module for Monomind CLI
 *
 * Provides integration with @ruvector packages for:
 * - Q-Learning based task routing
 * - Mixture of Experts (MoE) routing
 * - AST code analysis
 * - Diff classification
 * - Coverage-based routing
 * - Graph boundary analysis
 * - Flash Attention for faster similarity computations
 *
 * @module @monomind/cli/ruvector
 */
export { DiffClassifier, createDiffClassifier, analyzeDiff, analyzeDiffSync, assessFileRisk, assessOverallRisk, classifyDiff, suggestReviewers, getGitDiffNumstat, getGitDiffNumstatAsync, clearDiffCache, clearAllDiffCaches, } from './diff-classifier.js';
// ── RuVector LLM WASM (inference utilities) ─────────────────
export { isRuvllmWasmAvailable, initRuvllmWasm, getRuvllmStatus, createHnswRouter, createSonaInstant, createMicroLora, formatChat, createKvCache, createGenerateConfig, createBufferPool, createInferenceArena, HNSW_MAX_SAFE_PATTERNS, } from './ruvllm-wasm.js';
// ── Agent WASM (sandboxed agent runtime) ────────────────────
export { isAgentWasmAvailable, initAgentWasm, createWasmAgent, promptWasmAgent, executeWasmTool, getWasmAgent, listWasmAgents, terminateWasmAgent, getWasmAgentState, getWasmAgentTools, getWasmAgentTodos, exportWasmState, createWasmMcpServer, listGalleryTemplates, getGalleryCount, getGalleryCategories, searchGalleryTemplates, getGalleryTemplate, createAgentFromTemplate, buildRvfContainer, buildRvfFromTemplate, } from './agent-wasm.js';
/**
 * Check if ruvector packages are available
 */
export async function isRuvectorAvailable() {
    try {
        // @ts-expect-error optional peer dependency
        await import('@ruvector/core');
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if @ruvector/learning-wasm is available and loadable
 */
export async function isWasmBackendAvailable() {
    try {
        const wasm = await import('@ruvector/learning-wasm');
        return typeof wasm.WasmMicroLoRA === 'function' && typeof wasm.initSync === 'function';
    }
    catch {
        return false;
    }
}
/**
 * Get ruvector version if available
 */
export async function getRuvectorVersion() {
    try {
        // @ts-expect-error optional peer dependency
        const ruvector = await import('@ruvector/core');
        return ruvector.version || '1.0.0';
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=index.js.map