// Regression baseline that stores per-category issue counts rather than per-issue identity.

export const REGRESSION_SCHEMA_VERSION = 1;

export interface CheckCounts {
  unusedExports: number;
  unusedTypes: number;
  unusedEnums: number;
  unusedClasses: number;
  unusedFunctions: number;
  unusedVariables: number;
  deadFiles: number;
  namespaceOnlyExports: number;
  internalExports: number;
  duplicateExports: number;
  reExportOnlyFiles: number;
  missingEntryPoint: number;
  privateLeak: number;
  circularDeps: number;
  boundaryViolations: number;
}

export interface DupesCounts {
  cloneGroups: number;
  cloneInstances: number;
  duplicatedLines: number;
  duplicationPct: number;
}

export interface RegressionBaseline {
  schemaVersion: number;
  createdAt: string;
  gitSha?: string;
  checks: CheckCounts;
  dupes?: DupesCounts;
}

export const ZERO_CHECK_COUNTS: CheckCounts = {
  unusedExports: 0, unusedTypes: 0, unusedEnums: 0, unusedClasses: 0,
  unusedFunctions: 0, unusedVariables: 0, deadFiles: 0, namespaceOnlyExports: 0,
  internalExports: 0, duplicateExports: 0, reExportOnlyFiles: 0,
  missingEntryPoint: 0, privateLeak: 0, circularDeps: 0, boundaryViolations: 0,
};

export function createRegressionBaseline(
  checks: CheckCounts,
  gitSha?: string,
  dupes?: DupesCounts,
): RegressionBaseline {
  return {
    schemaVersion: REGRESSION_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    gitSha,
    checks,
    dupes,
  };
}

export type CheckCountsKey = keyof CheckCounts;

export interface CountDelta {
  key: CheckCountsKey;
  baseline: number;
  current: number;
  delta: number;
}

/** Compute deltas between two CheckCounts. Returns only changed categories. */
export function checkCountsDeltas(
  baseline: CheckCounts,
  current: CheckCounts,
): CountDelta[] {
  const keys = Object.keys(baseline) as CheckCountsKey[];
  return keys
    .map(key => ({
      key,
      baseline: baseline[key],
      current: current[key],
      delta: current[key] - baseline[key],
    }))
    .filter(d => d.delta !== 0);
}

/** Sum all count fields into a single total. */
export function totalCheckCounts(counts: CheckCounts): number {
  return Object.values(counts).reduce((s, v) => s + v, 0);
}
