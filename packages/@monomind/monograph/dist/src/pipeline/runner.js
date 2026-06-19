import { MonographError } from '../types.js';
export class PipelineRunner {
    phases;
    /** Topo-sorted phase names, computed once in constructor for O(1) phase map lookups. */
    sortedNames;
    /** O(1) phase lookup by name. */
    phaseMap;
    constructor(phases) {
        this.phases = phases;
        this.sortedNames = topoSort(phases);
        this.phaseMap = new Map(phases.map(p => [p.name, p]));
    }
    async run(ctx) {
        const outputs = new Map();
        // Lazily-created promise per phase — ensures dep promises exist before they are awaited
        const promises = new Map();
        const getOrCreatePromise = (name) => {
            if (promises.has(name))
                return promises.get(name);
            const phase = this.phaseMap.get(name);
            const p = (async () => {
                // Wait for all dep phases to finish
                await Promise.all(phase.deps.map(dep => getOrCreatePromise(dep)));
                ctx.onProgress?.({ phase: phase.name });
                try {
                    const output = await phase.execute(ctx, outputs);
                    outputs.set(phase.name, output);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    throw new MonographError(`Phase '${phase.name}' failed: ${msg}`);
                }
            })();
            promises.set(name, p);
            return p;
        };
        // Use allSettled so every in-flight phase completes before we return.
        // This ensures the DB is not closed while phases are still writing to it,
        // which would otherwise cause unhandled rejections that hang the process.
        const results = await Promise.allSettled(this.sortedNames.map(name => getOrCreatePromise(name)));
        const failed = results.find(r => r.status === 'rejected');
        if (failed)
            throw failed.reason;
        return outputs;
    }
}
function topoSort(phases) {
    const names = new Set(phases.map(p => p.name));
    const inDegree = new Map();
    const adjList = new Map();
    for (const p of phases) {
        inDegree.set(p.name, p.deps.length);
        for (const dep of p.deps) {
            if (!names.has(dep)) {
                throw new MonographError(`Phase '${p.name}' depends on unknown phase '${dep}'`);
            }
            const adj = adjList.get(dep) ?? [];
            adj.push(p.name);
            adjList.set(dep, adj);
        }
    }
    const queue = phases.filter(p => (inDegree.get(p.name) ?? 0) === 0).map(p => p.name);
    const result = [];
    while (queue.length) {
        const name = queue.shift();
        result.push(name);
        for (const next of (adjList.get(name) ?? [])) {
            const deg = (inDegree.get(next) ?? 0) - 1;
            inDegree.set(next, deg);
            if (deg === 0)
                queue.push(next);
        }
    }
    if (result.length !== phases.length) {
        throw new MonographError('Cycle detected in pipeline phase graph');
    }
    return result;
}
/**
 * Incremental AST-only rebuild: clears EXTRACTED edges (re-parsed from code)
 * while preserving INFERRED and AMBIGUOUS edges (derived by reasoning).
 * Accepts a list of changed file paths; if empty, clears all EXTRACTED edges.
 */
export async function runIncrementalAst(db, changedFiles, options = {}) {
    const { preserveInferred = true } = options;
    if (preserveInferred) {
        if (changedFiles.length > 0) {
            const placeholders = changedFiles.map(() => '?').join(',');
            // Use a CTE to resolve file_path→id once, then delete edges referencing those ids.
            // This avoids passing changedFiles twice (N*2 params) and lets SQLite reuse the scan.
            db.prepare(`
        WITH changed_ids AS (
          SELECT id FROM nodes WHERE file_path IN (${placeholders})
        )
        DELETE FROM edges
        WHERE confidence = 'EXTRACTED'
        AND (
          source_id IN (SELECT id FROM changed_ids)
          OR target_id IN (SELECT id FROM changed_ids)
        )
      `).run(...changedFiles);
        }
        else {
            db.prepare(`DELETE FROM edges WHERE confidence = 'EXTRACTED'`).run();
        }
    }
    else {
        db.prepare(`DELETE FROM edges`).run();
    }
}
//# sourceMappingURL=runner.js.map