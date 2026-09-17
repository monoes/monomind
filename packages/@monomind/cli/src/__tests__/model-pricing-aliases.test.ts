import { describe, expect, it } from 'vitest';
import { DEFAULT_CLAUDE_MODEL } from '../orgrt/vercel-providers.js';
import { getModelPrice, MODEL_DEFAULTS, MODEL_PRICING } from '../pricing/model-pricing.js';

describe('model-pricing short-name aliases point at the current Claude models', () => {
  it('MODEL_DEFAULTS resolve to the current family (sonnet = DEFAULT_CLAUDE_MODEL)', () => {
    expect(MODEL_DEFAULTS.sonnet).toBe(DEFAULT_CLAUDE_MODEL);
    expect(MODEL_DEFAULTS.opus).toBe('claude-opus-5');
    expect(MODEL_DEFAULTS.haiku).toBe('claude-haiku-4-5-20251001');
  });

  it('aliases price as their current model', () => {
    expect(getModelPrice('sonnet')).toBe(MODEL_PRICING['claude-sonnet-5']);
    expect(getModelPrice('opus')).toBe(MODEL_PRICING['claude-opus-5']);
    expect(getModelPrice('haiku')).toBe(MODEL_PRICING['claude-haiku-4-5']);
  });

  it('keeps pricing rows for superseded ids so historical sessions still cost', () => {
    expect(getModelPrice('claude-sonnet-4-6')).toBe(MODEL_PRICING['claude-sonnet-4-6']);
    expect(getModelPrice('claude-opus-4-6')).toBe(MODEL_PRICING['claude-opus-4-6']);
  });
});
