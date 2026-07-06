import { resolve, join } from 'path';
import { execSync } from 'child_process';
import Graph from 'graphology';
import { openDb, closeDb } from '../storage/db.js';
import { PipelineRunner } from './runner.js';
import { scanPhase } from './phases/scan.js';
import { structurePhase } from './phases/structure.js';
import { parsePhase } from './phases/parse.js';
import { markdownPhase } from './phases/markdown.js';
import { routesPhase } from './phases/routes.js';
import { toolsPhase } from './phases/tools.js';
import { ormPhase } from './phases/orm.js';
import { crossFilePhase } from './phases/cross-file.js';
import { scopeResolutionPhase } from './phases/scope-resolution.js';
import { mroPhase } from './phases/mro.js';
import { communitiesPhase } from './phases/communities.js';
import { processesPhase } from './phases/processes.js';
import { godNodesPhase } from './phases/god-nodes.js';
import { surprisesPhase } from './phases/surprises.js';
import { suggestPhase } from './phases/suggest.js';
import { variablesPhase } from './phases/variables-phase.js';
import { wildcardSynthesisPhase } from './phases/wildcard-phase.js';
import { frameworkDetectPhase } from './phases/framework-detect.js';
import { importResolverPhase } from './phases/import-resolver.js';
import type { PipelineOptions, PipelineContext } from './types.js';
import { DEFAULT_OPTIONS } from './types.js';
import type { PipelineProgress, SuggestedQuestion } from '../types.js';
import { generateGraphReport } from '../reporting/graph-report.js';

function getCurrentCommitHash(repoPath: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export interface BuildOptions extends Partial<PipelineOptions> {
  onProgress?: (p: PipelineProgress) => void;
  force?: boolean;
  /** When true, skip the full rebuild if the index is already fresh (matches HEAD). Default false. */
  incremental?: boolean;
}

// Cross-process build mutex. Callers arrive from several independent entry points
// (session-start hook, MCP staleness auto-build, CLI, watcher), each with its own
// ad-hoc lock file that the others don't know about — concurrent builds then fail
// with "database is locked". Serialize here, the one place all builders pass through.
async function acquireBuildLock(dbPath: string): Promise<(() => void) | null> {
  const { writeFileSync, readFileSync, statSync, unlinkSync, mkdirSync } = await import('fs');
  const { dirname } = await import('path');
  const lockPath = dbPath + '.build-lock';
  mkdirSync(dirname(lockPath), { recursive: true });
  const tryAcquire = (): boolean => {
    try { writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); return true; }
    catch { return false; }
  };
  if (!tryAcquire()) {
    // Reclaim if the holder is dead or the lock is older than 30 minutes
    let stale = false;
    try {
      const pid = parseInt(readFileSync(lockPath, 'utf8'), 10);
      try { process.kill(pid, 0); } catch { stale = true; }
      if (!stale && Date.now() - statSync(lockPath).mtimeMs > 30 * 60 * 1000) stale = true;
    } catch { stale = true; }
    if (!stale) return null;
    try { unlinkSync(lockPath); } catch { /* raced with another reclaimer */ }
    if (!tryAcquire()) return null;
  }
  return () => { try { unlinkSync(lockPath); } catch { /* already gone */ } };
}

export async function buildAsync(repoPath: string, options: BuildOptions = {}): Promise<void> {
  const dbPath = resolve(join(repoPath, '.monomind', 'monograph.db'));
  const fullOptions: PipelineOptions = { ...DEFAULT_OPTIONS, ...options };

  const releaseLock = await acquireBuildLock(dbPath);
  if (!releaseLock) {
    options.onProgress?.({ phase: 'skip', message: 'Another build is in progress — skipping' });
    return;
  }
  try {
    await buildAsyncLocked(repoPath, dbPath, fullOptions, options);
  } finally {
    releaseLock();
  }
}

async function buildAsyncLocked(
  repoPath: string,
  dbPath: string,
  fullOptions: PipelineOptions,
  options: BuildOptions,
): Promise<void> {

  // Incremental guard: if the caller requested skip-when-fresh and force is
  // not set, check staleness before opening the DB for a full write cycle.
  if (options.incremental && !options.force) {
    const { existsSync: _existsSync } = await import('fs');
    if (_existsSync(dbPath)) {
      const { checkStaleness } = await import('../staleness/git-staleness.js');
      const tmpDb = openDb(dbPath);
      try {
        const report = checkStaleness(tmpDb, resolve(repoPath));
        if (!report.isStale && report.currentCommit !== null) {
          options.onProgress?.({ phase: 'skip', message: 'Index is fresh — skipping rebuild' });
          return; // Already up-to-date
        }
      } finally {
        closeDb(tmpDb);
      }
    }
  }

  const db = openDb(dbPath);

  try {
    const graph = new Graph({ multi: true, type: 'directed' });
    const ctx: PipelineContext = {
      repoPath: resolve(repoPath),
      db, graph,
      onProgress: options.onProgress ?? (() => {}),
      options: fullOptions,
    };

    const runner = new PipelineRunner([
      scanPhase, frameworkDetectPhase, structurePhase, parsePhase, variablesPhase,
      markdownPhase, routesPhase, toolsPhase, ormPhase,
      crossFilePhase, wildcardSynthesisPhase, importResolverPhase, scopeResolutionPhase,
      mroPhase, communitiesPhase, processesPhase, godNodesPhase, surprisesPhase, suggestPhase,
    ]);

    const outputs = await runner.run(ctx);

    // Skip post-pipeline work when all files were cached (nothing changed)
    if (!ctx.allFilesCached) {
      // Sweep orphaned rows for files that were renamed/deleted since the last build.
      const scanOut = outputs.get('scan') as { filePaths: string[] } | undefined;
      if (scanOut) {
        const liveFiles = new Set(scanOut.filePaths.map((f) => resolve(f)));
        const staleFiles = (
          db.prepare('SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL').all() as { file_path: string }[]
        )
          .map((r) => r.file_path)
          .filter((f) => !liveFiles.has(resolve(ctx.repoPath, f)));
        if (staleFiles.length > 0) {
          const deleteStale = db.transaction((files: string[]) => {
            const deleteEdges = db.prepare(`
              DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE file_path = ?)
                 OR target_id IN (SELECT id FROM nodes WHERE file_path = ?)
            `);
            const deleteNodesStmt = db.prepare('DELETE FROM nodes WHERE file_path = ?');
            for (const f of files) {
              deleteEdges.run(f, f);
              deleteNodesStmt.run(f);
            }
          });
          deleteStale(staleFiles);
        }
      }

      const suggestOut = outputs.get('suggest') as { questions: SuggestedQuestion[] } | undefined;
      const questions = suggestOut?.questions ?? [];
      await generateGraphReport(resolve(repoPath), undefined, dbPath, questions);
    }

    const hash = getCurrentCommitHash(resolve(repoPath));
    if (hash) {
      db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(hash);
    }
  } finally {
    closeDb(db);
  }
}
