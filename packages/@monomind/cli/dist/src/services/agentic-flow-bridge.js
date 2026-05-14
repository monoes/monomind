/**
 * agentic-flow v1 integration bridge
 *
 * Provides a single lazy-loading entry point for all agentic-flow v1
 * subpath exports. Every accessor returns `null` when agentic-flow is
 * not installed — callers never throw on missing optional dependency.
 *
 * @module agentic-flow-bridge
 */
// ---------------------------------------------------------------------------
// Cached module handles (Promise-based to prevent TOCTOU races)
// ---------------------------------------------------------------------------
let _reasoningBankP = null;
let _routerP = null;
let _orchestrationP = null;
// ---------------------------------------------------------------------------
// Public loaders
// ---------------------------------------------------------------------------
/**
 * Load the ReasoningBank module (4-step learning pipeline).
 * Returns null if agentic-flow is not installed.
 * Race-safe: concurrent callers share the same import Promise.
 */
export function getReasoningBank() {
    if (_reasoningBankP === null) {
        _reasoningBankP = import('agentic-flow/reasoningbank').catch(() => null);
    }
    return _reasoningBankP;
}
/**
 * Load the ModelRouter module (multi-provider LLM routing).
 * Returns null if agentic-flow is not installed.
 */
export function getRouter() {
    if (_routerP === null) {
        _routerP = import('agentic-flow/router').catch(() => null);
    }
    return _routerP;
}
/**
 * Load the Orchestration module (workflow engine).
 * Returns null if agentic-flow is not installed.
 */
export function getOrchestration() {
    if (_orchestrationP === null) {
        _orchestrationP = import('agentic-flow/orchestration').catch(() => null);
    }
    return _orchestrationP;
}
// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------
/**
 * Compute an embedding vector via ReasoningBank, falling back to null.
 */
export async function computeEmbedding(text) {
    const rb = await getReasoningBank();
    if (!rb?.computeEmbedding)
        return null;
    return rb.computeEmbedding(text);
}
/**
 * Retrieve memories matching a query via ReasoningBank.
 */
export async function retrieveMemories(query, opts) {
    const rb = await getReasoningBank();
    if (!rb?.retrieveMemories)
        return [];
    return rb.retrieveMemories(query, opts);
}
/**
 * Check whether agentic-flow v1 is available at runtime.
 */
export async function isAvailable() {
    const rb = await getReasoningBank();
    return rb !== null;
}
/**
 * Return a summary of available agentic-flow v1 capabilities.
 */
export async function capabilities() {
    const [rb, router, orch] = await Promise.all([
        getReasoningBank(),
        getRouter(),
        getOrchestration(),
    ]);
    return {
        available: rb !== null || router !== null || orch !== null,
        reasoningBank: rb !== null,
        router: router !== null,
        orchestration: orch !== null,
        version: rb?.VERSION ?? null,
    };
}
//# sourceMappingURL=agentic-flow-bridge.js.map