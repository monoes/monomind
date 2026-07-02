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

export async function buildAsync(repoPath: string, options: BuildOptions = {}): Promise<void> {
  const dbPath = resolve(join(repoPath, '.monomind', 'monograph.db'));
  const fullOptions: PipelineOptions = { ...DEFAULT_OPTIONS, ...options };

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

    // Every full build reuses the same DB in place (no truncate-on-open), and no
    // phase ever deletes nodes for files that were renamed/deleted since the last
    // build. Left unchecked, orphaned rows (and their FTS/edge fallout) accumulate
    // forever across repeated rebuilds. Sweep them here, once, after scan knows the
    // authoritative current file set.
    const scanOut = outputs.get('scan') as { filePaths: string[] } | undefined;
    if (scanOut) {
      const liveFiles = new Set(scanOut.filePaths.map((f) => resolve(f)));
      const staleFiles = (
        db.prepare('SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL').all() as { file_path: string }[]
      )
        .map((r) => r.file_path)
        .filter((f) => !liveFiles.has(resolve(f)));
      if (staleFiles.length > 0) {
        const deleteStale = db.transaction((files: string[]) => {
          // Edges FK-reference nodes with no ON DELETE CASCADE, and a stale node
          // can be referenced from either side (another file's export pointing at
          // it, or it importing another file) — clear both directions first.
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

    const hash = getCurrentCommitHash(resolve(repoPath));
    if (hash) {
      db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(hash);
    }

    const suggestOut = outputs.get('suggest') as { questions: SuggestedQuestion[] } | undefined;
    const questions = suggestOut?.questions ?? [];
    await generateGraphReport(resolve(repoPath), undefined, dbPath, questions);
  } finally {
    closeDb(db);
  }
}
