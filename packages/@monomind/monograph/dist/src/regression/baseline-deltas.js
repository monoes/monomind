import { makeEmptyFallowResults, totalFallowIssues } from '../results/fallow-results.js';
function makeDelta(category, baselineItems, currentItems, added, resolved) {
    return {
        category,
        before: baselineItems.length,
        after: currentItems.length,
        added,
        resolved,
    };
}
function setOf(items, key) {
    return new Set(items.map(key));
}
function unusedFileKey(f) {
    return f.filePath;
}
function unusedExportKey(e) {
    return `${e.filePath}::${e.exportName}`;
}
function unusedDepKey(d) {
    return `${d.name}::${d.location}`;
}
function unusedMemberKey(m) {
    return `${m.filePath}::${m.parentName}::${m.memberName}`;
}
function unresolvedImportKey(i) {
    return `${i.filePath}::${i.specifier}`;
}
function computeDelta(category, baselineItems, currentItems, key) {
    const baselineKeys = setOf(baselineItems, key);
    const currentKeys = setOf(currentItems, key);
    const added = currentItems.filter(i => !baselineKeys.has(key(i))).length;
    const resolved = baselineItems.filter(i => !currentKeys.has(key(i))).length;
    return makeDelta(category, baselineItems, currentItems, added, resolved);
}
export function computeBaselineDeltas(baseline, current) {
    const baselineExports = [...baseline.unusedExports, ...baseline.unusedTypes];
    const currentExports = [...current.unusedExports, ...current.unusedTypes];
    const baselineDeps = [...baseline.unusedDependencies, ...baseline.unusedDevDependencies];
    const currentDeps = [...current.unusedDependencies, ...current.unusedDevDependencies];
    const baselineMembers = [...baseline.unusedEnumMembers, ...baseline.unusedClassMembers];
    const currentMembers = [...current.unusedEnumMembers, ...current.unusedClassMembers];
    const unusedFiles = computeDelta('Unused files', baseline.unusedFiles, current.unusedFiles, unusedFileKey);
    const unusedExports = computeDelta('Unused exports', baselineExports, currentExports, unusedExportKey);
    const unusedDeps = computeDelta('Unused deps', baselineDeps, currentDeps, unusedDepKey);
    const unusedMembers = computeDelta('Unused members', baselineMembers, currentMembers, unusedMemberKey);
    const unresolvedImports = computeDelta('Unresolved imports', baseline.unresolvedImports, current.unresolvedImports, unresolvedImportKey);
    const baselineCloneCount = baseline.duplicateExports.length;
    const currentCloneCount = current.duplicateExports.length;
    const cloneGroups = {
        category: 'Clone groups',
        before: baselineCloneCount,
        after: currentCloneCount,
        added: Math.max(0, currentCloneCount - baselineCloneCount),
        resolved: Math.max(0, baselineCloneCount - currentCloneCount),
    };
    const beforeTotal = totalFallowIssues(baseline);
    const afterTotal = totalFallowIssues(current);
    const overall = {
        category: 'Overall',
        before: beforeTotal,
        after: afterTotal,
        added: unusedFiles.added + unusedExports.added + unusedDeps.added + unusedMembers.added + unresolvedImports.added + cloneGroups.added,
        resolved: unusedFiles.resolved + unusedExports.resolved + unusedDeps.resolved + unusedMembers.resolved + unresolvedImports.resolved + cloneGroups.resolved,
    };
    return { unusedFiles, unusedExports, unusedDeps, unusedMembers, unresolvedImports, cloneGroups, overall };
}
export function filterNewIssues(baseline, current) {
    const baselineFileKeys = setOf(baseline.unusedFiles, unusedFileKey);
    const baselineExportKeys = setOf([...baseline.unusedExports, ...baseline.unusedTypes], unusedExportKey);
    const baselineDepKeys = setOf([...baseline.unusedDependencies, ...baseline.unusedDevDependencies], unusedDepKey);
    const baselineMemberKeys = setOf([...baseline.unusedEnumMembers, ...baseline.unusedClassMembers], unusedMemberKey);
    const baselineImportKeys = setOf(baseline.unresolvedImports, unresolvedImportKey);
    function circularKey(c) {
        return c.cycle.join('->');
    }
    const baselineCircularKeys = setOf(baseline.circularDependencies, circularKey);
    function boundaryKey(b) {
        return `${b.fromPath}::${b.toPath}::${b.importSpecifier}`;
    }
    const baselineBoundaryKeys = setOf(baseline.boundaryViolations, boundaryKey);
    function suppressionKey(s) {
        return `${s.filePath}::${s.commentLine}`;
    }
    const baselineSuppressionKeys = setOf(baseline.staleSuppressions, suppressionKey);
    function flagKey(f) {
        return `${f.filePath}::${f.flagName}::${f.line}`;
    }
    const baselineFlagKeys = setOf(baseline.featureFlags, flagKey);
    function privateLeakKey(p) {
        return `${p.filePath}::${p.exportName}::${p.privateType}`;
    }
    const baselinePrivateLeakKeys = setOf(baseline.privateTypeLeaks, privateLeakKey);
    function unlistedDepKey(u) {
        return u.name;
    }
    const baselineUnlistedKeys = setOf(baseline.unlistedDependencies, unlistedDepKey);
    function duplicateExportKey(d) {
        return d.exportName;
    }
    const baselineDuplicateKeys = setOf(baseline.duplicateExports, duplicateExportKey);
    function typeOnlyDepKey(d) {
        return `${d.name}::${d.location}`;
    }
    const baselineTypeOnlyKeys = setOf(baseline.typeOnlyDependencies, typeOnlyDepKey);
    function testOnlyDepKey(d) {
        return `${d.name}::${d.location}`;
    }
    const baselineTestOnlyKeys = setOf(baseline.testOnlyDependencies, testOnlyDepKey);
    const result = makeEmptyFallowResults();
    result.unusedFiles = current.unusedFiles.filter(i => !baselineFileKeys.has(unusedFileKey(i)));
    result.unusedExports = current.unusedExports.filter(i => !baselineExportKeys.has(unusedExportKey(i)));
    result.unusedTypes = current.unusedTypes.filter(i => !baselineExportKeys.has(unusedExportKey(i)));
    result.unusedDependencies = current.unusedDependencies.filter(i => !baselineDepKeys.has(unusedDepKey(i)));
    result.unusedDevDependencies = current.unusedDevDependencies.filter(i => !baselineDepKeys.has(unusedDepKey(i)));
    result.unusedEnumMembers = current.unusedEnumMembers.filter(i => !baselineMemberKeys.has(unusedMemberKey(i)));
    result.unusedClassMembers = current.unusedClassMembers.filter(i => !baselineMemberKeys.has(unusedMemberKey(i)));
    result.unresolvedImports = current.unresolvedImports.filter(i => !baselineImportKeys.has(unresolvedImportKey(i)));
    result.circularDependencies = current.circularDependencies.filter(i => !baselineCircularKeys.has(circularKey(i)));
    result.boundaryViolations = current.boundaryViolations.filter(i => !baselineBoundaryKeys.has(boundaryKey(i)));
    result.staleSuppressions = current.staleSuppressions.filter(i => !baselineSuppressionKeys.has(suppressionKey(i)));
    result.featureFlags = current.featureFlags.filter(i => !baselineFlagKeys.has(flagKey(i)));
    result.privateTypeLeaks = current.privateTypeLeaks.filter(i => !baselinePrivateLeakKeys.has(privateLeakKey(i)));
    result.unlistedDependencies = current.unlistedDependencies.filter(i => !baselineUnlistedKeys.has(unlistedDepKey(i)));
    result.duplicateExports = current.duplicateExports.filter(i => !baselineDuplicateKeys.has(duplicateExportKey(i)));
    result.typeOnlyDependencies = current.typeOnlyDependencies.filter(i => !baselineTypeOnlyKeys.has(typeOnlyDepKey(i)));
    result.testOnlyDependencies = current.testOnlyDependencies.filter(i => !baselineTestOnlyKeys.has(testOnlyDepKey(i)));
    return result;
}
export function formatBaselineDeltas(deltas) {
    const rows = [
        ['Unused files', deltas.unusedFiles],
        ['Unused exports', deltas.unusedExports],
        ['Unused deps', deltas.unusedDeps],
        ['Unused members', deltas.unusedMembers],
        ['Unresolved imports', deltas.unresolvedImports],
        ['Clone groups', deltas.cloneGroups],
        ['Overall', deltas.overall],
    ];
    const labelWidth = Math.max(...rows.map(([label]) => label.length));
    return rows.map(([label, d]) => {
        const paddedLabel = label.padEnd(labelWidth);
        const sign = d.after - d.before <= 0 ? '' : '+';
        const net = d.after - d.before;
        return `  ${paddedLabel}: ${d.before} → ${d.after} (${sign}${net}, -${d.resolved} resolved, +${d.added} new)`;
    });
}
//# sourceMappingURL=baseline-deltas.js.map