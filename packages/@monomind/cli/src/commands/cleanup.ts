/**
 * CLI Cleanup Command
 * Removes project artifacts created by monomind/monomind
 *
 * github.com/monoes/monomind
 */

// Static imports: this package is ESM ("type": "module"), so a bare require()
// here throws "require is not defined" in the built output even though it
// typechecks and passes tests. Guarded by no-cjs-require-in-esm.test.ts.
import { execSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import {
  applyCleanupEntry,
  buildCleanupPlan,
  type CleanupPlanEntry,
  isMonomindSourceRepo,
} from './cleanup-plan.js';

/** Scratch pruning (--scratch): taskdev handoff files and loop state. */
// monolean: manual flag only — upgrade path: invoke from the `cache` background worker so crashed-run scratch is pruned without anyone remembering the flag
const SCRATCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // taskdev scratch older than this is stale
const LOOP_STALE_GRACE_MS = 24 * 60 * 60 * 1000; // a live loop reschedules every <=1h; overdue by a day = abandoned

/** A single stale-scratch candidate returned by {@link findStaleScratch}. */
interface StaleScratchItem {
  path: string;
  description: string;
  size: number;
}

/** Orphaned per-project data (--data): ~/.monomind/projects/<slug> dirs whose
 * source project is gone, plus dead lancedb/ dirs left by the pre-2.3.1 engine. */
const UNKNOWN_DIR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Where removable volumes appear; a missing path under one may just be unplugged. */
const MEDIA_ROOTS = ['/Volumes', '/media', '/mnt', '/run/media'];

function isMountPoint(dir: string): boolean {
  const parent = dirname(dir);
  if (parent === dir) return true; // filesystem root
  try {
    return statSync(dir).dev !== statSync(parent).dev;
  } catch {
    return true; // cannot tell — stay cautious
  }
}

/**
 * True when a recorded project path is gone because it was deleted, not
 * because the volume holding it is unmounted. Walks up to the nearest existing
 * ancestor: when that is the path's own parent (the old rule), a well-known
 * local root (home, /tmp, /var/tmp, the OS temp dir) or an ordinary directory,
 * the path was deleted — this covers a whole deleted test root (#347). When it
 * is a mount point (`/`, a network share's mount) or a removable-media
 * directory, the missing piece may be a volume that is not attached right now.
 */
function isProvablyDeleted(p: string): boolean {
  const target = resolve(p);
  if (existsSync(target)) return false;
  const parent = dirname(target);
  let nearest = parent;
  while (!existsSync(nearest) && dirname(nearest) !== nearest) nearest = dirname(nearest);
  if (nearest === parent) return true;
  const localRoots = new Set<string>();
  for (const r of [homedir(), '/tmp', '/var/tmp', tmpdir()]) {
    localRoots.add(resolve(r));
    try {
      localRoots.add(realpathSync(r));
    } catch {
      /* missing root — nothing to add */
    }
  }
  if (localRoots.has(nearest)) return true;
  if (MEDIA_ROOTS.includes(nearest) || MEDIA_ROOTS.includes(dirname(nearest))) return false;
  return !isMountPoint(nearest);
}

/**
 * Entries of the project registry (~/.monomind-projects.json, written by
 * `init` for `init upgrade --all`) whose project was deleted, by the same rule
 * as project-data dirs. Exported for tests; unreadable registry → none.
 */
export function findStaleRegistryEntries(registryPath: string): string[] {
  try {
    const reg = JSON.parse(readFileSync(registryPath, 'utf-8')) as { projects?: unknown };
    if (!Array.isArray(reg.projects)) return [];
    return reg.projects.filter(
      (p): p is string => typeof p === 'string' && p.length > 0 && isProvablyDeleted(p),
    );
  } catch {
    return [];
  }
}

/** Rewrite the registry without `stale`, re-read first so a concurrent `init` registration survives. */
function pruneRegistryEntries(registryPath: string, stale: string[]): number {
  const reg = JSON.parse(readFileSync(registryPath, 'utf-8')) as { projects: unknown[] };
  const drop = new Set(stale);
  const kept = reg.projects.filter((p) => !(typeof p === 'string' && drop.has(p)));
  const removed = reg.projects.length - kept.length;
  if (removed > 0) {
    reg.projects = kept;
    writeFileSync(registryPath, JSON.stringify(reg, null, 2), 'utf-8');
  }
  return removed;
}

/**
 * Find prunable entries under the per-project data base (default
 * ~/.monomind/projects). Exported for tests — `baseDir`/`now` injectable.
 *
 * Classification per dir:
 * - `origin.json` present and its recorded path still exists → keep the dir,
 *   but flag a leftover `lancedb/` subdir (dead since the SQLite engine swap).
 * - `origin.json` present, recorded path provably deleted (not merely on an
 *   unmounted volume, see {@link isProvablyDeleted}) → orphaned → prune.
 * - no `origin.json` (pre-2.3.1 dirs can't prove their origin) → prune only
 *   when untouched for {@link UNKNOWN_DIR_MAX_AGE_MS} — or immediately with
 *   `--aggressive`, which treats unprovable dirs as junk (safe: every live
 *   project rewrites origin.json on its next memory access).
 */
export function findOrphanedProjectData(
  baseDir: string,
  now: number,
  aggressive: boolean,
): StaleScratchItem[] {
  const out: StaleScratchItem[] = [];
  if (!existsSync(baseDir)) return out;
  for (const name of readdirSync(baseDir)) {
    if (name.startsWith('.')) continue;
    const dir = join(baseDir, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    // Staleness must consider the files writes actually touch: appends to
    // lancedb/memory.db and origin.json refreshes do NOT bump the slug dir's
    // own mtime, so an actively-used project would otherwise look 30d stale.
    const mtimeOf = (p: string): number => {
      try {
        return lstatSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    const mtime = Math.max(
      mtimeOf(dir),
      mtimeOf(join(dir, 'origin.json')),
      mtimeOf(join(dir, 'lancedb', 'memory.db')),
      mtimeOf(join(dir, 'memory.db')),
    );
    const originFile = join(dir, 'origin.json');
    let originPath: string | null = null;
    let hasOrigin = false;
    try {
      originPath = String(JSON.parse(readFileSync(originFile, 'utf-8')).path ?? '');
      hasOrigin = originPath.length > 0;
    } catch {
      /* no/corrupt marker */
    }
    if (hasOrigin && originPath && existsSync(originPath)) {
      // NOTE: the directory is *named* lancedb for historical reasons, but the
      // current SQLite engine keeps its LIVE memory.db inside it. Only genuine
      // LanceDB leftovers (*.lance datasets, no memory.db) are dead weight.
      const lance = join(dir, 'lancedb');
      if (existsSync(lance) && !existsSync(join(lance, 'memory.db'))) {
        let hasLanceData = false;
        try {
          hasLanceData = readdirSync(lance).some((f) => f.endsWith('.lance') || f === '__manifest');
        } catch {
          /* unreadable — leave it */
        }
        if (hasLanceData)
          out.push({
            path: lance,
            description: `dead lancedb store (project: ${originPath})`,
            size: 0,
          });
      }
      continue;
    }
    if (hasOrigin && originPath) {
      // An unmounted volume / disconnected network share makes the whole
      // subtree vanish temporarily, and that must never count as "project
      // deleted" — see isProvablyDeleted.
      if (isProvablyDeleted(originPath)) {
        out.push({
          path: dir,
          description: `orphaned project data (origin gone: ${originPath})`,
          size: 0,
        });
      }
    } else if (aggressive || now - mtime > UNKNOWN_DIR_MAX_AGE_MS) {
      out.push({
        path: dir,
        description: aggressive
          ? 'unverifiable project data (no origin marker)'
          : 'unverifiable project data (untouched >30d)',
        size: 0,
      });
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
          out.push({
            path: join('.monomind', 'taskdev', f),
            description: 'stale taskdev scratch',
            size: st.size,
          });
        }
      } catch {
        /* raced away or unreadable — leave it */
      }
    }
  }
  const loopsDir = join(cwd, '.monomind', 'loops');
  if (existsSync(loopsDir)) {
    const entries = readdirSync(loopsDir);
    const jsonStems = new Set(
      entries.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')),
    );
    for (const f of entries) {
      try {
        const st = lstatSync(join(loopsDir, f));
        if (!st.isFile()) continue;
        if (f.endsWith('.json')) {
          const parsed = JSON.parse(readFileSync(join(loopsDir, f), 'utf8')) as {
            nextRunAt?: unknown;
            status?: unknown;
          };
          const { nextRunAt } = parsed;
          const isStale =
            typeof nextRunAt === 'number' &&
            Number.isFinite(nextRunAt) &&
            nextRunAt > 0 &&
            now - nextRunAt > LOOP_STALE_GRACE_MS;
          if (isStale) {
            out.push({
              path: join('.monomind', 'loops', f),
              description: 'abandoned loop state',
              size: st.size,
            });
          }
        } else if (f.endsWith('.stop') && !jsonStems.has(f.replace(/\.stop$/, ''))) {
          out.push({
            path: join('.monomind', 'loops', f),
            description: 'orphaned loop stopfile',
            size: st.size,
          });
        }
      } catch {
        /* unparseable or unreadable — never delete what we cannot classify */
      }
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
  dryRun: boolean,
): { removed: number; removedSize: number } {
  let removed = 0;
  let removedSize = 0;
  for (const item of items) {
    const sizeStr = formatSize(item.size);
    const typeLabel = item.type === 'dir' ? 'dir ' : 'file';
    if (dryRun) {
      output.writeln(
        output.warning(
          `  [would remove] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`,
        ),
      );
    } else {
      try {
        rmSync(join(cwd, item.path), { recursive: item.type === 'dir', force: true });
        output.writeln(
          output.success(
            `  [removed] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`,
          ),
        );
        removed++;
        removedSize += item.size;
      } catch (err) {
        output.writeln(
          output.error(
            `  [failed] ${typeLabel}  ${item.path}  - ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }
  return { removed, removedSize };
}

/**
 * Format bytes into a human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
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
      description:
        'Apply the preview: delete only provably monomind-owned, untracked paths (never git-tracked files or user data)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'keep-config',
      short: 'k',
      description: 'Preserve monomind.config.json (.claude/settings.json is always kept)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'purge-data',
      description:
        'With --force: also delete user data (memory stores, .monomind/org-memory, knowledge index, monograph and other *.db, org configs)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'scratch',
      short: 's',
      description:
        'Prune only stale mastermind scratch (.monomind/taskdev, abandoned .monomind/loops state)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'data',
      short: 'd',
      description:
        'Prune orphaned per-project data in ~/.monomind/projects (gone projects, dead lancedb stores) and gone projects in ~/.monomind-projects.json',
      type: 'boolean',
      default: false,
    },
    {
      name: 'aggressive',
      description:
        'With --data: also prune dirs that cannot prove their origin (pre-2.3.1, no origin marker)',
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
      description: 'Remove monomind-owned artifacts; keep tracked files and user data',
    },
    {
      command: 'cleanup --force --purge-data',
      description: 'Also delete memory stores, org memory, knowledge index and databases',
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
    const purgeData = ctx.flags['purge-data'] === true;
    const cwd = ctx.cwd;

    const dryRun = !force;

    if (ctx.flags.data === true) {
      const { homedir } = await import('node:os');
      const baseDir = join(homedir(), '.monomind', 'projects');
      output.writeln();
      output.writeln(
        output.bold(
          dryRun ? 'Monomind Project-Data Cleanup (dry run)' : 'Monomind Project-Data Cleanup',
        ),
      );
      output.writeln();
      const orphans = findOrphanedProjectData(baseDir, Date.now(), ctx.flags.aggressive === true);
      const registryPath = join(homedir(), '.monomind-projects.json');
      const staleRegistryEntries = findStaleRegistryEntries(registryPath);
      if (orphans.length === 0 && staleRegistryEntries.length === 0) {
        output.writeln(output.info('No orphaned project data found.'));
        return { success: true, message: 'Nothing to clean' };
      }
      let removed = 0;
      for (const o of orphans) {
        output.writeln(`  ${dryRun ? 'would remove' : 'removing'}: ${o.path}  (${o.description})`);
        if (!dryRun) {
          try {
            rmSync(o.path, { recursive: true, force: true });
            removed++;
          } catch {
            /* skip unremovable */
          }
        }
      }
      for (const p of staleRegistryEntries) {
        output.writeln(
          `  ${dryRun ? 'would unregister' : 'unregistering'}: ${p}  (project gone, in ${registryPath})`,
        );
      }
      let registryRemoved = 0;
      if (!dryRun && staleRegistryEntries.length > 0) {
        try {
          registryRemoved = pruneRegistryEntries(registryPath, staleRegistryEntries);
        } catch {
          /* registry unreadable/unwritable — leave it */
        }
      }
      const total = orphans.length + staleRegistryEntries.length;
      output.writeln();
      if (dryRun) {
        output.writeln(
          output.dim(`  ${total} item(s). This was a dry run. Use --force to delete.`),
        );
        return {
          success: true,
          message: `Dry run: ${total} orphaned item(s) found`,
          data: { found: orphans, staleRegistryEntries, dryRun },
        };
      }
      return {
        success: true,
        message: `Removed ${removed + registryRemoved} orphaned item(s)`,
        data: {
          found: orphans,
          removedCount: removed,
          staleRegistryEntries,
          registryRemovedCount: registryRemoved,
          dryRun,
        },
      };
    }

    if (ctx.flags.scratch === true) {
      const now = Date.now();
      output.writeln();
      output.writeln(
        output.bold(dryRun ? 'Monomind Scratch Cleanup (dry run)' : 'Monomind Scratch Cleanup'),
      );
      output.writeln();
      const stale = findStaleScratch(cwd, now);
      if (stale.length === 0) {
        output.writeln(output.info('No stale scratch found.'));
        return { success: true, message: 'Nothing to clean' };
      }
      const { removed, removedSize } = removeOrReport(
        cwd,
        stale.map((item) => ({ ...item, type: 'file' as const })),
        dryRun,
      );
      output.writeln();
      if (dryRun) {
        output.writeln(
          output.dim(`  ${stale.length} stale file(s). This was a dry run. Use --force to delete.`),
        );
        output.writeln();
        return {
          success: true,
          message: `Dry run: ${stale.length} stale scratch file(s) found`,
          data: { found: stale, dryRun },
        };
      }
      output.writeln(`  Removed ${removed} file(s) totaling ${formatSize(removedSize)}`);
      output.writeln();
      return {
        success: true,
        message: `Removed ${removed} stale scratch file(s)`,
        data: { found: stale, removedCount: removed, removedSize, dryRun },
      };
    }

    // Refuse to --force inside monomind's own source checkout: its tracked
    // AGENTS.md/.agents/.gemini are the product's sources and its untracked
    // .monomind/ holds the developer's live memory (incident 2026-09-22).
    if (force && isMonomindSourceRepo(cwd)) {
      output.writeln(
        output.error(
          'Refusing to run cleanup --force in the monomind source repository itself. ' +
            'Run it in a project that monomind was initialised into.',
        ),
      );
      return { success: false, exitCode: 1, message: 'refused: monomind source repository' };
    }

    // One plan drives both the preview and --force, so the preview is exactly
    // what --force deletes. Built before any process is stopped below.
    const planned = buildCleanupPlan(cwd, {
      keepConfig,
      purgeData,
      memoryPath: process.env.MONOMIND_MEMORY_PATH,
    });
    if (!planned.ok) {
      output.writeln(output.error(`  ${planned.error}`));
      return { success: false, exitCode: 1, message: planned.error };
    }
    const plan = planned.entries;

    // Kill background processes before removing their state files
    if (force) {
      // Guard against a stale PID file outliving its process and the OS
      // recycling that PID for an unrelated process — verify the live
      // process actually looks like ours before signaling it.
      const looksLikeOurProcess = (pid: number): boolean => {
        try {
          const cmd = execSync(`ps -p ${pid} -o command=`, {
            timeout: 2000,
            encoding: 'utf-8',
          }).trim();
          // Covers direct `node ...` spawns as well as the npx fallback in
          // control-start.cjs's findCliPath(), which shows up in `ps` as
          // "npm exec ..." / "npx ..." with no literal "node".
          const looksLikeNode =
            cmd.includes('node') || cmd.includes('npx') || cmd.includes('npm exec');
          return looksLikeNode && (cmd.includes('monomind') || cmd.includes(cwd));
        } catch {
          return false;
        }
      };
      const controlPath = join(cwd, '.monomind', 'control.json');
      try {
        if (existsSync(controlPath) && statSync(controlPath).size <= 4096) {
          const status = JSON.parse(readFileSync(controlPath, 'utf-8'));
          if (
            status?.pid &&
            Number.isInteger(status.pid) &&
            status.pid > 0 &&
            looksLikeOurProcess(status.pid)
          ) {
            process.kill(status.pid, 'SIGTERM');
            output.writeln(output.info(`  Stopped dashboard server (pid ${status.pid})`));
          }
          try {
            unlinkSync(controlPath);
          } catch {}
        }
      } catch {
        /* already gone */
      }
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const pp = join(cwd, '.monomind', pidName);
          if (!existsSync(pp) || statSync(pp).size > 32) continue;
          const pid = parseInt(readFileSync(pp, 'utf-8').trim(), 10);
          if (Number.isInteger(pid) && pid > 0 && looksLikeOurProcess(pid)) {
            process.kill(pid, 'SIGTERM');
            output.writeln(output.info(`  Stopped monograph watcher (pid ${pid})`));
          }
          try {
            unlinkSync(pp);
          } catch {}
        } catch {
          /* already gone */
        }
      }
      // Kill stale MCP server processes
      const mcpPidPaths = [
        join(homedir(), '.monomind', 'mcp.pid'),
        join(cwd, '.monomind', 'mcp-server.pid'),
      ];
      for (const pp of mcpPidPaths) {
        try {
          if (!existsSync(pp) || statSync(pp).size > 32) continue;
          const pid = parseInt(readFileSync(pp, 'utf-8').trim(), 10);
          if (Number.isInteger(pid) && pid > 0 && looksLikeOurProcess(pid)) {
            process.kill(pid, 'SIGTERM');
            output.writeln(output.info(`  Stopped MCP server (pid ${pid})`));
          }
          try {
            unlinkSync(pp);
          } catch {}
        } catch {
          /* already gone */
        }
      }
      // Reap orphaned claude-agent-sdk processes from crashed orgs
      try {
        const { reapOrphanedSdkProcesses } = await import('../utils/resource-governor.js');
        const reaped = reapOrphanedSdkProcesses(new Set());
        if (reaped > 0)
          output.writeln(output.info(`  Reaped ${reaped} orphaned SDK agent process(es)`));
      } catch {
        /* resource-governor not available */
      }
    }

    output.writeln();
    output.writeln(output.bold(dryRun ? 'Monomind Cleanup (dry run)' : 'Monomind Cleanup'));
    output.writeln();

    if (plan.length === 0) {
      output.writeln(output.info('No monomind artifacts found in the current directory.'));
      return { success: true, message: 'Nothing to clean', data: { plan, dryRun } };
    }

    let removedCount = 0;
    let removedSize = 0;
    let failed = 0;
    for (const e of plan.filter((x) => x.action !== 'skip')) {
      const typeLabel = e.kind === 'dir' ? 'dir ' : 'file';
      const verb = e.action === 'remove' ? 'remove' : 'edit';
      const line = `${typeLabel}  ${e.path}  (${formatSize(e.size)}) - ${e.reason}`;
      if (dryRun) {
        output.writeln(output.warning(`  [would ${verb}] ${line}`));
        continue;
      }
      try {
        applyCleanupEntry(cwd, e);
        output.writeln(output.success(`  [${verb === 'remove' ? 'removed' : 'edited'}] ${line}`));
        removedCount++;
        if (e.action === 'remove') removedSize += e.size;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        output.writeln(output.error(`  [failed] ${typeLabel}  ${e.path}  - ${msg}`));
      }
    }
    printKept(
      plan.filter((x) => x.action === 'skip'),
      ctx.flags.verbose === true,
    );

    output.writeln();
    output.writeln(output.bold('Summary:'));
    const acting = plan.filter((x) => x.action !== 'skip');
    const kept = plan.length - acting.length;
    if (dryRun) {
      output.writeln(`  Would remove or edit ${acting.length} item(s); keep ${kept}`);
      output.writeln();
      output.writeln(
        output.dim('  This was a dry run. Use --force to apply exactly the lines above.'),
      );
      if (plan.some((x) => x.data && x.action === 'skip' && x.reason.includes('--purge-data'))) {
        output.writeln(output.dim('  User data is kept; add --purge-data to remove it as well.'));
      }
    } else {
      output.writeln(
        `  Removed or edited ${removedCount} item(s) totaling ${formatSize(removedSize)}; kept ${kept}`,
      );
    }
    output.writeln();

    return {
      success: failed === 0,
      message: dryRun
        ? `Dry run: ${acting.length} item(s) would be removed or edited`
        : `Removed or edited ${removedCount} item(s)`,
      data: { plan, removedCount, removedSize, dryRun },
    };
  },
};

/** Kept paths: data is always listed in full; other reasons are summarized unless --verbose. */
function printKept(kept: CleanupPlanEntry[], verbose: boolean): void {
  if (kept.length === 0) return;
  output.writeln();
  output.writeln(output.bold('Kept (not provably monomind-owned, tracked, or user data):'));
  const byReason = new Map<string, CleanupPlanEntry[]>();
  for (const e of kept) byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e]);
  for (const [reason, items] of byReason) {
    const limit = verbose || items.some((i) => i.data) ? items.length : 5;
    for (const i of items.slice(0, limit)) {
      output.writeln(
        output.dim(`  [keep] ${i.kind === 'dir' ? 'dir ' : 'file'}  ${i.path} - ${reason}`),
      );
    }
    if (items.length > limit) {
      output.writeln(
        output.dim(
          `  [keep] ... and ${items.length - limit} more - ${reason} (--verbose lists all)`,
        ),
      );
    }
  }
}

export default cleanupCommand;
