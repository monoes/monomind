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
const STUB_CAPABILITIES = {
    sona: false,
    router: 'none',
    attention: false,
    learningWasm: false,
    upstreamPlugin: false,
};
/**
 * Returns the stubbed capability surface — all native backends report absent.
 * Async to preserve the original signature; callers `await` this everywhere.
 */
export async function getCapabilities() {
    return STUB_CAPABILITIES;
}
/** Synchronous read of the (constant) capability surface. */
export function getCachedCapabilities() {
    return STUB_CAPABILITIES;
}
/** No-op after teardown — there is nothing to re-probe. */
export function resetCapabilitiesCache() {
    /* no-op */
}
/** Returns the stubbed capability surface — kept for API compatibility. */
export async function refreshCapabilities() {
    return STUB_CAPABILITIES;
}
//# sourceMappingURL=capabilities.js.map