import { describe, it, expect } from 'vitest';

import { calculateCostUsd } from '../../packages/@monomind/hooks/src/cost/model-pricing.js';

describe('calculateCostUsd', () => {
  it('calculates haiku-3 input cost correctly', () => {
    // 1M input tokens at $0.25/1M = $0.25
    expect(calculateCostUsd('claude-haiku-3', 1_000_000, 0)).toBeCloseTo(0.25, 4);
  });

  it('calculates sonnet-4 output cost correctly', () => {
    // 1M output tokens at $15/1M = $15
    expect(calculateCostUsd('claude-sonnet-4', 0, 1_000_000)).toBeCloseTo(15.0, 2);
  });

  it('calculates combined input+output cost', () => {
    // haiku-3: 500K input ($0.125) + 200K output ($0.25) = $0.375
    expect(calculateCostUsd('claude-haiku-3', 500_000, 200_000)).toBeCloseTo(0.375, 4);
  });

  it('handles unknown model with fallback pricing', () => {
    const cost = calculateCostUsd('unknown-model', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('returns 0 for zero tokens', () => {
    expect(calculateCostUsd('claude-haiku-3', 0, 0)).toBe(0);
  });

  it('handles model name with date suffix', () => {
    // claude-haiku-3-20250307 should match claude-haiku-3
    const cost = calculateCostUsd('claude-haiku-3-20250307', 1_000_000, 0);
    expect(cost).toBeCloseTo(0.25, 4);
  });
});
