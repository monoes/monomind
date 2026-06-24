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
    in: number;
    out: number;
    cw: number;
    cr: number;
}
/** Canonical pricing map — union of all models from collector + server tables. */
export declare const MODEL_PRICING: Record<string, ModelPrice>;
/**
 * Canonical default model IDs — single source of truth for code that needs
 * to reference a specific tier without hard-coding a string literal.
 *
 * Consumers should import these instead of writing raw model-id strings so
 * that a model upgrade only requires editing this one object.
 */
export declare const MODEL_DEFAULTS: {
    /** Fast/cheap routing model (Tier 2). */
    readonly haiku: string;
    /** Balanced capability model (Tier 3 default). */
    readonly sonnet: string;
    /** Most capable model (Tier 3 high). */
    readonly opus: string;
};
/**
 * Resolve a raw model string (may include date suffix or @version) to its
 * pricing entry.  Returns `null` when the model is unknown.
 */
export declare function getModelPrice(modelId: string): ModelPrice | null;
//# sourceMappingURL=model-pricing.d.ts.map