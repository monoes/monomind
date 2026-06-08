import type { PipelineOptions } from './types.js';
import type { PipelineProgress } from '../types.js';
export interface BuildOptions extends Partial<PipelineOptions> {
    onProgress?: (p: PipelineProgress) => void;
    force?: boolean;
}
export declare function buildAsync(repoPath: string, options?: BuildOptions): Promise<void>;
//# sourceMappingURL=orchestrator.d.ts.map