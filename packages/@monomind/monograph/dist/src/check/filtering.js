import * as path from 'node:path';
export function filterToWorkspaces(results, wsRoots) {
    if (wsRoots.length === 0)
        return results;
    return results.filter(r => wsRoots.some(root => r.filePath === root || r.filePath.startsWith(root + path.sep)));
}
export function resolveWorkspaceFilters(root, patterns, allWorkspaceRoots) {
    const positive = [];
    const negative = [];
    for (const p of patterns) {
        if (p.startsWith('!'))
            negative.push(p.slice(1));
        else
            positive.push(p);
    }
    let matches = positive.length > 0
        ? allWorkspaceRoots.filter(ws => positive.some(p => matchWorkspacePattern(ws, p, root)))
        : allWorkspaceRoots;
    if (negative.length > 0) {
        matches = matches.filter(ws => !negative.some(p => matchWorkspacePattern(ws, p, root)));
    }
    return matches;
}
export function resolveWorkspaceScope(root, workspacePatterns, changedWorkspaces, allWorkspaceRoots) {
    if (!workspacePatterns && !changedWorkspaces)
        return [];
    let scope = workspacePatterns
        ? resolveWorkspaceFilters(root, workspacePatterns, allWorkspaceRoots)
        : allWorkspaceRoots;
    if (changedWorkspaces) {
        const changedSet = new Set(changedWorkspaces.split(',').map(s => path.resolve(root, s.trim())));
        scope = scope.filter(ws => changedSet.has(ws));
    }
    return scope;
}
export function getChangedFiles(root, since, workspaces) {
    return [];
}
function matchWorkspacePattern(wsRoot, pattern, root) {
    const rel = path.relative(root, wsRoot).replace(/\\/g, '/');
    if (pattern.includes('*')) {
        const re = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
        return re.test(rel);
    }
    return rel === pattern || wsRoot === pattern || wsRoot.endsWith(path.sep + pattern);
}
//# sourceMappingURL=filtering.js.map