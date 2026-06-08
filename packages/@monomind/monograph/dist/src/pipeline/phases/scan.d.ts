import type { PipelinePhase } from '../types.js';
export interface ScanOutput {
    filePaths: string[];
    totalBytes: number;
}
export declare const scanPhase: PipelinePhase<ScanOutput>;
export interface CorpusAssessment {
    level: 'ok' | 'info' | 'warn';
    warning: string;
}
export declare function assessCorpus(opts: {
    fileCount: number;
    totalBytes: number;
}): CorpusAssessment;
//# sourceMappingURL=scan.d.ts.map