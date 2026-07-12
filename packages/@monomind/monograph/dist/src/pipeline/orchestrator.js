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
import { DEFAULT_OPTIONS } from './types.js';
import { generateGraphReport } from '../reporting/graph-report.js';
import { analyzeChurn } from '../analysis/churn.js';
import { ExtractionCache } from '../cache/extraction-cache.js';
function getCurrentCommitHash(repoPath) {
    try {
        return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    }
    catch {
        return null;
    }
}
// Cross-process build mutex. Callers arrive from several independent entry points
// (session-start hook, MCP staleness auto-build, CLI, watcher), each with its own
// ad-hoc lock file that the others don't know about — concurrent builds then fail
// with "database is locked". Serialize here, the one place all builders pass through.
async function acquireBuildLock(dbPath) {
    const { writeFileSync, readFileSync, statSync, unlinkSync, mkdirSync } = await import('fs');
    const { dirname } = await import('path');
    const lockPath = dbPath + '.build-lock';
    mkdirSync(dirname(lockPath), { recursive: true });
    const tryAcquire = () => {
        try {
            writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
            return true;
        }
        catch {
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
            }
            catch {
                stale = true;
            }
            if (!stale && Date.now() - statSync(lockPath).mtimeMs > 30 * 60 * 1000)
                stale = true;
        }
        catch {
            stale = true;
        }
        if (!stale)
            return null;
        try {
            unlinkSync(lockPath);
        }
        catch { /* raced with another reclaimer */ }
        if (!tryAcquire())
            return null;
    }
    return () => { try {
        unlinkSync(lockPath);
    }
    catch { /* already gone */ } };
}
export async function buildAsync(repoPath, options = {}) {
    const dbPath = resolve(join(repoPath, '.monomind', 'monograph.db'));
    const fullOptions = { ...DEFAULT_OPTIONS, ...options };
    const releaseLock = await acquireBuildLock(dbPath);
    if (!releaseLock) {
        options.onProgress?.({ phase: 'skip', message: 'Another build is in progress — skipping' });
        return;
    }
    try {
        await buildAsyncLocked(repoPath, dbPath, fullOptions, options);
    }
    finally {
        releaseLock();
    }
}
async function buildAsyncLocked(repoPath, dbPath, fullOptions, options) {
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
            }
            finally {
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
                options.onProgress?.({ phase: 'prune', message: `Parse cache: pruned ${removed} stale entries` });
            }
        }
        catch { /* non-fatal — cache pruning must never block a build */ }
    }
    const db = openDb(dbPath);
    try {
        const graph = new Graph({ multi: true, type: 'directed' });
        const ctx = {
            repoPath: resolve(repoPath),
            db, graph,
            onProgress: options.onProgress ?? (() => { }),
            options: fullOptions,
        };
        const runner = new PipelineRunner([
            scanPhase, frameworkDetectPhase, structurePhase, parsePhase, variablesPhase,
            markdownPhase, routesPhase, toolsPhase, ormPhase,
            crossFilePhase, wildcardSynthesisPhase, importResolverPhase, scopeResolutionPhase,
            mroPhase, communitiesPhase, processesPhase, godNodesPhase, surprisesPhase, suggestPhase,
        ]);
        const outputs = await runner.run(ctx);
        // Sweep orphaned rows for files that were renamed/deleted since the last build.
        // This MUST run unconditionally — even when every remaining file cache-hit
        // (ctx.allFilesCached === true), a file may have been deleted from disk between
        // builds, which produces zero cache misses but still leaves ghost rows in the DB
        // unless we compare the DB's known file set against the current on-disk set.
        const scanOut = outputs.get('scan');
        if (scanOut) {
            const liveFiles = new Set(scanOut.filePaths.map((f) => resolve(f)));
            const staleFiles = db.prepare('SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL').all()
                .map((r) => r.file_path)
                .filter((f) => !liveFiles.has(resolve(ctx.repoPath, f)));
            if (staleFiles.length > 0) {
                const deleteStale = db.transaction((files) => {
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
        // Skip expensive report regeneration when all files were cached (nothing changed) —
        // this is purely a performance optimization, not correctness-critical, so it stays
        // gated behind allFilesCached.
        if (!ctx.allFilesCached) {
            const suggestOut = outputs.get('suggest');
            const questions = suggestOut?.questions ?? [];
            await generateGraphReport(resolve(repoPath), undefined, dbPath, questions);
        }
        // Populate churnScore on File nodes from git history (6-month window)
        try {
            const churnResult = await analyzeChurn(ctx.repoPath, '6m');
            if (churnResult.files.length > 0) {
                // Only consider files that exist as graph nodes for normalization —
                // build artifacts and config files inflate the denominator otherwise
                const graphFiles = new Set(db.prepare("SELECT file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL").all()
                    .map(r => r.file_path));
                const graphChurn = churnResult.files.filter(f => graphFiles.has(f.path));
                const maxWeighted = graphChurn.reduce((m, f) => f.weightedCommits > m ? f.weightedCommits : m, 0);
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
        }
        catch {
            // churn analysis is non-fatal (e.g. no git history)
        }
        const hash = getCurrentCommitHash(resolve(repoPath));
        if (hash) {
            db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(hash);
        }
        else {
            const msg = 'Could not determine git HEAD — staleness tracking will be unavailable';
            if (options.onProgress) {
                options.onProgress({ phase: 'warning', message: msg });
            }
            else {
                process.stderr.write(`[monograph] ${msg}\n`);
            }
        }
        db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('indexed_at', ?)").run(new Date().toISOString());
    }
    finally {
        closeDb(db);
    }
}
//# sourceMappingURL=orchestrator.js.map