// Per-analysis production mode override — allows library consumers to set
// production=true/false independently of the config file.
export const DEFAULT_PRODUCTION_MODE = {
    deadCode: false,
    health: false,
    duplication: false,
    complexity: false,
};
/** Resolve the effective production mode for a specific analysis kind. */
export function resolveProductionMode(override, configuredMode) {
    if (override === undefined || override === 'config')
        return configuredMode;
    return override;
}
/** Resolve production mode for all analysis kinds from a per-analysis override map. */
export function resolveAllProductionModes(overrides, configured) {
    return {
        deadCode: resolveProductionMode(overrides.deadCode, configured.deadCode),
        health: resolveProductionMode(overrides.health, configured.health),
        duplication: resolveProductionMode(overrides.duplication, configured.duplication),
        complexity: resolveProductionMode(overrides.complexity, configured.complexity),
    };
}
/** Build baseline audit metadata for storage alongside a saved baseline. */
export function buildBaselineAuditMeta(productionMode, gitSha) {
    return {
        savedAt: new Date().toISOString(),
        gitSha,
        productionMode,
    };
}
/** Human-readable production mode label for CLI output. */
export function productionModeLabel(mode) {
    return mode ? 'production (conservative, entry-point-aware)' : 'development (all-exports visible)';
}
//# sourceMappingURL=production-override.js.map