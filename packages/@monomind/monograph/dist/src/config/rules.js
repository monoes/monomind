// Per-issue-type severity configuration for all 19 fallow issue categories.
export const DEFAULT_RULES_CONFIG = {
    unusedFiles: 'error',
    unusedExports: 'error',
    unusedTypes: 'error',
    privateTypeLeaks: 'error',
    unusedDependencies: 'error',
    unusedDevDependencies: 'warn',
    unusedOptionalDependencies: 'warn',
    unusedEnumMembers: 'error',
    unusedClassMembers: 'warn',
    unresolvedImports: 'error',
    unlistedDependencies: 'error',
    duplicateExports: 'warn',
    typeOnlyDependencies: 'warn',
    testOnlyDependencies: 'warn',
    circularDependencies: 'warn',
    boundaryViolation: 'error',
    coverageGaps: 'warn',
    featureFlags: 'warn',
    staleSuppressions: 'warn',
};
export function mergeRulesConfig(base, partial) {
    return { ...base, ...partial };
}
export function severityToExitCode(severity) {
    return severity === 'error' ? 1 : 0;
}
export function issueSeverityFor(rules, issueKind) {
    return rules[issueKind];
}
export const ALL_ISSUE_KINDS = [
    'unusedFiles', 'unusedExports', 'unusedTypes', 'privateTypeLeaks',
    'unusedDependencies', 'unusedDevDependencies', 'unusedOptionalDependencies',
    'unusedEnumMembers', 'unusedClassMembers', 'unresolvedImports',
    'unlistedDependencies', 'duplicateExports', 'typeOnlyDependencies',
    'testOnlyDependencies', 'circularDependencies', 'boundaryViolation',
    'coverageGaps', 'featureFlags', 'staleSuppressions',
];
//# sourceMappingURL=rules.js.map