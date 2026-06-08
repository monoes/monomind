export function createSubsetFilter(roots) {
    // Normalize roots to ensure they end with '/'
    const normalizedRoots = roots.map((root) => (root.endsWith('/') ? root : root + '/'));
    return {
        roots: normalizedRoots,
        test(filePath) {
            return normalizedRoots.some((root) => filePath.startsWith(root));
        },
    };
}
export function filterToWorkspaces(items, workspaceRoots) {
    const filter = createSubsetFilter(workspaceRoots);
    return items.filter((item) => item.filePath != null && filter.test(item.filePath));
}
export function filterGroupsByWorkspace(groups, workspaceRoots) {
    const filter = createSubsetFilter(workspaceRoots);
    return groups.filter((group) => group.instances.some((instance) => filter.test(instance.filePath)));
}
/** Parse a workspace filter string into a structured pattern. */
export function parseWorkspaceFilterPattern(raw) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    const isGlob = pattern.includes('*') || pattern.includes('?');
    return { pattern, negated, isGlob };
}
/** Match a workspace name against a gitignore-style pattern (supports ! negation and globs). */
export function matchWorkspacePattern(name, pattern) {
    if (pattern.isGlob) {
        const re = new RegExp('^' + pattern.pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        return re.test(name);
    }
    return name === pattern.pattern;
}
/** Resolve a list of workspace names against a list of filter patterns with negation. */
export function resolveWorkspaceFilters(names, patterns) {
    if (patterns.length === 0)
        return names;
    const parsed = patterns.map(parseWorkspaceFilterPattern);
    return names.filter(name => {
        let included = false;
        for (const p of parsed) {
            if (matchWorkspacePattern(name, p)) {
                included = !p.negated;
            }
        }
        return included;
    });
}
/** Format available workspace names for display, capping at 10 with overflow count. */
export function formatAvailableWorkspaces(names) {
    const MAX = 10;
    if (names.length <= MAX)
        return names.join(', ');
    return `${names.slice(0, MAX).join(', ')} ... and ${names.length - MAX} more (${names.length} total)`;
}
/** Map a set of changed file paths to workspace indices that contain at least one changed file. */
export function workspacesContainingAny(changedFiles, workspaceRoots) {
    const indices = [];
    for (let i = 0; i < workspaceRoots.length; i++) {
        const root = workspaceRoots[i].replace(/\\/g, '/').replace(/\/$/, '');
        if (changedFiles.some(f => f.replace(/\\/g, '/').startsWith(root + '/'))) {
            indices.push(i);
        }
    }
    return indices;
}
//# sourceMappingURL=workspace-filter.js.map