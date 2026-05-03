// Selective issue filters — zero out AnalysisResults fields so callers can
// run any subset of checks in one pass without rerunning the pipeline.

export type IssueFilterKey =
  | 'unusedFiles' | 'unusedExports' | 'unusedDeps' | 'unusedTypes'
  | 'privateTypeLeaks' | 'unusedEnumMembers' | 'unusedClassMembers'
  | 'unresolvedImports' | 'unlistedDeps' | 'duplicateExports'
  | 'circularDeps' | 'boundaryViolations' | 'staleSuppressions';

export interface IssueFilters {
  unusedFiles: boolean;
  unusedExports: boolean;
  unusedDeps: boolean;
  unusedTypes: boolean;
  privateTypeLeaks: boolean;
  unusedEnumMembers: boolean;
  unusedClassMembers: boolean;
  unresolvedImports: boolean;
  unlistedDeps: boolean;
  duplicateExports: boolean;
  circularDeps: boolean;
  boundaryViolations: boolean;
  staleSuppressions: boolean;
}

export const ALL_FILTERS_OFF: IssueFilters = {
  unusedFiles: false, unusedExports: false, unusedDeps: false, unusedTypes: false,
  privateTypeLeaks: false, unusedEnumMembers: false, unusedClassMembers: false,
  unresolvedImports: false, unlistedDeps: false, duplicateExports: false,
  circularDeps: false, boundaryViolations: false, staleSuppressions: false,
};

export const ALL_FILTERS_ON: IssueFilters = {
  unusedFiles: true, unusedExports: true, unusedDeps: true, unusedTypes: true,
  privateTypeLeaks: true, unusedEnumMembers: true, unusedClassMembers: true,
  unresolvedImports: true, unlistedDeps: true, duplicateExports: true,
  circularDeps: true, boundaryViolations: true, staleSuppressions: true,
};

/** Returns true if at least one filter is active. */
export function anyFiltersActive(filters: IssueFilters): boolean {
  return Object.values(filters).some(Boolean);
}

/** When a caller passes an explicit list of check names, turn those on and all others off. */
export function activateExplicitOptIns(checks: IssueFilterKey[]): IssueFilters {
  const result = { ...ALL_FILTERS_OFF };
  for (const key of checks) result[key] = true;
  return result;
}

/** Zero out result fields that are disabled in the filters.
 *  Works with any object whose keys overlap IssueFilterKey names. */
export function applyIssueFilters<T extends Record<string, unknown>>(
  results: T,
  filters: IssueFilters,
): T {
  const out = { ...results };
  const keyMap: Partial<Record<IssueFilterKey, string>> = {
    unusedFiles: 'deadFiles',
    unusedExports: 'unusedExports',
    unusedDeps: 'unusedDependencies',
    unusedTypes: 'unusedTypes',
    privateTypeLeaks: 'privateTypeLeaks',
    unusedEnumMembers: 'unusedEnumMembers',
    unusedClassMembers: 'unusedClassMembers',
    unresolvedImports: 'unresolvedImports',
    unlistedDeps: 'unlistedDependencies',
    duplicateExports: 'duplicateExports',
    circularDeps: 'circularDependencies',
    boundaryViolations: 'boundaryViolations',
    staleSuppressions: 'staleSuppressions',
  };
  for (const [filterKey, resultKey] of Object.entries(keyMap) as [IssueFilterKey, string][]) {
    if (!filters[filterKey] && resultKey in out) {
      (out as Record<string, unknown>)[resultKey] = Array.isArray(out[resultKey]) ? [] : undefined;
    }
  }
  return out;
}

/** Parse a comma-separated string of filter keys into an IssueFilters object. */
export function parseIssueFilters(csv: string): IssueFilters {
  const keys = csv.split(',').map(s => s.trim()).filter(Boolean) as IssueFilterKey[];
  return activateExplicitOptIns(keys);
}
