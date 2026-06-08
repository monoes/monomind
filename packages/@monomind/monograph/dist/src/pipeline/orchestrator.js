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
function getCurrentCommitHash(repoPath) {
    try {
        return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    }
    catch {
        return null;
    }
}
export async function buildAsync(repoPath, options = {}) {
    const dbPath = resolve(join(repoPath, '.monomind', 'monograph.db'));
    const fullOptions = { ...DEFAULT_OPTIONS, ...options };
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
        const hash = getCurrentCommitHash(resolve(repoPath));
        if (hash) {
            db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(hash);
        }
        const suggestOut = outputs.get('suggest');
        const questions = suggestOut?.questions ?? [];
        await generateGraphReport(resolve(repoPath), undefined, dbPath, questions);
    }
    finally {
        closeDb(db);
    }
}
//# sourceMappingURL=orchestrator.js.map