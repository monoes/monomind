export const UNOWNED_LABEL = '(unowned)';
export const NO_SECTION_LABEL = '(no section)';
export function ownerCountOf(co, relativePath) {
    if (co.ownerAndRuleOf) {
        const match = co.ownerAndRuleOf(relativePath);
        if (!match)
            return null;
        return match.ownerCount;
    }
    const owners = co.ownersOf(relativePath);
    if (owners === null)
        return null;
    return owners.length;
}
export function sectionOf(co, relativePath) {
    if (!co.sectionAndOwnersOf)
        return undefined;
    const match = co.sectionAndOwnersOf(relativePath);
    if (!match)
        return undefined;
    return match.sectionName;
}
export function sectionAndOwnersOf(co, relativePath) {
    if (!co.sectionAndOwnersOf)
        return null;
    return co.sectionAndOwnersOf(relativePath) ?? null;
}
export function hasGitLabSections(co) {
    return co.hasSections ?? false;
}
export function ownerLabel(co, relativePath) {
    const owners = co.ownersOf(relativePath);
    if (owners === null)
        return UNOWNED_LABEL;
    if (owners.length === 0) {
        const section = sectionOf(co, relativePath);
        if (section === null)
            return NO_SECTION_LABEL;
        return UNOWNED_LABEL;
    }
    return owners[0];
}
/**
 * Aggregate ownership across a list of relative paths in a single pass.
 * Each file is attributed to its primary owner (first in the owners list).
 */
export function aggregateOwnership(co, relativePaths) {
    const unowned = [];
    const byOwner = new Map();
    for (const path of relativePaths) {
        const owners = co.ownersOf(path);
        if (!owners || owners.length === 0) {
            unowned.push(path);
        }
        else {
            const primary = owners[0];
            let bucket = byOwner.get(primary);
            if (!bucket) {
                bucket = [];
                byOwner.set(primary, bucket);
            }
            bucket.push(path);
        }
    }
    return { unowned, byOwner, totalFiles: relativePaths.length };
}
/**
 * Format an OwnershipAggregate as structured text for LLM consumption.
 */
export function formatOwnershipReport(agg) {
    const lines = [
        `Ownership report: ${agg.totalFiles} files, ${agg.byOwner.size} owner(s), ${agg.unowned.length} unowned`,
        '',
    ];
    // Sort owners by file count descending
    const sorted = Array.from(agg.byOwner.entries()).sort((a, b) => b[1].length - a[1].length);
    for (const [owner, files] of sorted) {
        lines.push(`  ${owner}: ${files.length} file(s)`);
    }
    if (agg.unowned.length > 0) {
        lines.push(`  ${UNOWNED_LABEL}: ${agg.unowned.length} file(s)`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=codeowners-extended.js.map