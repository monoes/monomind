/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 */
import { statSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
/**
 * Returns the effective project working directory.
 * Prefers MONOMIND_CWD (set by the install script for global/MCP installs
 * where process.cwd() may resolve to '/') over the real process.cwd().
 */
export function getProjectCwd() {
    return process.env.MONOMIND_CWD || process.cwd();
}
/**
 * Returns the stable Monomind data root that survives branch switches and is
 * shared across all git worktrees of the same repository.
 *
 * Resolution order:
 *   1. MONOMIND_DATA_DIR env var — allows overriding to e.g. ~/.monomind/<project>
 *   2. <repo>/.git/monomind/     — regular repo (branch-agnostic, shared by design)
 *   3. <main-repo>/.git/monomind/— worktree: .git is a pointer file → resolve to
 *                                  the shared .git dir of the main worktree
 *   4. <cwd>/.monomind/          — fallback when git is unavailable
 *
 * Mirrors the _getGitMonomindDir() function in server.mjs so session, task,
 * memory, and org data all land in the same stable location.
 */
const _dataRootCache = new Map();
export function getMonomindDataRoot(cwd) {
    if (process.env.MONOMIND_DATA_DIR)
        return process.env.MONOMIND_DATA_DIR;
    const workDir = cwd || getProjectCwd();
    if (_dataRootCache.has(workDir))
        return _dataRootCache.get(workDir);
    let result;
    try {
        const gitEntry = join(workDir, '.git');
        const st = statSync(gitEntry);
        if (st.isDirectory()) {
            result = join(gitEntry, 'monomind');
        }
        else {
            // Worktree: .git is a text file "gitdir: /main/.git/worktrees/name"
            const m = readFileSync(gitEntry, 'utf8').match(/^gitdir:\s*(.+)/m);
            if (m) {
                const worktreeDir = resolve(workDir, m[1].trim());
                const commonGitDir = dirname(dirname(worktreeDir));
                result = join(commonGitDir, 'monomind');
            }
            else {
                result = join(workDir, '.monomind');
            }
        }
    }
    catch {
        result = join(workDir, '.monomind');
    }
    _dataRootCache.set(workDir, result);
    return result;
}
//# sourceMappingURL=types.js.map