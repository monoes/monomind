export function effectiveSeverity(kind, rules) {
    return rules[kind] ?? 'error';
}
export function applyRules(issues, rules) {
    return issues
        .filter(issue => effectiveSeverity(issue.kind, rules) !== 'off')
        .map(issue => ({ ...issue, severity: effectiveSeverity(issue.kind, rules) }));
}
export function hasErrorSeverityIssues(issues, rules) {
    return issues.some(issue => effectiveSeverity(issue.kind, rules) === 'error');
}
export const DEFAULT_RULES_CONFIG = {
    unusedFiles: 'error',
    unusedExports: 'error',
    unusedDeps: 'warn',
    unusedTypes: 'warn',
    privateTypeLeaks: 'warn',
    unusedEnumMembers: 'warn',
    unusedClassMembers: 'warn',
    unresolvedImports: 'error',
    unlistedDeps: 'warn',
    duplicateExports: 'error',
    circularDeps: 'warn',
    boundaryViolations: 'error',
    staleSuppressions: 'warn',
};
//# sourceMappingURL=rules.js.map