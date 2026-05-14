/**
 * agentic-flow v1 integration bridge
 *
 * Provides a single lazy-loading entry point for all agentic-flow v1
 * subpath exports. Every accessor returns `null` when agentic-flow is
 * not installed — callers never throw on missing optional dependency.
 *
 * @module agentic-flow-bridge
 */
/**
 * Load the ReasoningBank module (4-step learning pipeline).
 * Returns null if agentic-flow is not installed.
 * Race-safe: concurrent callers share the same import Promise.
 */
export declare function getReasoningBank(): Promise<typeof import("agentic-flow/reasoningbank") | null>;
/**
 * Load the ModelRouter module (multi-provider LLM routing).
 * Returns null if agentic-flow is not installed.
 */
export declare function getRouter(): Promise<typeof import("agentic-flow/router") | null>;
/**
 * Load the Orchestration module (workflow engine).
 * Returns null if agentic-flow is not installed.
 */
export declare function getOrchestration(): Promise<typeof import("agentic-flow/orchestration") | null>;
/**
 * Compute an embedding vector via ReasoningBank, falling back to null.
 */
export declare function computeEmbedding(text: string): Promise<number[] | null>;
/**
 * Retrieve memories matching a query via ReasoningBank.
 */
export declare function retrieveMemories(query: string, opts?: {
    k?: number;
}): Promise<any[]>;
/**
 * Check whether agentic-flow v1 is available at runtime.
 */
export declare function isAvailable(): Promise<boolean>;
/**
 * Return a summary of available agentic-flow v1 capabilities.
 */
export declare function capabilities(): Promise<{
    available: boolean;
    reasoningBank: boolean;
    router: boolean;
    orchestration: boolean;
    version: string | null;
}>;
//# sourceMappingURL=agentic-flow-bridge.d.ts.map