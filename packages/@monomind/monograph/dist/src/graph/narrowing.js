export function isUnusedImportBinding(importedName, accessedMembers) {
    return !accessedMembers.has(importedName);
}
export function extractAccessedMembers(usages) {
    const members = new Set();
    let hasNamespaceAccess = false;
    for (const usage of usages) {
        const dotIdx = usage.indexOf('.');
        if (dotIdx === -1) {
            hasNamespaceAccess = true;
        }
        else {
            const member = usage.slice(dotIdx + 1);
            if (member)
                members.add(member);
        }
    }
    return { members, hasNamespaceAccess };
}
export function markAllExportsReferenced(exports) {
    return new Set(exports);
}
export function markMemberExportsReferenced(exports, accessed) {
    if (accessed.hasNamespaceAccess) {
        return new Set(exports);
    }
    const result = new Set();
    for (const exp of exports) {
        if (accessed.members.has(exp)) {
            result.add(exp);
        }
    }
    return result;
}
/**
 * Given a file's exports and the accessed members from all import sites,
 * return a report of which exports are unused.
 */
export function filterUnusedExports(filePath, exports, accessed) {
    const referenced = markMemberExportsReferenced(exports, accessed);
    const unusedExports = [];
    for (const exp of exports) {
        if (!referenced.has(exp))
            unusedExports.push(exp);
    }
    return {
        filePath,
        totalExports: exports.length,
        referencedExports: Array.from(referenced),
        unusedExports,
    };
}
/**
 * Format narrowing reports as structured text for LLM dead-import diagnostics.
 */
export function formatNarrowingReport(reports) {
    const withUnused = reports.filter(r => r.unusedExports.length > 0);
    if (withUnused.length === 0)
        return 'No unused exports found.';
    const lines = [`Unused exports in ${withUnused.length} file(s):`, ''];
    for (const r of withUnused) {
        lines.push(`  ${r.filePath} (${r.unusedExports.length}/${r.totalExports} unused)`);
        for (const exp of r.unusedExports)
            lines.push(`    - ${exp}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=narrowing.js.map