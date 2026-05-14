import type { EvalRunResult, EvalTrace } from '../../../shared/src/types/eval.js';
export interface AgentRunnerResult {
    agentOutput: string;
    outcome: 'success' | 'failure' | 'timeout';
    qualityScore: number;
    latencyMs: number;
}
export interface DatasetRunOpts {
    datasetId: string;
    agentVersion: string;
    traces: EvalTrace[];
    agentRunner: (trace: EvalTrace) => Promise<AgentRunnerResult>;
    baselineResult?: EvalRunResult;
    regressionThreshold?: number;
}
export declare class DatasetRunner {
    /**
     * Run all traces through the agent runner and compute stats.
     * Optionally compare against a baseline to detect regressions.
     */
    run(opts: DatasetRunOpts): Promise<EvalRunResult>;
}
//# sourceMappingURL=dataset-runner.d.ts.map