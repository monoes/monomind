/**
 * Single source-of-truth for Claude and third-party model pricing.
 *
 * All values are cost PER TOKEN:
 *   in  — input tokens
 *   out — output tokens
 *   cw  — cache-write tokens
 *   cr  — cache-read tokens
 *
 * Consumers: dist/src/ui/collector.mjs and dist/src/ui/server.mjs both
 * derive their inline pricing tables from this canonical list.
 */
export interface ModelPrice {
  in:  number;
  out: number;
  cw:  number;
  cr:  number;
}

/** Canonical pricing map — union of all models from collector + server tables. */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // ── Opus ────────────────────────────────────────────────────────────────────
  'claude-opus-4-8':   { in: 5e-6,    out: 25e-6,   cw: 6.25e-6,  cr: 0.5e-6   },
  'claude-opus-4-6':   { in: 5e-6,    out: 25e-6,   cw: 6.25e-6,  cr: 0.5e-6   },
  'claude-opus-4-5':   { in: 5e-6,    out: 25e-6,   cw: 6.25e-6,  cr: 0.5e-6   },
  'claude-opus-4':     { in: 15e-6,   out: 75e-6,   cw: 18.75e-6, cr: 1.5e-6   },
  // ── Sonnet ──────────────────────────────────────────────────────────────────
  'claude-sonnet-4-6': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6   },
  'claude-sonnet-4-5': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6   },
  'claude-sonnet-4':   { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6   },
  'claude-3-7-sonnet': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6   },
  'claude-3-5-sonnet': { in: 3e-6,    out: 15e-6,   cw: 3.75e-6,  cr: 0.3e-6   },
  // ── Haiku ───────────────────────────────────────────────────────────────────
  'claude-haiku-4-5':  { in: 1e-6,    out: 5e-6,    cw: 1.25e-6,  cr: 0.1e-6   },
  'claude-haiku-4':    { in: 0.8e-6,  out: 4e-6,    cw: 1e-6,     cr: 0.08e-6  },
  'claude-3-5-haiku':  { in: 0.8e-6,  out: 4e-6,    cw: 1e-6,     cr: 0.08e-6  },
  // ── OpenAI ──────────────────────────────────────────────────────────────────
  'gpt-4o':            { in: 2.5e-6,  out: 10e-6,   cw: 2.5e-6,   cr: 1.25e-6  },
  'gpt-4o-mini':       { in: 0.15e-6, out: 0.6e-6,  cw: 0.15e-6,  cr: 0.075e-6 },
  // ── Google ──────────────────────────────────────────────────────────────────
  'gemini-2.5-pro':    { in: 1.25e-6, out: 10e-6,   cw: 1.25e-6,  cr: 0.315e-6 },
};

/** Short-name aliases → canonical model keys. */
const _ALIAS: Record<string, string> = {
  haiku:  'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-6',
};

/**
 * Canonical default model IDs — single source of truth for code that needs
 * to reference a specific tier without hard-coding a string literal.
 *
 * Consumers should import these instead of writing raw model-id strings so
 * that a model upgrade only requires editing this one object.
 */
export const MODEL_DEFAULTS = {
  /** Fast/cheap routing model (Tier 2). */
  haiku:  _ALIAS['haiku']  as string,
  /** Balanced capability model (Tier 3 default). */
  sonnet: _ALIAS['sonnet'] as string,
  /** Most capable model (Tier 3 high). */
  opus:   _ALIAS['opus']   as string,
} as const;

/**
 * Resolve a raw model string (may include date suffix or @version) to its
 * pricing entry.  Returns `null` when the model is unknown.
 */
export function getModelPrice(modelId: string): ModelPrice | null {
  let key = (modelId || '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  key = _ALIAS[key] ?? key;
  if (MODEL_PRICING[key]) return MODEL_PRICING[key];
  // Prefix / substring fallback for versioned model strings
  for (const k of Object.keys(MODEL_PRICING)) {
    if (key.startsWith(k) || key.includes(k)) return MODEL_PRICING[k];
  }
  return null;
}
