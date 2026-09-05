import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import Graph from 'graphology';
import { analyzeChurn } from '../analysis/churn.js';
import { ExtractionCache } from '../cache/extraction-cache.js';
import { generateGraphReport } from '../reporting/graph-report.js';
import { closeDb, openDb } from '../storage/db.js';
import type { PipelineProgress, SuggestedQuestion } from '../types.js';
import { isWithinScope, readIndexScope, scopeForOptions, writeIndexScope } from './index-scope.js';
import { bridgeResolverPhase } from './phases/bridge-resolver.js';
import { communitiesPhase } from './phases/communities.js';
import { crossFilePhase } from './phases/cross-file.js';
import { frameworkDetectPhase } from './phases/framework-detect.js';
import { godNodesPhase } from './phases/god-nodes.js';
import { importResolverPhase } from './phases/import-resolver.js';
import { markdownPhase } from './phases/markdown.js';
import { mroPhase } from './phases/mro.js';
import { ormPhase } from './phases/orm.js';
import { parsePhase } from './phases/parse.js';
import { processesPhase } from './phases/processes.js';
import { routesPhase } from './phases/routes.js';
import { scanPhase } from './phases/scan.js';
import { clearWorkspacePackageMapCache, scopeResolutionPhase } from './phases/scope-resolution.js';
import { structurePhase } from './phases/structure.js';
import { suggestPhase } from './phases/suggest.js';
import { surprisesPhase } from './phases/surprises.js';
import { toolsPhase } from './phases/tools.js';
import { variablesPhase } from './phases/variables-phase.js';
import { wildcardSynthesisPhase } from './phases/wildcard-phase.js';
import { PipelineRunner } from './runner.js';
import type { PipelineContext, PipelineOptions } from './types.js';
import { DEFAULT_OPTIONS } from './types.js';

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
  const { writeFileSync, readFileSync, statSync, unlinkSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const lockPath = `${dbPath}.build-lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  const tryAcquire = (): boolean => {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  };
  if (!tryAcquire()) {
    // Reclaim if the holder is dead or the lock is older than 30 minutes
    let stale = false;
    try {
      const pid = parseInt(readFileSync(lockPath, 'utf8'), 10);
      try {
        process.kill(pid, 0);
      } catch {
        stale = true;
      }
      if (!stale && Date.now() - statSync(lockPath).mtimeMs > 30 * 60 * 1000) stale = true;
    } catch {
      stale = true;
    }
    if (!stale) return null;
    try {
      unlinkSync(lockPath);
    } catch {
      /* raced with another reclaimer */
    }
    if (!tryAcquire()) return null;
  }
  return () => {
    try {
      unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
}

export async function buildAsync(repoPath: string, options: BuildOptions = {}): Promise<void> {
  const dbPath = resolve(join(repoPath, '.monomind', 'monograph.db'));
  const fullOptions: PipelineOptions = { ...DEFAULT_OPTIONS, ...options };
  clearWorkspacePackageMapCache(repoPath);

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
    const { existsSync: _existsSync } = await import('node:fs');
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

  // Parse-cache eviction — runs once at the start of a full (non-incremental)
  // build. The cache only ever grows via writes (parse.ts's ExtractionCache);
  // nothing else prunes entries for files that were deleted/renamed or
  // haven't been touched in a long time, so it accumulates forever otherwise.
  if (!options.incremental) {
    try {
      const parseCache = new ExtractionCache(resolve(join(repoPath, '.monomind', 'parse-cache')));
      const removed = parseCache.prune();
      if (removed > 0) {
        options.onProgress?.({
          phase: 'prune',
          message: `Parse cache: pruned ${removed} stale entries`,
        });
      }
    } catch {
      /* non-fatal — cache pruning must never block a build */
    }
  }

  const db = openDb(dbPath);

  // Source-scope continuity (issue: a code-only auto-refresh wiped every
  // previously-indexed Document node). A caller that doesn't state a scope
  // inherits whatever the index was last built with, so a refresh can never
  // silently narrow coverage; an explicit `codeOnly` from the caller still wins.
  const storedScope = readIndexScope(db);
  if (options.codeOnly === undefined && storedScope !== null) {
    fullOptions.codeOnly = storedScope === 'code';
  }
  const activeScope = scopeForOptions(fullOptions.codeOnly);
  options.onProgress?.({ phase: 'scope', message: `Index scope: ${activeScope}` });

  // The whole build is one SQL transaction: a phase throwing (e.g. issue
  // #40's FK violation) used to leave whatever earlier phases had already
  // autocommitted sitting in the DB, silently corrupting the index into a
  // stale partial state that a later build wouldn't repair (cache hits skip
  // re-scanning the files that would restore the missing rows). BEGIN/COMMIT/
  // ROLLBACK are issued directly via db.exec() rather than better-sqlite3's
  // `.transaction()` helper, which requires a synchronous callback — the
  // phases below are async. This is still safe: every phase writes through
  // this same single connection, so SQLite serializes them regardless of how
  // the JS event loop interleaves the awaits between phases.
  db.exec('BEGIN');
  try {
    const graph = new Graph({ multi: true, type: 'directed' });
    const ctx: PipelineContext = {
      repoPath: resolve(repoPath),
      db,
      graph,
      onProgress: options.onProgress ?? (() => {}),
      options: fullOptions,
    };

    const runner = new PipelineRunner([
      scanPhase,
      frameworkDetectPhase,
      structurePhase,
      parsePhase,
      variablesPhase,
      markdownPhase,
      routesPhase,
      toolsPhase,
      ormPhase,
      crossFilePhase,
      wildcardSynthesisPhase,
      importResolverPhase,
      scopeResolutionPhase,
      bridgeResolverPhase,
      mroPhase,
      communitiesPhase,
      processesPhase,
      godNodesPhase,
      surprisesPhase,
      suggestPhase,
    ]);

    const outputs = await runner.run(ctx);

    // MONO-2: surface parse-time errors (malformed files, failed grammar loads,
    // unreadable sources) to the user. parsePhase already collects these into
    // its output's `parseErrors` array, but without this wiring the warnings
    // stay invisible — the build silently produces a partial graph.
    const parseOut = outputs.get('parse') as { parseErrors?: string[] } | undefined;
    const parseErrors = parseOut?.parseErrors ?? [];
    if (parseErrors.length > 0) {
      const summary = `${parseErrors.length} parse warning(s): ${parseErrors.slice(0, 3).join('; ')}${parseErrors.length > 3 ? ` (+${parseErrors.length - 3} more)` : ''}`;
      if (options.onProgress) {
        for (const err of parseErrors) {
          options.onProgress({ phase: 'warning', message: err } as PipelineProgress);
        }
      } else {
        process.stderr.write(`[monograph] ${summary}\n`);
      }
    }

    // Sweep orphaned rows for files that were renamed/deleted since the last build.
    // This MUST run unconditionally — even when every remaining file cache-hit
    // (ctx.allFilesCached === true), a file may have been deleted from disk between
    // builds, which produces zero cache misses but still leaves ghost rows in the DB
    // unless we compare the DB's known file set against the current on-disk set.
    //
    // The sweep is confined to the current build's source domain (`activeScope`).
    // A narrowed build never looked at files outside its domain, so their absence
    // from `filePaths` says nothing about whether they still exist on disk —
    // deleting those rows is how a code-only refresh used to erase every Document
    // node in the graph.
    const scanOut = outputs.get('scan') as { filePaths: string[] } | undefined;
    if (scanOut) {
      const liveFiles = new Set(scanOut.filePaths.map((f) => resolve(f)));
      const staleFiles = (
        db.prepare('SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL').all() as {
          file_path: string;
        }[]
      )
        .map((r) => r.file_path)
        .filter((f) => isWithinScope(f, activeScope) && !liveFiles.has(resolve(ctx.repoPath, f)));
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

    // Populate churnScore on File nodes from git history (6-month window)
    try {
      const churnResult = await analyzeChurn(ctx.repoPath, '6m');
      if (churnResult.files.length > 0) {
        // Only consider files that exist as graph nodes for normalization —
        // build artifacts and config files inflate the denominator otherwise
        const graphFiles = new Set(
          (
            db
              .prepare("SELECT file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL")
              .all() as { file_path: string }[]
          ).map((r) => r.file_path),
        );
        const graphChurn = churnResult.files.filter((f) => graphFiles.has(f.path));
        const maxWeighted = graphChurn.reduce(
          (m, f) => (f.weightedCommits > m ? f.weightedCommits : m),
          0,
        );
        if (maxWeighted > 0) {
          const updateProps = db.prepare(`
            UPDATE nodes SET properties = json_set(COALESCE(properties, '{}'), '$.churnScore', ?)
            WHERE file_path = ? AND label = 'File'
          `);
          db.transaction(() => {
            for (const f of graphChurn) {
              updateProps.run(f.weightedCommits / maxWeighted, f.path);
            }
          })();
        }
      }
    } catch {
      // churn analysis is non-fatal (e.g. no git history)
    }

    const hash = getCurrentCommitHash(resolve(repoPath));
    if (hash) {
      db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(hash);
    } else {
      const msg = 'Could not determine git HEAD — staleness tracking will be unavailable';
      if (options.onProgress) {
        options.onProgress({ phase: 'warning', message: msg } as PipelineProgress);
      } else {
        process.stderr.write(`[monograph] ${msg}\n`);
      }
    }
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('indexed_at', ?)").run(
      new Date().toISOString(),
    );
    writeIndexScope(db, activeScope);
    db.exec('COMMIT');

    // Skip expensive report regeneration when all files were cached (nothing changed) —
    // this is purely a performance optimization, not correctness-critical, so it stays
    // gated behind allFilesCached. This MUST run after COMMIT (issue #91): the async
    // generateGraphReport overload opens its own DB connection, which in WAL mode only
    // sees the last committed snapshot — run inside the open transaction, it would render
    // the report from the previous build (or an empty DB on the first build).
    if (!ctx.allFilesCached) {
      try {
        const suggestOut = outputs.get('suggest') as { questions: SuggestedQuestion[] } | undefined;
        const questions = suggestOut?.questions ?? [];
        await generateGraphReport(resolve(repoPath), undefined, dbPath, questions);
      } catch {
        // Report generation is non-fatal — the build itself already committed.
      }
    }
  } catch (err) {
    // Best-effort: if the connection is already broken (e.g. the failure was
    // itself a corrupt-database error), rolling back can throw too — the
    // original error is what matters and must not be masked by this one.
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    closeDb(db);
  }
}

/**
 * Re-index after files changed on disk.
 *
 * This runs the FULL pipeline, with extraction-cache reuse so unchanged files
 * are not re-parsed. The previous partial implementation deleted the changed
 * files' edges, re-parsed only those files, and stopped — it never reran
 * relationship resolution (imports, cross-file calls, scope/bridge resolution)
 * or the derived analyses (communities, processes, god-nodes). A one-line edit
 * therefore dropped every CALLS/IMPORTS/REFERENCES edge incident to that file
 * and left derived analysis stale. The watcher's deferred full rebuild repaired
 * that eventually; direct callers silently kept the incomplete graph.
 *
 * A genuine incremental path is still worth having, but it has to track the
 * changed files' dependents, recompute their relationships, and invalidate the
 * affected derived analyses. Until such an implementation exists and is proven
 * equivalent to a clean build, correctness wins over speed.
 */
export async function buildIncrementalAsync(
  repoPath: string,
  changedAbsPaths: string[],
  options: BuildOptions = {},
): Promise<void> {
  if (changedAbsPaths.length === 0) return;
  // `incremental` means "skip when the index is already fresh", which is keyed on
  // git HEAD. A working-tree edit doesn't move HEAD, so honouring the flag here
  // would skip the very rebuild the caller just asked for.
  await buildAsync(repoPath, { ...options, incremental: false });
  options.onProgress?.({
    phase: 'incremental',
    message: `Rebuilt after ${changedAbsPaths.length} changed file(s)`,
  });
}
