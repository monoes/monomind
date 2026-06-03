/**
 * Unified capability surface for @monoes/* packages.
 * Single async call to know what's available before choosing code paths.
 * Result is cached after the first resolution — call anywhere, pay once.
 */

import type { AttentionModule, LearningWasmModule, RouterModule } from './monoes-types.js';
import { tryLoad } from './pkg-loader.js';

export interface MonoesCapabilities {
  /** @monoes/sona SonaEngine available */
  sona: boolean;
  /** @monoes/router backend: native HNSW, pure-JS, or absent */
  router: 'native' | 'js' | 'none';
  /** @monoes/attention FlashAttention available */
  attention: boolean;
  /** @monoes/learning-wasm WasmMicroLoRA available */
  learningWasm: boolean;
  /** @monomind/monovector-upstream plugin (HnswBridge, SonaBridge, etc.) loaded */
  upstreamPlugin: boolean;
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
  const [sonaResult, routerResult, attentionResult, wasmResult, pluginResult] = await Promise.allSettled([
    tryLoad('@monoes/sona').then(m => !!m && (typeof (m as Record<string, unknown>).SonaEngine === 'function' || !!(m as Record<string, unknown>).SonaEngine)),
    _probeRouter(),
    tryLoad<AttentionModule>('@monoes/attention').then(m => !!m && typeof m.FlashAttention === 'function'),
    tryLoad<LearningWasmModule>('@monoes/learning-wasm').then(m => !!m && typeof m.WasmMicroLoRA === 'function'),
    import('@monomind/monovector-upstream').then(m => !!(m as Record<string, unknown>).createHnswBridge).catch(() => false),
  ]);

  return {
    sona: sonaResult.status === 'fulfilled' ? sonaResult.value : false,
    router: routerResult.status === 'fulfilled' ? routerResult.value : 'none',
    attention: attentionResult.status === 'fulfilled' ? attentionResult.value : false,
    learningWasm: wasmResult.status === 'fulfilled' ? wasmResult.value : false,
    upstreamPlugin: pluginResult.status === 'fulfilled' ? (pluginResult.value as boolean) : false,
  };
}

async function _probeRouter(): Promise<'native' | 'js' | 'none'> {
  const mod = await tryLoad<RouterModule>('@monoes/router');
  if (mod && typeof mod.VectorDb === 'function') return 'native';
  if (mod) return 'js';
  return 'none';
}
