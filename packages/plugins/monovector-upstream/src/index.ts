/**
 * @monomind/monovector-upstream
 *
 * MonoVector WASM package bridges for Monomind plugins.
 * Provides unified access to 15+ WASM packages from nokhodian/monovector.
 */

// Bridge exports
export { BaseBridge } from './bridges/base-bridge.js';
export * from './bridges/hnsw.js';
export * from './bridges/attention.js';
export * from './bridges/hyperbolic.js';
export * from './bridges/learning.js';
export * from './bridges/exotic.js';
export * from './bridges/cognitive.js';
export * from './bridges/sona.js';

// Types
export * from './types.js';

// Registry
export { WasmRegistry, getWasmRegistry } from './registry.js';

// Bridge manifest (one row per @monoes bridge)
export { MONOES_BRIDGES, type MonoesBridgeDescriptor } from './manifest.js';
