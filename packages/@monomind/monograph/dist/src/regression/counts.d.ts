export declare const REGRESSION_SCHEMA_VERSION = 1;
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
export declare const ZERO_CHECK_COUNTS: CheckCounts;
export declare function createRegressionBaseline(checks: CheckCounts, gitSha?: string, dupes?: DupesCounts): RegressionBaseline;
export type CheckCountsKey = keyof CheckCounts;
export interface CountDelta {
    key: CheckCountsKey;
    baseline: number;
    current: number;
    delta: number;
}
/** Compute deltas between two CheckCounts. Returns only changed categories. */
export declare function checkCountsDeltas(baseline: CheckCounts, current: CheckCounts): CountDelta[];
/** Sum all count fields into a single total. */
export declare function totalCheckCounts(counts: CheckCounts): number;
//# sourceMappingURL=counts.d.ts.map