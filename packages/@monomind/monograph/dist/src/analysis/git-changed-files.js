import { execSync } from 'node:child_process';
import * as path from 'node:path';
const GIT_REF_ALLOWLIST = /^[a-zA-Z0-9._/~^@{}[\]:-]+$/;
const DANGEROUS_PATTERNS = /\.\.|`|\$\(|;|&&|\|\|/;
export function validateGitRef(ref) {
    if (!GIT_REF_ALLOWLIST.test(ref) || DANGEROUS_PATTERNS.test(ref)) {
        throw new Error(`Invalid git ref: ${JSON.stringify(ref)} — only alphanumeric, dots, slashes, hyphens, and common git ref characters are allowed`);
    }
}
export function resolveGitToplevel(cwd) {
    try {
        return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim();
    }
    catch {
        return cwd;
    }
}
export function collectGitPaths(root, since) {
    try {
        let cmd;
        if (since) {
            validateGitRef(since);
            cmd = `git diff --name-only --diff-filter=ACM ${since}`;
        }
        else {
            cmd = 'git ls-files';
        }
        const output = execSync(cmd, { cwd: root, encoding: 'utf8' });
        return output
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(l => path.resolve(root, l));
    }
    catch {
        return [];
    }
}
export function tryGetChangedFiles(root, since) {
    if (!since)
        return null;
    try {
        validateGitRef(since);
        return collectGitPaths(root, since);
    }
    catch {
        return null;
    }
}
export function filterResultsByChangedFiles(results, changedFiles) {
    const changedSet = new Set(changedFiles.map(f => path.normalize(f)));
    return results.filter(r => changedSet.has(path.normalize(r.filePath)));
}
export function getChangedFilesSince(root, since) {
    validateGitRef(since);
    return collectGitPaths(root, since);
}
//# sourceMappingURL=git-changed-files.js.map