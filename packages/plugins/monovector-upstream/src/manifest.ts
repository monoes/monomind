/**
 * MonoVector Bridge Manifest
 *
 * One declarative row per @monoes bridge. Adding a new @monoes package is a
 * single-row change here — no edits scattered across the registry, index, or
 * capability probes.
 *
 * This is the ONLY place each vendor npm specifier lives, so the registry stays
 * vendor-agnostic and the mapping from capability key → package → factory is
 * defined in exactly one location.
 */

import type { WasmBridge } from './types.js';
import { createSonaBridge } from './bridges/sona.js';
import { createAttentionBridge } from './bridges/attention.js';
import { createLearningBridge } from './bridges/learning.js';
import { createHnswBridge } from './bridges/hnsw.js';

/** One row per @monoes bridge. Adding a package = adding a row here. */
export interface MonoesBridgeDescriptor {
  /** Capability key (feature-oriented, not vendor-named) */
  key: string;
  /** The npm specifier this bridge wraps — the ONLY place the vendor string lives */
  specifier: string;
  /** Factory that creates the bridge instance */
  create: () => WasmBridge<unknown>;
}

export const MONOES_BRIDGES: MonoesBridgeDescriptor[] = [
  { key: 'sona', specifier: '@monoes/sona', create: () => createSonaBridge() as WasmBridge<unknown> },
  { key: 'attention', specifier: '@monoes/attention', create: () => createAttentionBridge() as WasmBridge<unknown> },
  { key: 'learning', specifier: '@monoes/learning-wasm', create: () => createLearningBridge() as WasmBridge<unknown> },
  { key: 'hnsw', specifier: '@monoes/micro-hnsw-wasm', create: () => createHnswBridge() as WasmBridge<unknown> },
];
