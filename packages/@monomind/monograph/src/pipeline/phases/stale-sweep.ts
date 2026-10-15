import { resolve } from 'node:path';
import { isWithinScope, scopeForOptions } from '../index-scope.js';
import type { PipelinePhase } from '../types.js';
import type { ScanOutput } from './scan.js';

export interface StaleSweepOutput {
  removedFiles: string[];
}

/**
 * Drop rows for files that were renamed/deleted since the last build.
 *
 * This MUST run unconditionally — even when every remaining file cache-hit
 * (`ctx.allFilesCached`), a file may have been deleted from disk between builds,
 * which produces zero cache misses but still leaves ghost rows in the DB unless
 * the DB's known file set is compared against the current on-disk set. It also
 * MUST run before the derived phases (communities, processes): they re-derive from
 * the DB, so sweeping afterwards leaves them describing symbols that no longer exist.
 *
 * The sweep is confined to the current build's source domain. A narrowed build
 * never looked at files outside its domain, so their absence from the scan says
 * nothing about whether they still exist — deleting those rows is how a code-only
 * refresh used to erase every Document node in the graph.
 */
export const staleSweepPhase: PipelinePhase<StaleSweepOutput> = {
  name: 'stale-sweep',
  deps: ['scan', 'parse'],
  async execute(ctx, deps) {
    const { filePaths } = deps.get('scan') as ScanOutput;
    const db = ctx.db;
    const scope = scopeForOptions(ctx.options.codeOnly);

    const liveFiles = new Set(filePaths.map((f) => resolve(f)));
    const staleFiles = (
      db.prepare('SELECT DISTINCT file_path FROM nodes WHERE file_path IS NOT NULL').all() as {
        file_path: string;
      }[]
    )
      .map((r) => r.file_path)
      .filter((f) => isWithinScope(f, scope) && !liveFiles.has(resolve(ctx.repoPath, f)));

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
      // The graph changed even though no file was re-parsed, so the derived
      // analyses (communities, processes) must be recomputed.
      ctx.allFilesCached = false;
    }

    return { removedFiles: staleFiles };
  },
};
