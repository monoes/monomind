/**
 * Per-run model tier selection — types and constants.
 *
 * Each tier maps to a concrete Claude model ID and carries sensible defaults
 * for token budget, temperature, and extended-thinking.
 */
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
export declare const TIER_DEFAULTS: Record<ModelTier, ModelSettings>;
export declare const MODEL_IDS: Record<ModelTier, string>;
//# sourceMappingURL=model-settings.d.ts.map