/**
 * Per-run model tier selection — types and constants.
 *
 * Each tier maps to a concrete Claude model ID and carries sensible defaults
 * for token budget, temperature, and extended-thinking.
 */
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const TIER_DEFAULTS = {
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
export const MODEL_IDS = {
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-4-5',
    opus: 'claude-opus-4-5',
};
//# sourceMappingURL=model-settings.js.map