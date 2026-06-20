import { spawnSync } from 'child_process';
// ── Implementation ─────────────────────────────────────────────────────────────
const MAX_FILES = 200; // cap on changed-file count to prevent unbounded IN clauses
const MAX_STDOUT = 1_048_576; // 1 MiB stdout cap for git output
export function detectMonographChanges(db, input, repoPath) {
    const rawBranch = input.baseBranch ?? 'main';
    // Reject branch names that could be shell-injected or path-traversed
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(rawBranch)) {
        return { changedFiles: [], affectedSymbols: [], affectedProcesses: [], error: `Invalid branch name: ${rawBranch}` };
    }
    const baseBranch = rawBranch;
    const includeTests = input.includeTests ?? true;
    let changedFiles;
    try {
        // Use spawnSync with argument array to eliminate shell injection entirely
        const result = spawnSync('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
            cwd: repoPath,
            encoding: 'utf-8',
            maxBuffer: MAX_STDOUT,
        });
        if (result.error)
            throw result.error;
        if (result.status !== 0)
            throw new Error(result.stderr ?? `git exited ${result.status}`);
        const output = (result.stdout ?? '').slice(0, MAX_STDOUT).trim();
        changedFiles = output
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.length > 0)
            .slice(0, MAX_FILES); // cap to prevent unbounded IN clauses
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { changedFiles: [], affectedSymbols: [], affectedProcesses: [], error: message };
    }
    // Filter out test files if requested
    if (!includeTests) {
        changedFiles = changedFiles.filter(f => !(/\.(test|spec)\./.test(f)));
    }
    if (changedFiles.length === 0) {
        return { changedFiles: [], affectedSymbols: [], affectedProcesses: [] };
    }
    // Query DB for symbols in changed files (batch if needed)
    let affectedSymbols = [];
    let affectedSymbolIds = [];
    try {
        // Process in batches of 50 to keep SQLite IN clause size bounded
        const BATCH = 50;
        const allRows = [];
        for (let i = 0; i < changedFiles.length; i += BATCH) {
            const batch = changedFiles.slice(i, i + BATCH);
            const placeholders = batch.map(() => '?').join(',');
            const rows = db
                .prepare(`SELECT id, name, file_path, label FROM nodes WHERE file_path IN (${placeholders})`)
                .all(...batch);
            allRows.push(...rows);
        }
        affectedSymbols = allRows.map(r => ({ name: r.name, filePath: r.file_path, label: r.label }));
        affectedSymbolIds = allRows.map(r => r.id);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { changedFiles, affectedSymbols: [], affectedProcesses: [], error: message };
    }
    // Find processes that contain any of the affected symbols as steps
    // STEP_IN_PROCESS: process → step_symbol
    let affectedProcesses = [];
    if (affectedSymbolIds.length > 0) {
        try {
            // Also batch symbol IDs to keep IN clause bounded
            const BATCH = 50;
            const processSet = new Map();
            for (let i = 0; i < affectedSymbolIds.length; i += BATCH) {
                const batch = affectedSymbolIds.slice(i, i + BATCH);
                const placeholders = batch.map(() => '?').join(',');
                const processRows = db
                    .prepare(`SELECT DISTINCT n.id, n.name
             FROM nodes n JOIN edges e ON n.id = e.source_id
             WHERE e.relation = 'STEP_IN_PROCESS' AND e.target_id IN (${placeholders})`)
                    .all(...batch);
                for (const row of processRows)
                    processSet.set(row.id, row.name);
            }
            affectedProcesses = Array.from(processSet.entries()).map(([id, name]) => ({ id, name }));
        }
        catch {
            // Non-fatal: return what we have
        }
    }
    return { changedFiles, affectedSymbols, affectedProcesses };
}
//# sourceMappingURL=detect-changes.js.map