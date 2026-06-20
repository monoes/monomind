export function makeProjectState(files, workspaces) {
    // Build both lookup maps in a single pass to avoid intermediate arrays
    const pathToId = new Map();
    const idToFile = new Map();
    for (const f of files) {
        pathToId.set(f.path, f.fileId);
        idToFile.set(f.fileId, f);
    }
    return { files, pathToId, idToFile, workspaces };
}
export function fileById(state, fileId) {
    // O(1) lookup via idToFile map instead of O(N) linear scan
    return state.idToFile.get(fileId);
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
        // Combine filter + map into a single for-of loop to avoid 2 intermediate arrays
        const named = [];
        for (const w of workspaces) {
            if (w.name)
                named.push({ root: w.root, name: w.name });
        }
        named.sort((a, b) => b.root.length - a.root.length);
        this.entries = named;
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