import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
function globWorkspacePattern(repoPath, pattern) {
    if (!pattern.includes('*')) {
        return [join(repoPath, pattern)];
    }
    const [base] = pattern.split('/*');
    const baseDir = join(repoPath, base ?? '');
    if (!existsSync(baseDir))
        return [];
    try {
        return readdirSync(baseDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => join(baseDir, d.name));
    }
    catch {
        return [];
    }
}
export function detectWorkspacePackages(repoPath) {
    const pkgPath = join(repoPath, 'package.json');
    if (!existsSync(pkgPath))
        return [];
    let workspaceGlobs = [];
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const ws = pkg.workspaces;
        if (Array.isArray(ws))
            workspaceGlobs = ws;
        else if (ws && Array.isArray(ws.packages))
            workspaceGlobs = ws.packages;
    }
    catch {
        return [];
    }
    const result = [];
    for (const glob of workspaceGlobs) {
        const dirs = globWorkspacePattern(repoPath, glob);
        for (const dir of dirs) {
            const subPkgPath = join(dir, 'package.json');
            if (!existsSync(subPkgPath))
                continue;
            try {
                const subPkg = JSON.parse(readFileSync(subPkgPath, 'utf8'));
                if (subPkg.name) {
                    result.push({ name: subPkg.name, path: resolve(dir) });
                }
            }
            catch { /* skip */ }
        }
    }
    return result;
}
export function resolveWorkspaceImport(importSpecifier, packages) {
    for (const pkg of packages) {
        if (importSpecifier === pkg.name || importSpecifier.startsWith(pkg.name + '/')) {
            return pkg.path;
        }
    }
    return null;
}
export const importResolverPhase = {
    name: 'import-resolver',
    deps: ['cross-file'],
    async execute(ctx) {
        const workspacePackages = detectWorkspacePackages(ctx.repoPath);
        return { workspacePackages, resolvedCount: 0 };
    },
};
//# sourceMappingURL=import-resolver.js.map