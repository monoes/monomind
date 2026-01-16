/**
 * Per-run model tier selection — types and constants.
 *
 * Each tier maps to a concrete Claude model ID and carries sensible defaults
 * for token budget, temperature, and extended-thinking.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelSettings {
  model: ModelTier;
  maxTokens?: number;
  maxCostUsd?: number;
  extendedThinking?: boolean;
  temperature?: number;
}

export interface ModelPreference {
  default: ModelTier;
  maxCostUsd?: number;
  extendedThinking?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TIER_DEFAULTS: Record<ModelTier, ModelSettings> = {
  haiku: {
    model: 'haiku',
    maxTokens: 2048,
    temperature: 0.3,
  },
  sonnet: {
    model: 'sonnet',
    maxTokens: 8192,
    temperature: 0.5,
  },
  opus: {
    model: 'opus',
    maxTokens: 16384,
    temperature: 0.7,
    extendedThinking: true,
  },
};

export const MODEL_IDS: Record<ModelTier, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-5',
  opus: 'claude-opus-4-5',
};
