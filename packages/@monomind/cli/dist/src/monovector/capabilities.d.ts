/**
 * Capability surface for the (removed) @monoes/* native learning packages.
 *
 * Lean teardown: the SONA / native / WASM learning layer (@monoes/sona, router,
 * attention, learning-wasm, core, and @monomind/monovector-upstream) has been
 * removed. This module is now a stub that always reports "nothing native is
 * available", so every caller takes the pure-JS / keyword-routing path. The
 * function and type surface is preserved so importers (index.ts, hooks-tools.ts,
 * doctor.ts, neural.ts) keep compiling without change.
 */
export interface MonoesCapabilities {
    /** @monoes/sona SonaEngine available — always false after teardown */
    sona: boolean;
    /** @monoes/router backend — always 'none' after teardown */
    router: 'native' | 'js' | 'none';
    /** @monoes/attention FlashAttention available — always false after teardown */
    attention: boolean;
    /** @monoes/learning-wasm WasmMicroLoRA available — always false after teardown */
    learningWasm: boolean;
    /** @monomind/monovector-upstream plugin loaded — always false after teardown */
    upstreamPlugin: boolean;
}
/**
 * Returns the stubbed capability surface — all native backends report absent.
 * Async to preserve the original signature; callers `await` this everywhere.
 */
export declare function getCapabilities(): Promise<MonoesCapabilities>;
/** Synchronous read of the (constant) capability surface. */
export declare function getCachedCapabilities(): MonoesCapabilities | null;
/** No-op after teardown — there is nothing to re-probe. */
export declare function resetCapabilitiesCache(): void;
/** Returns the stubbed capability surface — kept for API compatibility. */
export declare function refreshCapabilities(): Promise<MonoesCapabilities>;
//# sourceMappingURL=capabilities.d.ts.map