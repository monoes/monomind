// Per-analysis production mode override — allows library consumers to set
// production=true/false independently of the config file.

export type ProductionOverride = boolean | 'config';

export interface ProductionModeConfig {
  deadCode: boolean;
  health: boolean;
  duplication: boolean;
  complexity: boolean;
}

export const DEFAULT_PRODUCTION_MODE: ProductionModeConfig = {
  deadCode: false,
  health: false,
  duplication: false,
  complexity: false,
};

/** Resolve the effective production mode for a specific analysis kind. */
export function resolveProductionMode(
  override: ProductionOverride | undefined,
  configuredMode: boolean,
): boolean {
  if (override === undefined || override === 'config') return configuredMode;
  return override;
}

/** Resolve production mode for all analysis kinds from a per-analysis override map. */
export function resolveAllProductionModes(
  overrides: Partial<Record<keyof ProductionModeConfig, ProductionOverride>>,
  configured: ProductionModeConfig,
): ProductionModeConfig {
  return {
    deadCode:    resolveProductionMode(overrides.deadCode,    configured.deadCode),
    health:      resolveProductionMode(overrides.health,      configured.health),
    duplication: resolveProductionMode(overrides.duplication, configured.duplication),
    complexity:  resolveProductionMode(overrides.complexity,  configured.complexity),
  };
}

export interface BaselineAuditMeta {
  savedAt: string;
  gitSha?: string;
  productionMode: boolean;
}

/** Build baseline audit metadata for storage alongside a saved baseline. */
export function buildBaselineAuditMeta(
  productionMode: boolean,
  gitSha?: string,
): BaselineAuditMeta {
  return {
    savedAt: new Date().toISOString(),
    gitSha,
    productionMode,
  };
}

/** Human-readable production mode label for CLI output. */
export function productionModeLabel(mode: boolean): string {
  return mode ? 'production (conservative, entry-point-aware)' : 'development (all-exports visible)';
}
