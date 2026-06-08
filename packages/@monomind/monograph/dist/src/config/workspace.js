// Discovers monorepo workspace packages, detects undeclared workspaces,
// and parses tsconfig rootDir.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
export function discoverWorkspaces(root) {
    const pkgPath = join(root, 'package.json');
    const pkg = readJson(pkgPath);
    if (!pkg)
        return [];
    const patterns = [];
    if (Array.isArray(pkg['workspaces'])) {
        patterns.push(...pkg['workspaces']);
    }
    else if (typeof pkg['workspaces'] === 'object' && pkg['workspaces'] !== null) {
        const ws = pkg['workspaces'];
        if (Array.isArray(ws['packages']))
            patterns.push(...ws['packages']);
    }
    const results = [];
    for (const pattern of patterns) {
        const base = pattern.replace(/\/\*$/, '');
        const dir = resolve(root, base);
        if (!existsSync(dir))
            continue;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const wsPkgPath = join(dir, entry.name, 'package.json');
                const wsPkg = readJson(wsPkgPath);
                if (!wsPkg)
                    continue;
                results.push({
                    name: wsPkg['name'] ?? entry.name,
                    rootPath: resolve(dir, entry.name),
                    packageJson: wsPkg,
                });
            }
        }
        catch { /* skip unreadable dirs */ }
    }
    return results;
}
export function findUndeclaredWorkspaces(root, declared, ignores = []) {
    const declaredPaths = new Set(declared.map(w => resolve(w.rootPath)));
    const diagnostics = [];
    const packagesDir = join(root, 'packages');
    if (!existsSync(packagesDir))
        return diagnostics;
    try {
        const entries = readdirSync(packagesDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            if (ignores.includes(entry.name))
                continue;
            const candidate = resolve(packagesDir, entry.name);
            if (declaredPaths.has(candidate))
                continue;
            const hasPkg = existsSync(join(candidate, 'package.json'));
            if (hasPkg) {
                diagnostics.push({
                    kind: 'undeclaredWorkspace',
                    message: `Directory "${entry.name}" has package.json but is not in workspaces`,
                    path: candidate,
                });
            }
        }
    }
    catch { /* skip */ }
    return diagnostics;
}
export function parseTsconfigRootDir(tsconfigPath) {
    const json = readJson(tsconfigPath);
    if (!json)
        return null;
    const co = json['compilerOptions'];
    const rootDir = co?.['rootDir'];
    return typeof rootDir === 'string' ? rootDir : null;
}
export function findUndeclaredWorkspacesEnhanced(root, declared, ignores = []) {
    const basic = findUndeclaredWorkspaces(root, declared, ignores);
    return basic.map(d => ({
        ...d,
        suggestion: `Add "${d.path.replace(root, '').replace(/^\//, '')}" to the workspaces array in package.json`,
    }));
}
export function validateWorkspaceDeclarations(declared, root) {
    const diagnostics = [];
    for (const ws of declared) {
        if (!ws.packageJson['name']) {
            diagnostics.push({ kind: 'missingPackageJson', message: `Workspace at "${ws.rootPath.replace(root, '')}" has no name field`, path: ws.rootPath });
        }
    }
    return diagnostics;
}
//# sourceMappingURL=workspace.js.map