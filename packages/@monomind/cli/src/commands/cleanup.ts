/**
 * CLI Cleanup Command
 * Removes project artifacts created by monomind/monomind
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, lstatSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Artifact directories and files that monomind/monomind may create
 */
const ARTIFACT_DIRS = [
  { path: '.claude', description: 'Claude settings, helpers, agents' },
  { path: '.monomind', description: 'Capabilities and configuration' },
  { path: 'data', description: 'Memory databases' },
  { path: '.swarm', description: 'Swarm state' },
  { path: '.hive-mind', description: 'Consensus state' },
  { path: 'coordination', description: 'Coordination data' },
  { path: 'memory', description: 'Memory storage' },
];

const ARTIFACT_FILES = [
  { path: 'monomind.config.json', description: 'Monomind configuration' },
];

/**
 * Paths to preserve when --keep-config is set
 */
const KEEP_CONFIG_PATHS = [
  'monomind.config.json',
  join('.claude', 'settings.json'),
];

/** Scratch pruning (--scratch): taskdev handoff files and loop state. */
// monolean: manual flag only — upgrade path: invoke from the `cache` background worker so crashed-run scratch is pruned without anyone remembering the flag
const SCRATCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // taskdev scratch older than this is stale
const LOOP_STALE_GRACE_MS = 24 * 60 * 60 * 1000;      // a live loop reschedules every <=1h; overdue by a day = abandoned

/** A single stale-scratch candidate returned by {@link findStaleScratch}. */
interface StaleScratchItem {
  path: string;
  description: string;
  size: number;
}

/** Orphaned per-project data (--data): ~/.monomind/projects/<slug> dirs whose
 * source project is gone, plus dead lancedb/ dirs left by the pre-2.3.1 engine. */
const UNKNOWN_DIR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Find prunable entries under the per-project data base (default
 * ~/.monomind/projects). Exported for tests — `baseDir`/`now` injectable.
 *
 * Classification per dir:
 * - `origin.json` present and its recorded path still exists → keep the dir,
 *   but flag a leftover `lancedb/` subdir (dead since the SQLite engine swap).
 * - `origin.json` present, recorded path gone → orphaned → prune.
 * - no `origin.json` (pre-2.3.1 dirs can't prove their origin) → prune only
 *   when untouched for {@link UNKNOWN_DIR_MAX_AGE_MS} — or immediately with
 *   `--aggressive`, which treats unprovable dirs as junk (safe: every live
 *   project rewrites origin.json on its next memory access).
 */
export function findOrphanedProjectData(baseDir: string, now: number, aggressive: boolean): StaleScratchItem[] {
  const out: StaleScratchItem[] = [];
  if (!existsSync(baseDir)) return out;
  for (const name of readdirSync(baseDir)) {
    if (name.startsWith('.')) continue;
    const dir = join(baseDir, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
    } catch { continue; }
    // Staleness must consider the files writes actually touch: appends to
    // lancedb/memory.db and origin.json refreshes do NOT bump the slug dir's
    // own mtime, so an actively-used project would otherwise look 30d stale.
    const mtimeOf = (p: string): number => { try { return lstatSync(p).mtimeMs; } catch { return 0; } };
    const mtime = Math.max(mtimeOf(dir), mtimeOf(join(dir, 'origin.json')),
      mtimeOf(join(dir, 'lancedb', 'memory.db')), mtimeOf(join(dir, 'memory.db')));
    const originFile = join(dir, 'origin.json');
    let originPath: string | null = null;
    let hasOrigin = false;
    try {
      originPath = String(JSON.parse(readFileSync(originFile, 'utf-8')).path ?? '');
      hasOrigin = originPath.length > 0;
    } catch { /* no/corrupt marker */ }
    if (hasOrigin && originPath && existsSync(originPath)) {
      // NOTE: the directory is *named* lancedb for historical reasons, but the
      // current SQLite engine keeps its LIVE memory.db inside it. Only genuine
      // LanceDB leftovers (*.lance datasets, no memory.db) are dead weight.
      const lance = join(dir, 'lancedb');
      if (existsSync(lance) && !existsSync(join(lance, 'memory.db'))) {
        let hasLanceData = false;
        try { hasLanceData = readdirSync(lance).some(f => f.endsWith('.lance') || f === '__manifest'); } catch { /* unreadable — leave it */ }
        if (hasLanceData) out.push({ path: lance, description: `dead lancedb store (project: ${originPath})`, size: 0 });
      }
      continue;
    }
    if (hasOrigin && originPath) {
      // Only classify as orphaned when the origin's PARENT exists — an
      // unmounted volume / disconnected network share makes the whole subtree
      // vanish temporarily, and that must never count as "project deleted".
      if (existsSync(dirname(originPath))) {
        out.push({ path: dir, description: `orphaned project data (origin gone: ${originPath})`, size: 0 });
      }
    } else if (aggressive || now - mtime > UNKNOWN_DIR_MAX_AGE_MS) {
      out.push({ path: dir, description: aggressive ? 'unverifiable project data (no origin marker)' : 'unverifiable project data (untouched >30d)', size: 0 });
    }
  }
  return out;
}

/**
 * Find stale mastermind scratch under `.monomind/taskdev/` and `.monomind/loops/`.
 * Exported for tests. Never returns `progress.md` (the taskdev recovery ledger),
 * directories, or loop JSON it cannot parse — deleting the unclassifiable loses data.
 *
 * A loop JSON is only ever classified as abandoned when it has a real, positive,
 * numeric `nextRunAt` timestamp that is more than a day in the past. Live producers
 * write `nextRunAt: 0` (real /do loops) or `nextRunAt: null` (dashboard) — those,
 * along with missing/non-numeric values, are never eligible for deletion regardless
 * of `status`, since a crashed daemon can leave a stale `status: 'running'` behind.
 */
export function findStaleScratch(cwd: string, now: number): StaleScratchItem[] {
  const out: StaleScratchItem[] = [];
  const taskdevDir = join(cwd, '.monomind', 'taskdev');
  if (existsSync(taskdevDir)) {
    for (const f of readdirSync(taskdevDir)) {
      if (f === 'progress.md') continue; // the ledger is the recovery map — never auto-prune
      try {
        const st = lstatSync(join(taskdevDir, f));
        if (st.isFile() && now - st.mtimeMs > SCRATCH_MAX_AGE_MS) {
          out.push({ path: join('.monomind', 'taskdev', f), description: 'stale taskdev scratch', size: st.size });
        }
      } catch { /* raced away or unreadable — leave it */ }
    }
  }
  const loopsDir = join(cwd, '.monomind', 'loops');
  if (existsSync(loopsDir)) {
    const entries = readdirSync(loopsDir);
    const jsonStems = new Set(entries.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')));
    for (const f of entries) {
      try {
        const st = lstatSync(join(loopsDir, f));
        if (!st.isFile()) continue;
        if (f.endsWith('.json')) {
          const parsed = JSON.parse(readFileSync(join(loopsDir, f), 'utf8')) as { nextRunAt?: unknown; status?: unknown };
          const { nextRunAt } = parsed;
          const isStale =
            typeof nextRunAt === 'number' &&
            Number.isFinite(nextRunAt) &&
            nextRunAt > 0 &&
            now - nextRunAt > LOOP_STALE_GRACE_MS;
          if (isStale) {
            out.push({ path: join('.monomind', 'loops', f), description: 'abandoned loop state', size: st.size });
          }
        } else if (f.endsWith('.stop') && !jsonStems.has(f.replace(/\.stop$/, ''))) {
          out.push({ path: join('.monomind', 'loops', f), description: 'orphaned loop stopfile', size: st.size });
        }
      } catch { /* unparseable or unreadable — never delete what we cannot classify */ }
    }
  }
  return out;
}

/**
 * Report (dry run) or delete a batch of file/dir items, printing the same
 * `[would remove]` / `[removed]` / `[failed]` lines used across cleanup modes.
 * Shared by the scratch branch; the main artifact loop keeps its own copy
 * because of the `--keep-config` `.claude/settings.json` preservation special case.
 */
function removeOrReport(
  cwd: string,
  items: { path: string; description: string; size: number; type: 'dir' | 'file' }[],
  dryRun: boolean
): { removed: number; removedSize: number } {
  let removed = 0;
  let removedSize = 0;
  for (const item of items) {
    const sizeStr = formatSize(item.size);
    const typeLabel = item.type === 'dir' ? 'dir ' : 'file';
    if (dryRun) {
      output.writeln(output.warning(`  [would remove] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
    } else {
      try {
        rmSync(join(cwd, item.path), { recursive: item.type === 'dir', force: true });
        output.writeln(output.success(`  [removed] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
        removed++;
        removedSize += item.size;
      } catch (err) {
        output.writeln(output.error(`  [failed] ${typeLabel}  ${item.path}  - ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }
  return { removed, removedSize };
}

/**
 * Maximum directory recursion depth for size calculation.
 * Prevents stack overflow on deeply-nested or circular-symlink trees.
 */
const MAX_SIZE_DEPTH = 20;

/**
 * Calculate the total size of a path (file or directory) in bytes.
 *
 * Uses lstatSync (not statSync) so that symlinks are never followed:
 * a symlink counts only the size of the link itself, not its target.
 * This prevents a crafted symlink (e.g. .claude -> /) from causing
 * the cleanup command to recursively traverse the entire filesystem.
 */
function getSize(fullPath: string, depth = 0): number {
  if (depth > MAX_SIZE_DEPTH) return 0;
  try {
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      // Count only the symlink entry itself; never traverse the target.
      return stat.size;
    }
    if (stat.isFile()) {
      return stat.size;
    }
    if (stat.isDirectory()) {
      let total = 0;
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        // Skip symlinks at the entry level too — lstatSync below will still
        // catch them, but checking here avoids unnecessary path joins.
        if (!entry.isSymbolicLink()) {
          total += getSize(join(fullPath, entry.name), depth + 1);
        }
      }
      return total;
    }
  } catch {
    // Permission errors, broken symlinks, etc.
  }
  return 0;
}

/**
 * Format bytes into a human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Cleanup command definition
 */
export const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Remove project artifacts created by monomind/monomind',
  aliases: ['clean'],
  options: [
    {
      name: 'dry-run',
      short: 'n',
      description: 'Show what would be removed without deleting (default behavior)',
      type: 'boolean',
      default: true,
    },
    {
      name: 'force',
      short: 'f',
      description: 'Actually delete the artifacts',
      type: 'boolean',
      default: false,
    },
    {
      name: 'keep-config',
      short: 'k',
      description: 'Preserve monomind.config.json and .claude/settings.json',
      type: 'boolean',
      default: false,
    },
    {
      name: 'scratch',
      short: 's',
      description: 'Prune only stale mastermind scratch (.monomind/taskdev, abandoned .monomind/loops state)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'data',
      short: 'd',
      description: 'Prune orphaned per-project data in ~/.monomind/projects (gone projects, dead lancedb stores)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'aggressive',
      description: 'With --data: also prune dirs that cannot prove their origin (pre-2.3.1, no origin marker)',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'cleanup',
      description: 'Show what would be removed (dry run)',
    },
    {
      command: 'cleanup --force',
      description: 'Remove all monomind artifacts',
    },
    {
      command: 'cleanup --force --keep-config',
      description: 'Remove artifacts but keep configuration files',
    },
    {
      command: 'cleanup --scratch --force',
      description: 'Delete stale taskdev scratch and abandoned loop state',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force === true;
    const keepConfig = ctx.flags['keep-config'] === true;
    const cwd = ctx.cwd;

    const dryRun = !force;

    if (ctx.flags.data === true) {
      const { homedir } = await import('os');
      const baseDir = join(homedir(), '.monomind', 'projects');
      output.writeln();
      output.writeln(output.bold(dryRun ? 'Monomind Project-Data Cleanup (dry run)' : 'Monomind Project-Data Cleanup'));
      output.writeln();
      const orphans = findOrphanedProjectData(baseDir, Date.now(), ctx.flags.aggressive === true);
      if (orphans.length === 0) {
        output.writeln(output.info('No orphaned project data found.'));
        return { success: true, message: 'Nothing to clean' };
      }
      let removed = 0;
      for (const o of orphans) {
        output.writeln(`  ${dryRun ? 'would remove' : 'removing'}: ${o.path}  (${o.description})`);
        if (!dryRun) {
          try { rmSync(o.path, { recursive: true, force: true }); removed++; } catch { /* skip unremovable */ }
        }
      }
      output.writeln();
      if (dryRun) {
        output.writeln(output.dim(`  ${orphans.length} item(s). This was a dry run. Use --force to delete.`));
        return { success: true, message: `Dry run: ${orphans.length} orphaned item(s) found`, data: { found: orphans, dryRun } };
      }
      return { success: true, message: `Removed ${removed} orphaned item(s)`, data: { found: orphans, removedCount: removed, dryRun } };
    }

    if (ctx.flags.scratch === true) {
      const now = Date.now();
      output.writeln();
      output.writeln(output.bold(dryRun ? 'Monomind Scratch Cleanup (dry run)' : 'Monomind Scratch Cleanup'));
      output.writeln();
      const stale = findStaleScratch(cwd, now);
      if (stale.length === 0) {
        output.writeln(output.info('No stale scratch found.'));
        return { success: true, message: 'Nothing to clean' };
      }
      const { removed, removedSize } = removeOrReport(
        cwd,
        stale.map(item => ({ ...item, type: 'file' as const })),
        dryRun
      );
      output.writeln();
      if (dryRun) {
        output.writeln(output.dim(`  ${stale.length} stale file(s). This was a dry run. Use --force to delete.`));
        output.writeln();
        return { success: true, message: `Dry run: ${stale.length} stale scratch file(s) found`, data: { found: stale, dryRun } };
      }
      output.writeln(`  Removed ${removed} file(s) totaling ${formatSize(removedSize)}`);
      output.writeln();
      return { success: true, message: `Removed ${removed} stale scratch file(s)`, data: { found: stale, removedCount: removed, removedSize, dryRun } };
    }

    output.writeln();
    output.writeln(output.bold(dryRun
      ? 'Monomind Cleanup (dry run)'
      : 'Monomind Cleanup'));
    output.writeln();

    const found: { path: string; description: string; size: number; type: 'dir' | 'file'; skipped?: boolean }[] = [];
    let totalSize = 0;

    // Scan directories
    for (const artifact of ARTIFACT_DIRS) {
      const fullPath = join(cwd, artifact.path);
      if (existsSync(fullPath)) {
        const size = getSize(fullPath);
        found.push({ path: artifact.path, description: artifact.description, size, type: 'dir' });
        totalSize += size;
      }
    }

    // Scan files
    for (const artifact of ARTIFACT_FILES) {
      const fullPath = join(cwd, artifact.path);
      if (existsSync(fullPath)) {
        const size = getSize(fullPath);
        found.push({ path: artifact.path, description: artifact.description, size, type: 'file' });
        totalSize += size;
      }
    }

    if (found.length === 0) {
      output.writeln(output.info('No monomind artifacts found in the current directory.'));
      return { success: true, message: 'Nothing to clean' };
    }

    // Mark items that would be skipped due to --keep-config
    if (keepConfig) {
      for (const item of found) {
        if (KEEP_CONFIG_PATHS.includes(item.path)) {
          item.skipped = true;
        }
      }
    }

    // Display what was found
    output.writeln(output.bold('Artifacts found:'));
    output.writeln();

    let removedCount = 0;
    let removedSize = 0;
    let skippedCount = 0;

    for (const item of found) {
      const sizeStr = formatSize(item.size);
      const typeLabel = item.type === 'dir' ? 'dir ' : 'file';

      if (item.skipped) {
        output.writeln(output.dim(`  [skip] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
        skippedCount++;
        continue;
      }

      if (dryRun) {
        output.writeln(output.warning(`  [would remove] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
      } else {
        // Actually delete
        try {
          const fullPath = join(cwd, item.path);
          // Special-case: `.claude/` is scanned and removed as a single unit,
          // but KEEP_CONFIG_PATHS promises `.claude/settings.json` survives
          // --keep-config. Back the file up, wipe the directory, then
          // restore just that one file — the rest of `.claude/` is still
          // removed as normal.
          const settingsPath = join(cwd, '.claude', 'settings.json');
          const isClaudeDirWithPreservedSettings =
            item.type === 'dir' && item.path === '.claude' && keepConfig && existsSync(settingsPath);

          if (isClaudeDirWithPreservedSettings) {
            const settingsBackup = readFileSync(settingsPath);
            rmSync(fullPath, { recursive: true, force: true });
            mkdirSync(dirname(settingsPath), { recursive: true });
            writeFileSync(settingsPath, settingsBackup);
            output.writeln(output.success(`  [removed] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
            output.writeln(output.dim(`  [kept]    file  .claude/settings.json - preserved (--keep-config)`));
          } else if (item.type === 'dir') {
            rmSync(fullPath, { recursive: true, force: true });
            output.writeln(output.success(`  [removed] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
          } else {
            rmSync(fullPath, { force: true });
            output.writeln(output.success(`  [removed] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
          }
          removedCount++;
          removedSize += item.size;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          output.writeln(output.error(`  [failed] ${typeLabel}  ${item.path}  - ${msg}`));
        }
      }
    }

    // Summary
    output.writeln();
    output.writeln(output.bold('Summary:'));

    if (dryRun) {
      const actionable = found.filter(f => !f.skipped);
      output.writeln(`  Found ${actionable.length} artifact(s) totaling ${formatSize(totalSize)}`);
      if (skippedCount > 0) {
        output.writeln(`  ${skippedCount} item(s) would be preserved (--keep-config)`);
      }
      output.writeln();
      output.writeln(output.dim('  This was a dry run. Use --force to actually remove artifacts.'));
    } else {
      output.writeln(`  Removed ${removedCount} artifact(s) totaling ${formatSize(removedSize)}`);
      if (skippedCount > 0) {
        output.writeln(`  Preserved ${skippedCount} item(s) (--keep-config)`);
      }
    }

    output.writeln();

    return {
      success: true,
      message: dryRun
        ? `Dry run: ${found.length} artifact(s) found`
        : `Removed ${removedCount} artifact(s)`,
      data: { found, removedCount, removedSize, dryRun },
    };
  },
};

export default cleanupCommand;
