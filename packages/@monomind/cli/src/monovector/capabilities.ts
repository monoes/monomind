/**
 * Unified capability surface for @monoes/* packages.
 * Single async call to know what's available before choosing code paths.
 * Result is cached after the first resolution — call anywhere, pay once.
 */

import type { AttentionModule, LearningWasmModule, RouterModule } from './monoes-types.js';

export interface MonoesCapabilities {
  /** @monoes/sona SonaEngine available */
  sona: boolean;
  /** @monoes/router backend: native HNSW, pure-JS, or absent */
  router: 'native' | 'js' | 'none';
  /** @monoes/attention FlashAttention available */
  attention: boolean;
  /** @monoes/learning-wasm WasmMicroLoRA available */
  learningWasm: boolean;
}

let _cached: MonoesCapabilities | null = null;
let _inFlight: Promise<MonoesCapabilities> | null = null;

/**
 * Probe all @monoes packages and return their availability.
 * Cached after first call — safe to call anywhere.
 */
export async function getCapabilities(): Promise<MonoesCapabilities> {
  if (_cached) return _cached;
  if (_inFlight) return _inFlight;

  _inFlight = _probe().then(caps => {
    _cached = caps;
    _inFlight = null;
    return caps;
  });
  return _inFlight;
}

/**
 * Synchronous read of the cached result. Returns null if not yet resolved.
 */
export function getCachedCapabilities(): MonoesCapabilities | null {
  return _cached;
}

/**
 * Reset cache for testing.
 */
export function resetCapabilitiesCache(): void {
  _cached = null;
  _inFlight = null;
}

async function _probe(): Promise<MonoesCapabilities> {
  const [sonaResult, routerResult, attentionResult, wasmResult] = await Promise.allSettled([
    // @ts-expect-error optional peer dependency — index.d.ts may be empty
    import('@monoes/sona').then((m: any) => typeof m.SonaEngine === 'function' || !!m.SonaEngine),
    _probeRouter(),
    import('@monoes/attention').then(m => typeof (m as unknown as AttentionModule).FlashAttention === 'function'),
    import('@monoes/learning-wasm').then(m => typeof (m as unknown as LearningWasmModule).WasmMicroLoRA === 'function'),
  ]);

  return {
    sona: sonaResult.status === 'fulfilled' ? sonaResult.value : false,
    router: routerResult.status === 'fulfilled' ? routerResult.value : 'none',
    attention: attentionResult.status === 'fulfilled' ? attentionResult.value : false,
    learningWasm: wasmResult.status === 'fulfilled' ? wasmResult.value : false,
  };
}

async function _probeRouter(): Promise<'native' | 'js' | 'none'> {
  try {
    const mod = await import('@monoes/router') as unknown as RouterModule;
    if (typeof mod.VectorDb === 'function') return 'native';
    return 'js';
  } catch {
    return 'none';
  }
}
