import { spawnSync } from 'child_process';
import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';

// ── Output type ────────────────────────────────────────────────────────────────

export interface MonographDetectChangesResult {
  changedFiles: string[];
  affectedSymbols: Array<{ name: string; filePath: string; label: string }>;
  affectedProcesses: Array<{ id: string; name: string }>;
  error?: string;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export function detectMonographChanges(
  db: Database.Database,
  input: { baseBranch?: string; includeTests?: boolean },
  repoPath: string,
): MonographDetectChangesResult {
  const rawBranch = input.baseBranch ?? 'main';
  // Reject branch names that could be shell-injected or path-traversed
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(rawBranch)) {
    return { changedFiles: [], affectedSymbols: [], affectedProcesses: [], error: `Invalid branch name: ${rawBranch}` };
  }
  const baseBranch = rawBranch;
  const includeTests = input.includeTests ?? true;

  let changedFiles: string[];

  try {
    // Use spawnSync with argument array to eliminate shell injection entirely
    const result = spawnSync('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr ?? `git exited ${result.status}`);
    const output = result.stdout.trim();

    changedFiles = output
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);
  } catch (err) {
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

  // Query DB for symbols in changed files
  let affectedSymbols: Array<{ name: string; filePath: string; label: string }> = [];
  let affectedSymbolIds: string[] = [];

  try {
    const placeholders = changedFiles.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id, name, file_path, label FROM nodes WHERE file_path IN (${placeholders})`)
      .all(...changedFiles) as Array<{ id: string; name: string; file_path: string; label: string }>;

    affectedSymbols = rows.map(r => ({
      name: r.name,
      filePath: r.file_path,
      label: r.label,
    }));
    affectedSymbolIds = rows.map(r => r.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { changedFiles, affectedSymbols: [], affectedProcesses: [], error: message };
  }

  // Find processes that contain any of the affected symbols as steps
  // STEP_IN_PROCESS: process → step_symbol
  let affectedProcesses: Array<{ id: string; name: string }> = [];

  if (affectedSymbolIds.length > 0) {
    try {
      const placeholders = affectedSymbolIds.map(() => '?').join(',');
      const processRows = db
        .prepare(
          `SELECT DISTINCT n.id, n.name
           FROM nodes n JOIN edges e ON n.id = e.source_id
           WHERE e.relation = 'STEP_IN_PROCESS' AND e.target_id IN (${placeholders})`,
        )
        .all(...affectedSymbolIds) as Array<{ id: string; name: string }>;
      affectedProcesses = processRows;
    } catch {
      // Non-fatal: return what we have
    }
  }

  return { changedFiles, affectedSymbols, affectedProcesses };
}
