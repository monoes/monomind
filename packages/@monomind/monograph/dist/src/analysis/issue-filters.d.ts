export type IssueFilterKey = 'unusedFiles' | 'unusedExports' | 'unusedDeps' | 'unusedTypes' | 'privateTypeLeaks' | 'unusedEnumMembers' | 'unusedClassMembers' | 'unresolvedImports' | 'unlistedDeps' | 'duplicateExports' | 'circularDeps' | 'boundaryViolations' | 'staleSuppressions';
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
export declare const ALL_FILTERS_OFF: IssueFilters;
export declare const ALL_FILTERS_ON: IssueFilters;
/** Returns true if at least one filter is active. */
export declare function anyFiltersActive(filters: IssueFilters): boolean;
/** When a caller passes an explicit list of check names, turn those on and all others off. */
export declare function activateExplicitOptIns(checks: IssueFilterKey[]): IssueFilters;
/** Parse a comma-separated string of filter keys into an IssueFilters object. */
export declare function parseIssueFilters(csv: string): IssueFilters;
//# sourceMappingURL=issue-filters.d.ts.map