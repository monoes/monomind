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

/**
 * Declarative probe table — one row per @monoes capability. Replaces the prior
 * index-correlated parallel array (probe order had to match return-field order,
 * a silent drift hazard). The `key` ties each probe to its MonoesCapabilities
 * field by name, so adding/reordering rows can never desync.
 *
 * Router is handled separately (3-state: native | js | none).
 */
interface CapabilityProbe {
  key: keyof MonoesCapabilities;
  specifier: string;
  check: (m: unknown) => boolean;
}

const CAPABILITY_PROBES: CapabilityProbe[] = [
  {
    key: 'sona',
    specifier: '@monoes/sona',
    check: m =>
      typeof (m as Record<string, unknown>).SonaEngine === 'function' ||
      !!(m as Record<string, unknown>).SonaEngine,
  },
  {
    key: 'attention',
    specifier: '@monoes/attention',
    check: m => typeof (m as AttentionModule).FlashAttention === 'function',
  },
  {
    key: 'learningWasm',
    specifier: '@monoes/learning-wasm',
    check: m => typeof (m as LearningWasmModule).WasmMicroLoRA === 'function',
  },
];

async function _probe(): Promise<MonoesCapabilities> {
  // Router has 3-state logic — handled separately.
  const router = await _probeRouter();

  // Upstream plugin is a pure-JS workspace package; probe via tryLoad and keep
  // the shape check (loaded ≠ has-the-factory) so a broken build reads as false.
  const upstreamMod = await tryLoad('@monomind/monovector-upstream');
  const upstreamPlugin = !!(upstreamMod as Record<string, unknown> | null)?.createHnswBridge;

  const flags: Record<string, boolean> = {};
  await Promise.all(
    CAPABILITY_PROBES.map(async p => {
      const mod = await tryLoad(p.specifier);
      flags[p.key] = mod !== null && p.check(mod);
    })
  );

  return {
    router,
    upstreamPlugin,
    sona: flags.sona ?? false,
    attention: flags.attention ?? false,
    learningWasm: flags.learningWasm ?? false,
  };
}

async function _probeRouter(): Promise<'native' | 'js' | 'none'> {
  const mod = await tryLoad<RouterModule>('@monoes/router');
  if (mod && typeof mod.VectorDb === 'function') return 'native';
  if (mod) return 'js';
  return 'none';
}
