export function makeProjectState(files, workspaces) {
    const pathToId = new Map(files.map(f => [f.path, f.fileId]));
    return { files, pathToId, workspaces };
}
export function fileById(state, fileId) {
    return state.files.find(f => f.fileId === fileId);
}
export function idForPath(state, filePath) {
    return state.pathToId.get(filePath);
}
export function workspaceForFile(state, fileId) {
    const file = fileById(state, fileId);
    if (!file)
        return undefined;
    const normalized = file.path.replace(/\\/g, '/');
    let bestMatch;
    let bestLen = 0;
    for (const ws of state.workspaces) {
        const wsPath = ws.root.replace(/\\/g, '/');
        if (normalized.startsWith(wsPath + '/') || normalized === wsPath) {
            if (wsPath.length > bestLen) {
                bestLen = wsPath.length;
                bestMatch = ws;
            }
        }
    }
    return bestMatch;
}
export function filesInWorkspace(state, workspace) {
    const wsPath = workspace.root.replace(/\\/g, '/');
    return state.files.filter(f => {
        const fp = f.path.replace(/\\/g, '/');
        return fp.startsWith(wsPath + '/') || fp === wsPath;
    });
}
export class PackageResolver {
    entries;
    constructor(workspaces) {
        this.entries = workspaces
            .filter(w => w.name)
            .map(w => ({ root: w.root, name: w.name }))
            .sort((a, b) => b.root.length - a.root.length);
    }
    resolvePackage(filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        for (const entry of this.entries) {
            const rootNorm = entry.root.replace(/\\/g, '/');
            if (normalized.startsWith(rootNorm + '/') || normalized === rootNorm) {
                return entry.name;
            }
        }
        return undefined;
    }
    resolveRoot(packageName) {
        return this.entries.find(e => e.name === packageName)?.root;
    }
}
//# sourceMappingURL=project-state.js.map