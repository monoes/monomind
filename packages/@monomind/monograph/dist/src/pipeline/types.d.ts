import type { MonographDb } from '../storage/db.js';
import type { PipelineProgress } from '../types.js';
import type Graph from 'graphology';
export interface PipelineContext {
    repoPath: string;
    db: MonographDb;
    graph: Graph;
    onProgress: (p: PipelineProgress) => void;
    options: PipelineOptions;
}
export interface PipelineOptions {
    codeOnly: boolean;
    maxFileSizeBytes: number;
    workerPoolThreshold: number;
    workerChunkBudgetBytes: number;
    ignore: string[];
    /** Max Section nodes to submit to LLM extraction (0 = disabled). Default 0. */
    llmMaxSections: number;
}
export declare const DEFAULT_OPTIONS: PipelineOptions;
export interface PipelinePhase<TOutput> {
    name: string;
    deps: string[];
    execute(ctx: PipelineContext, depOutputs: Map<string, unknown>): Promise<TOutput>;
}
//# sourceMappingURL=types.d.ts.map