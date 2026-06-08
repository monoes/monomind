export type ProductionOverride = boolean | 'config';
export interface ProductionModeConfig {
    deadCode: boolean;
    health: boolean;
    duplication: boolean;
    complexity: boolean;
}
export declare const DEFAULT_PRODUCTION_MODE: ProductionModeConfig;
/** Resolve the effective production mode for a specific analysis kind. */
export declare function resolveProductionMode(override: ProductionOverride | undefined, configuredMode: boolean): boolean;
/** Resolve production mode for all analysis kinds from a per-analysis override map. */
export declare function resolveAllProductionModes(overrides: Partial<Record<keyof ProductionModeConfig, ProductionOverride>>, configured: ProductionModeConfig): ProductionModeConfig;
export interface BaselineAuditMeta {
    savedAt: string;
    gitSha?: string;
    productionMode: boolean;
}
/** Build baseline audit metadata for storage alongside a saved baseline. */
export declare function buildBaselineAuditMeta(productionMode: boolean, gitSha?: string): BaselineAuditMeta;
/** Human-readable production mode label for CLI output. */
export declare function productionModeLabel(mode: boolean): string;
//# sourceMappingURL=production-override.d.ts.map