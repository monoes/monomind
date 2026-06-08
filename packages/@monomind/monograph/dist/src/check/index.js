import { applyRules, hasErrorSeverityIssues, DEFAULT_RULES_CONFIG } from './rules.js';
import { filterToWorkspaces, resolveWorkspaceScope } from './filtering.js';
export * from './rules.js';
export * from './filtering.js';
export * from './output.js';
export const DEFAULT_ISSUE_FILTERS = {
    unusedFiles: true,
    unusedExports: true,
    unusedDeps: true,
    unusedTypes: true,
    privateTypeLeaks: true,
    unusedEnumMembers: true,
    unusedClassMembers: true,
    unresolvedImports: true,
    unlistedDeps: true,
    duplicateExports: true,
    circularDeps: true,
    boundaryViolations: true,
    staleSuppressions: true,
};
export function runCheckFilter(issues, opts, rules = DEFAULT_RULES_CONFIG, allWorkspaceRoots = []) {
    let filtered = applyRules(issues, rules);
    const activeFilters = opts.filters;
    filtered = filtered.filter(issue => {
        const key = issue.kind;
        return activeFilters[key] !== false;
    });
    const wsRoots = resolveWorkspaceScope(opts.root, opts.workspace, opts.changedWorkspaces, allWorkspaceRoots);
    const filteredByWorkspace = wsRoots.length > 0;
    if (filteredByWorkspace) {
        filtered = filterToWorkspaces(filtered, wsRoots);
    }
    return {
        issues: filtered,
        hasErrors: hasErrorSeverityIssues(filtered, rules),
        filteredByWorkspace,
    };
}
//# sourceMappingURL=index.js.map