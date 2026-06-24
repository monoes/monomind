import type { PipelineOptions } from './types.js';
import type { PipelineProgress } from '../types.js';
export interface BuildOptions extends Partial<PipelineOptions> {
    onProgress?: (p: PipelineProgress) => void;
    force?: boolean;
    /** When true, skip the full rebuild if the index is already fresh (matches HEAD). Default false. */
    incremental?: boolean;
}
export declare function buildAsync(repoPath: string, options?: BuildOptions): Promise<void>;
//# sourceMappingURL=orchestrator.d.ts.map