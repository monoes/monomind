export function makeEmptyAnalysisResults() {
    return {
        unusedFiles: [],
        unusedExports: [],
        unusedTypes: [],
        privateTypeLeaks: [],
        unusedDependencies: [],
        unusedEnumMembers: [],
        unusedClassMembers: [],
        unresolvedImports: [],
        unlistedDependencies: [],
        duplicateExports: [],
        circularDependencies: [],
        boundaryViolations: [],
        staleSuppressions: [],
    };
}
export function totalIssues(results) {
    return (results.unusedFiles.length +
        results.unusedExports.length +
        results.unusedTypes.length +
        results.privateTypeLeaks.length +
        results.unusedDependencies.length +
        results.unusedEnumMembers.length +
        results.unusedClassMembers.length +
        results.unresolvedImports.length +
        results.unlistedDependencies.length +
        results.duplicateExports.length +
        results.circularDependencies.length +
        results.boundaryViolations.length +
        results.staleSuppressions.length);
}
export function hasIssues(results) {
    return totalIssues(results) > 0;
}
export function mergeAnalysisResults(a, b) {
    return {
        unusedFiles: [...a.unusedFiles, ...b.unusedFiles],
        unusedExports: [...a.unusedExports, ...b.unusedExports],
        unusedTypes: [...a.unusedTypes, ...b.unusedTypes],
        privateTypeLeaks: [...a.privateTypeLeaks, ...b.privateTypeLeaks],
        unusedDependencies: [...a.unusedDependencies, ...b.unusedDependencies],
        unusedEnumMembers: [...a.unusedEnumMembers, ...b.unusedEnumMembers],
        unusedClassMembers: [...a.unusedClassMembers, ...b.unusedClassMembers],
        unresolvedImports: [...a.unresolvedImports, ...b.unresolvedImports],
        unlistedDependencies: [...a.unlistedDependencies, ...b.unlistedDependencies],
        duplicateExports: [...a.duplicateExports, ...b.duplicateExports],
        circularDependencies: [...a.circularDependencies, ...b.circularDependencies],
        boundaryViolations: [...a.boundaryViolations, ...b.boundaryViolations],
        staleSuppressions: [...a.staleSuppressions, ...b.staleSuppressions],
    };
}
export function filterResultsByFile(results, filePaths) {
    return {
        unusedFiles: results.unusedFiles.filter(r => filePaths.has(r.filePath)),
        unusedExports: results.unusedExports.filter(r => filePaths.has(r.filePath)),
        unusedTypes: results.unusedTypes.filter(r => filePaths.has(r.filePath)),
        privateTypeLeaks: results.privateTypeLeaks.filter(r => filePaths.has(r.filePath)),
        unusedDependencies: results.unusedDependencies,
        unusedEnumMembers: results.unusedEnumMembers.filter(r => filePaths.has(r.filePath)),
        unusedClassMembers: results.unusedClassMembers.filter(r => filePaths.has(r.filePath)),
        unresolvedImports: results.unresolvedImports.filter(r => filePaths.has(r.filePath)),
        unlistedDependencies: results.unlistedDependencies,
        duplicateExports: results.duplicateExports,
        circularDependencies: results.circularDependencies.filter(c => c.cycle.some(f => filePaths.has(f))),
        boundaryViolations: results.boundaryViolations.filter(b => filePaths.has(b.fromFile)),
        staleSuppressions: results.staleSuppressions.filter(r => filePaths.has(r.filePath)),
    };
}
//# sourceMappingURL=types.js.map