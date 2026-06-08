export interface HealthTimings {
    churnMs: number;
    complexityMs: number;
    duplicationMs: number;
    scoringMs: number;
    renderMs: number;
    totalMs: number;
}
export declare function printPerformanceTable(timings: HealthTimings): string;
export interface HealthPipelineTimings {
    configMs: number;
    discoverMs: number;
    parseMs: number;
    complexityMs: number;
    fileScoresMs: number;
    gitChurnMs: number;
    gitChurnCacheHit: boolean;
    hotspotsMs: number;
    duplicationMs: number;
    targetsMs: number;
    totalMs: number;
}
export declare const ZERO_HEALTH_PIPELINE_TIMINGS: HealthPipelineTimings;
export declare function formatHealthPipelineTimings(t: HealthPipelineTimings): string;
export declare function sumHealthPipelineTimings(phases: Partial<HealthPipelineTimings>): number;
//# sourceMappingURL=timings.d.ts.map