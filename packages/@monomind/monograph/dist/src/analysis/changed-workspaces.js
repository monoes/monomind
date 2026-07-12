import { execFileSync } from 'child_process';
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
    // Validate git ref (same allowlist as changed-files.ts). Leading '-' is
    // rejected explicitly so a value like "--output=/tmp/pwned" can't be
    // interpreted by git as a command-line option (git option injection).
    if (sinceRef.startsWith('-')) {
        throw new Error(`Invalid git ref: "${sinceRef}". Refs must not start with '-' (would be interpreted as a git option)`);
    }
    if (!/^[a-zA-Z0-9\-_./@~^]+$/.test(sinceRef)) {
        throw new Error(`Invalid git ref: "${sinceRef}"`);
    }
    let changedFiles;
    try {
        // execFileSync with array argv — no shell involved, so a `projectRoot`
        // containing '"' or '$(...)' cannot break out and execute arbitrary
        // commands.
        const raw = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', `${sinceRef}...HEAD`], { encoding: 'utf8' });
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