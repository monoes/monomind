/**
 * WASM Kernel Host Bridge
 *
 * Layer B: Node host runtime that calls into the Rust WASM kernel (Layer A).
 * All WASM calls go through this bridge. If the WASM module fails to load,
 * the bridge transparently falls back to the JavaScript implementations.
 *
 * Key rule: The host calls the kernel once per event with a batch payload,
 * not thousands of tiny calls.
 *
 * @module @monobrain/guidance/wasm-kernel
 */
export interface WasmKernel {
    /** Whether the WASM kernel is loaded (false = JS fallback) */
    readonly available: boolean;
    /** Kernel version string (or 'js-fallback') */
    readonly version: string;
    sha256(input: string): string;
    hmacSha256(key: string, input: string): string;
    contentHash(jsonInput: string): string;
    signEnvelope(key: string, envelopeJson: string): string;
    verifyChain(chainJson: string, key: string): boolean;
    scanSecrets(content: string): string[];
    detectDestructive(command: string): string | null;
    batchProcess(ops: BatchOp[]): BatchResult[];
}
export interface BatchOp {
    op: string;
    payload: string;
    key?: string;
}
export interface BatchResult {
    [key: string]: unknown;
}
/**
 * Get the WASM kernel instance. Automatically falls back to JS if WASM is
 * unavailable. Thread-safe (single initialization).
 */
export declare function getKernel(): WasmKernel;
/**
 * Check if the WASM kernel is available without initializing it.
 */
export declare function isWasmAvailable(): boolean;
/**
 * Reset the kernel instance (for testing).
 */
export declare function resetKernel(): void;
//# sourceMappingURL=wasm-kernel.d.ts.map