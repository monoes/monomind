import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
function findWorkspaceRoots(projectRoot) {
    // Detect pnpm/npm/yarn workspaces
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    }
    catch {
        return [];
    }
    const workspaceGlobs = pkg['workspaces'] instanceof Array
        ? pkg['workspaces']
        : pkg['workspaces']?.packages ?? [];
    if (workspaceGlobs.length === 0)
        return [];
    const roots = [];
    for (const glob of workspaceGlobs) {
        // Simple glob: support "packages/*" and "apps/*"
        if (glob.endsWith('/*')) {
            const dir = join(projectRoot, glob.slice(0, -2));
            try {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (e.isDirectory())
                        roots.push(join(dir, e.name));
                }
            }
            catch { /* ignore */ }
        }
        else {
            const absPath = join(projectRoot, glob);
            if (existsSync(absPath))
                roots.push(absPath);
        }
    }
    return roots;
}
export function getChangedWorkspaces(projectRoot, sinceRef, workspaceRoots) {
    // Validate git ref (same allowlist as changed-files.ts)
    if (!/^[a-zA-Z0-9\-_./@~^]+$/.test(sinceRef)) {
        throw new Error(`Invalid git ref: "${sinceRef}"`);
    }
    let changedFiles;
    try {
        const raw = execSync(`git -C "${projectRoot}" diff --name-only "${sinceRef}"...HEAD`, { encoding: 'utf8' });
        changedFiles = new Set(raw.split('\n').map(l => l.trim()).filter(Boolean));
    }
    catch {
        changedFiles = new Set();
    }
    const roots = workspaceRoots ?? findWorkspaceRoots(projectRoot);
    return roots.map(root => {
        const relRoot = relative(projectRoot, root).replace(/\\/g, '/') + '/';
        const hasChanges = [...changedFiles].some(f => f.startsWith(relRoot));
        const pkgName = root.split(/[\\/]/).pop() ?? root;
        return { name: pkgName, root: resolve(root), hasChanges };
    });
}
export function resolveChangedWorkspaceRoots(projectRoot, sinceRef, workspaceRoots) {
    return getChangedWorkspaces(projectRoot, sinceRef, workspaceRoots)
        .filter(w => w.hasChanges)
        .map(w => w.root);
}
//# sourceMappingURL=changed-workspaces.js.map