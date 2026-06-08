export function makeEmptyFallowResults() {
    return {
        unusedFiles: [],
        unusedExports: [],
        unusedTypes: [],
        privateTypeLeaks: [],
        unusedDependencies: [],
        unusedDevDependencies: [],
        unusedEnumMembers: [],
        unusedClassMembers: [],
        unresolvedImports: [],
        unlistedDependencies: [],
        duplicateExports: [],
        typeOnlyDependencies: [],
        testOnlyDependencies: [],
        circularDependencies: [],
        boundaryViolations: [],
        staleSuppressions: [],
        featureFlags: [],
    };
}
export function totalFallowIssues(results) {
    return (results.unusedFiles.length +
        results.unusedExports.length +
        results.unusedTypes.length +
        results.privateTypeLeaks.length +
        results.unusedDependencies.length +
        results.unusedDevDependencies.length +
        results.unusedEnumMembers.length +
        results.unusedClassMembers.length +
        results.unresolvedImports.length +
        results.unlistedDependencies.length +
        results.duplicateExports.length +
        results.typeOnlyDependencies.length +
        results.testOnlyDependencies.length +
        results.circularDependencies.length +
        results.boundaryViolations.length +
        results.staleSuppressions.length +
        results.featureFlags.length);
}
export function hasFallowIssues(results) {
    return totalFallowIssues(results) > 0;
}
function cmpFileLineCol(a, b) {
    if (a.filePath < b.filePath)
        return -1;
    if (a.filePath > b.filePath)
        return 1;
    if (a.line !== b.line)
        return a.line - b.line;
    return a.col - b.col;
}
export function sortFallowResults(results) {
    results.unusedFiles.sort(cmpFileLineCol);
    results.unusedExports.sort(cmpFileLineCol);
    results.unusedTypes.sort(cmpFileLineCol);
    results.privateTypeLeaks.sort(cmpFileLineCol);
    results.unusedEnumMembers.sort(cmpFileLineCol);
    results.unusedClassMembers.sort(cmpFileLineCol);
    results.unresolvedImports.sort(cmpFileLineCol);
    results.unusedDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    results.unusedDevDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    results.typeOnlyDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    results.testOnlyDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    results.unlistedDependencies.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    results.duplicateExports.sort((a, b) => (a.exportName < b.exportName ? -1 : a.exportName > b.exportName ? 1 : 0));
    results.circularDependencies.sort((a, b) => {
        const ac = a.cycle[0] ?? '';
        const bc = b.cycle[0] ?? '';
        if (ac < bc)
            return -1;
        if (ac > bc)
            return 1;
        return a.line - b.line;
    });
    results.boundaryViolations.sort((a, b) => {
        if (a.fromPath < b.fromPath)
            return -1;
        if (a.fromPath > b.fromPath)
            return 1;
        return a.line - b.line;
    });
    results.staleSuppressions.sort((a, b) => {
        if (a.filePath < b.filePath)
            return -1;
        if (a.filePath > b.filePath)
            return 1;
        return a.commentLine - b.commentLine;
    });
    results.featureFlags.sort((a, b) => {
        if (a.filePath < b.filePath)
            return -1;
        if (a.filePath > b.filePath)
            return 1;
        if (a.line !== b.line)
            return a.line - b.line;
        return a.flagName < b.flagName ? -1 : a.flagName > b.flagName ? 1 : 0;
    });
}
//# sourceMappingURL=fallow-results.js.map