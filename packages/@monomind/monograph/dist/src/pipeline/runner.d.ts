import type { PipelinePhase, PipelineContext } from './types.js';
export declare class PipelineRunner {
    private readonly phases;
    constructor(phases: PipelinePhase<unknown>[]);
    run(ctx: PipelineContext): Promise<Map<string, unknown>>;
}
export interface IncrementalAstOptions {
    /** If true, preserve INFERRED and AMBIGUOUS edges during code-only rebuild. Default true. */
    preserveInferred?: boolean;
}
/**
 * Incremental AST-only rebuild: clears EXTRACTED edges (re-parsed from code)
 * while preserving INFERRED and AMBIGUOUS edges (derived by reasoning).
 * Accepts a list of changed file paths; if empty, clears all EXTRACTED edges.
 */
export declare function runIncrementalAst(db: import('better-sqlite3').Database, changedFiles: string[], options?: IncrementalAstOptions): Promise<void>;
//# sourceMappingURL=runner.d.ts.map