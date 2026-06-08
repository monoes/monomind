export interface PipelineTimings {
    discoverFilesMs: number;
    fileCount: number;
    workspacesMs: number;
    workspaceCount: number;
    pluginsMs: number;
    scriptAnalysisMs: number;
    parseExtractMs: number;
    moduleCount: number;
    cacheHits: number;
    cacheMisses: number;
    cacheUpdateMs: number;
    entryPointsMs: number;
    entryPointCount: number;
    resolveImportsMs: number;
    buildGraphMs: number;
    analyzeMs: number;
    duplicationMs?: number;
    totalMs: number;
}
export declare const ZERO_PIPELINE_TIMINGS: PipelineTimings;
export declare function buildPipelinePerformanceLines(t: PipelineTimings): string[];
export declare function timingsSummary(t: PipelineTimings): string;
//# sourceMappingURL=pipeline-perf.d.ts.map