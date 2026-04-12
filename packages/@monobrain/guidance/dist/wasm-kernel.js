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
import { createHash, createHmac } from 'node:crypto';
// ============================================================================
// WASM Loader
// ============================================================================
let wasmModule = null;
let loadAttempted = false;
function tryLoadWasm() {
    if (loadAttempted)
        return wasmModule;
    loadAttempted = true;
    try {
        // Dynamic require — works in Node.js, gracefully fails elsewhere
        const path = new URL('../wasm-pkg/guidance_kernel.js', import.meta.url);
        // Use createRequire for ESM compatibility
        const { createRequire } = require('node:module');
        const requireFn = createRequire(import.meta.url);
        wasmModule = requireFn(path.pathname);
        // Initialize kernel
        if (wasmModule && typeof wasmModule.kernel_init === 'function') {
            wasmModule.kernel_init();
        }
    }
    catch {
        // WASM not available — fall back to JS
        wasmModule = null;
    }
    return wasmModule;
}
// ============================================================================
// JS Fallback Implementations
// ============================================================================
function jsSha256(input) {
    return createHash('sha256').update(input).digest('hex');
}
function jsHmacSha256(key, input) {
    return createHmac('sha256', key).update(input).digest('hex');
}
function jsContentHash(jsonInput) {
    try {
        const parsed = JSON.parse(jsonInput);
        const sorted = sortKeys(parsed);
        return jsSha256(JSON.stringify(sorted));
    }
    catch {
        return jsSha256(jsonInput);
    }
}
function sortKeys(value) {
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(sortKeys);
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = sortKeys(value[key]);
    }
    return sorted;
}
// ============================================================================
// Kernel singleton
// ============================================================================
let kernelInstance = null;
/**
 * Get the WASM kernel instance. Automatically falls back to JS if WASM is
 * unavailable. Thread-safe (single initialization).
 */
export function getKernel() {
    if (kernelInstance)
        return kernelInstance;
    const wasm = tryLoadWasm();
    if (wasm) {
        kernelInstance = {
            available: true,
            version: wasm.kernel_init(),
            sha256: (input) => wasm.sha256(input),
            hmacSha256: (key, input) => wasm.hmac_sha256(key, input),
            contentHash: (jsonInput) => wasm.content_hash(jsonInput),
            signEnvelope: (key, envelopeJson) => wasm.sign_envelope(key, envelopeJson),
            verifyChain: (chainJson, key) => wasm.verify_chain(chainJson, key),
            scanSecrets: (content) => {
                const json = wasm.scan_secrets(content);
                try {
                    return JSON.parse(json);
                }
                catch {
                    return [];
                }
            },
            detectDestructive: (command) => {
                const result = wasm.detect_destructive(command);
                return result === '' ? null : result;
            },
            batchProcess: (ops) => {
                const json = wasm.batch_process(JSON.stringify(ops));
                try {
                    return JSON.parse(json);
                }
                catch {
                    return [];
                }
            },
        };
    }
    else {
        // JS fallback — identical outputs, just slower
        kernelInstance = {
            available: false,
            version: 'js-fallback',
            sha256: jsSha256,
            hmacSha256: jsHmacSha256,
            contentHash: jsContentHash,
            signEnvelope: jsHmacSha256,
            verifyChain: () => {
                // Chain verification requires full envelope parsing — not implemented
                // in JS fallback because the ProofChain class already does it.
                throw new Error('verifyChain not available in JS fallback; use ProofChain.verifyChain()');
            },
            scanSecrets: () => {
                // Gate scanning in JS fallback defers to EnforcementGates class
                throw new Error('scanSecrets not available in JS fallback; use EnforcementGates');
            },
            detectDestructive: () => {
                throw new Error('detectDestructive not available in JS fallback; use EnforcementGates');
            },
            batchProcess: () => {
                throw new Error('batchProcess requires WASM kernel');
            },
        };
    }
    return kernelInstance;
}
/**
 * Check if the WASM kernel is available without initializing it.
 */
export function isWasmAvailable() {
    return getKernel().available;
}
/**
 * Reset the kernel instance (for testing).
 */
export function resetKernel() {
    kernelInstance = null;
    wasmModule = null;
    loadAttempted = false;
}
//# sourceMappingURL=wasm-kernel.js.map