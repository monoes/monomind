import type { PipelinePhase } from '../types.js';
import type Database from 'better-sqlite3';
export interface ReExportPropagationOutput {
    propagated: number;
}
/**
 * Fixed-point re-export chain propagation.
 *
 * After the graph is built, barrel files (index.ts that re-export from sub-modules)
 * create RE_EXPORTS edges pointing to the files they re-export from. A file is
 * "reachable" if:
 *   (a) it has a direct IMPORTS edge targeting one of its symbols or its File node, OR
 *   (b) it is re-exported by a barrel file that is itself reachable (transitively).
 *
 * This prevents false "unreachable" reports for exports behind barrel files.
 *
 * Algorithm: iterative BFS until no new propagations (fixed-point).
 */
export declare function propagateReExports(db: Database.Database): ReExportPropagationOutput;
export declare const reExportPropagationPhase: PipelinePhase<ReExportPropagationOutput>;
//# sourceMappingURL=re-export-propagation.d.ts.map