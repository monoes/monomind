import * as path from 'node:path';
import { totalIssues } from '../results/types.js';
import { buildSectionHeader, thousands } from './number-format.js';
export function buildGroupedJsonOutput(groups, opts) {
    const schemaVersion = opts.schemaVersion ?? 4;
    const groupsJson = groups.map(g => ({
        key: g.key,
        owner: g.owner,
        root: g.root ? path.relative(opts.root, g.root) : undefined,
        issueCount: totalIssues(g.results),
        results: g.results,
    }));
    return {
        $schema: `https://monograph.dev/schema/v${schemaVersion}/grouped-results.json`,
        schemaVersion,
        root: opts.root,
        groupCount: groups.length,
        totalIssues: groups.reduce((s, g) => s + totalIssues(g.results), 0),
        groups: groupsJson,
    };
}
export function buildGroupedTextLines(groups, opts) {
    const lines = [];
    const nonEmpty = opts.showEmpty ? groups : groups.filter(g => totalIssues(g.results) > 0);
    if (nonEmpty.length === 0) {
        lines.push('No issues found across all groups.');
        return lines;
    }
    lines.push(buildSectionHeader(`Groups with issues`, nonEmpty.length));
    lines.push('');
    const shown = opts.maxGroupsInText
        ? nonEmpty.slice(0, opts.maxGroupsInText)
        : nonEmpty;
    for (const group of shown) {
        const count = totalIssues(group.results);
        const label = group.owner ?? group.key;
        lines.push(`  ${label}: ${thousands(count)} issue${count === 1 ? '' : 's'}`);
        if (group.results.unusedFiles.length > 0)
            lines.push(`    • unused files: ${group.results.unusedFiles.length}`);
        if (group.results.unusedExports.length > 0)
            lines.push(`    • unused exports: ${group.results.unusedExports.length}`);
        if (group.results.unusedDependencies.length > 0)
            lines.push(`    • unused deps: ${group.results.unusedDependencies.length}`);
        if (group.results.circularDependencies.length > 0)
            lines.push(`    • circular deps: ${group.results.circularDependencies.length}`);
    }
    if (opts.maxGroupsInText && nonEmpty.length > opts.maxGroupsInText) {
        lines.push(`  … and ${nonEmpty.length - opts.maxGroupsInText} more groups`);
    }
    return lines;
}
export function buildGroupedCompactLines(groups, root) {
    return groups
        .filter(g => totalIssues(g.results) > 0)
        .map(g => {
        const label = g.owner ?? g.key;
        const count = totalIssues(g.results);
        return `${label}:${count}`;
    });
}
export function partitionGroupsByOwner(groups, ownerFilter) {
    const matched = [];
    const unmatched = [];
    for (const g of groups) {
        if (g.owner && ownerFilter(g.owner))
            matched.push(g);
        else
            unmatched.push(g);
    }
    return { matched, unmatched };
}
//# sourceMappingURL=output-grouped.js.map