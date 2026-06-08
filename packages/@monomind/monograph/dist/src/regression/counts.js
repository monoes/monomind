// Regression baseline that stores per-category issue counts rather than per-issue identity.
export const REGRESSION_SCHEMA_VERSION = 1;
export const ZERO_CHECK_COUNTS = {
    unusedExports: 0, unusedTypes: 0, unusedEnums: 0, unusedClasses: 0,
    unusedFunctions: 0, unusedVariables: 0, deadFiles: 0, namespaceOnlyExports: 0,
    internalExports: 0, duplicateExports: 0, reExportOnlyFiles: 0,
    missingEntryPoint: 0, privateLeak: 0, circularDeps: 0, boundaryViolations: 0,
};
export function createRegressionBaseline(checks, gitSha, dupes) {
    return {
        schemaVersion: REGRESSION_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        gitSha,
        checks,
        dupes,
    };
}
/** Compute deltas between two CheckCounts. Returns only changed categories. */
export function checkCountsDeltas(baseline, current) {
    const keys = Object.keys(baseline);
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
export function totalCheckCounts(counts) {
    return Object.values(counts).reduce((s, v) => s + v, 0);
}
//# sourceMappingURL=counts.js.map