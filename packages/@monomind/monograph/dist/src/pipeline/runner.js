import { MonographError } from '../types.js';
export class PipelineRunner {
    phases;
    constructor(phases) {
        this.phases = phases;
        // Validate: detect cycles and unknown deps
        topoSort(phases);
    }
    async run(ctx) {
        const outputs = new Map();
        const phaseMap = new Map(this.phases.map(p => [p.name, p]));
        // Lazily-created promise per phase — ensures dep promises exist before they are awaited
        const promises = new Map();
        const getOrCreatePromise = (name) => {
            if (promises.has(name))
                return promises.get(name);
            const phase = phaseMap.get(name);
            const p = (async () => {
                // Wait for all dep phases to finish
                await Promise.all(phase.deps.map(dep => getOrCreatePromise(dep)));
                ctx.onProgress?.({ phase: phase.name });
                const output = await phase.execute(ctx, outputs);
                outputs.set(phase.name, output);
            })();
            promises.set(name, p);
            return p;
        };
        // Kick off all phases — each self-manages its dep wait via lazy promise creation
        await Promise.all(this.phases.map(phase => getOrCreatePromise(phase.name)));
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
            db.prepare(`
        DELETE FROM edges
        WHERE confidence = 'EXTRACTED'
        AND (
          source_id IN (SELECT id FROM nodes WHERE file_path IN (${placeholders}))
          OR target_id IN (SELECT id FROM nodes WHERE file_path IN (${placeholders}))
        )
      `).run(...changedFiles, ...changedFiles);
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