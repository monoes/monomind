/**
 * Claude API pricing per 1M tokens (USD).
 * Last updated: 2026-04. Verify at https://www.anthropic.com/pricing.
 */
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-haiku-4':       { inputPer1M: 0.80,   outputPer1M: 4.00 },
  'claude-haiku-3':       { inputPer1M: 0.25,   outputPer1M: 1.25 },
  'claude-sonnet-4':      { inputPer1M: 3.00,   outputPer1M: 15.00 },
  'claude-sonnet-3.7':    { inputPer1M: 3.00,   outputPer1M: 15.00 },
  'claude-opus-4':        { inputPer1M: 15.00,  outputPer1M: 75.00 },
  'claude-opus-3':        { inputPer1M: 15.00,  outputPer1M: 75.00 },
};

const FALLBACK_PRICING: ModelPrice = { inputPer1M: 3.00, outputPer1M: 15.00 };

/**
 * Calculate cost in USD for a single API call.
 */
export function calculateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const normalized = Object.keys(MODEL_PRICING).find(key =>
    model.toLowerCase().startsWith(key.toLowerCase())
  ) ?? model;

  const pricing = MODEL_PRICING[normalized] ?? FALLBACK_PRICING;
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M
  );
}
