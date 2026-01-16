/**
 * DatasetRunner - Run eval datasets against agents and detect regressions (Task 33)
 */
import { randomUUID } from 'crypto';
import type { EvalRunResult, EvalTrace, RegressionDetail } from '../../../shared/src/types/eval.js';

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

export class DatasetRunner {
  /**
   * Run all traces through the agent runner and compute stats.
   * Optionally compare against a baseline to detect regressions.
   */
  async run(opts: DatasetRunOpts): Promise<EvalRunResult> {
    const {
      datasetId,
      agentVersion,
      traces,
      agentRunner,
      baselineResult,
      regressionThreshold = 0.1,
    } = opts;

    const results: Array<{ trace: EvalTrace; result: AgentRunnerResult }> = [];

    for (const trace of traces) {
      const result = await agentRunner(trace);
      results.push({ trace, result });
    }

    const passCount = results.filter((r) => r.result.outcome === 'success').length;
    const failCount = results.length - passCount;
    const totalQuality = results.reduce((sum, r) => sum + r.result.qualityScore, 0);
    const totalLatency = results.reduce((sum, r) => sum + r.result.latencyMs, 0);
    const avgQualityScore = results.length > 0 ? totalQuality / results.length : 0;
    const avgLatencyMs = results.length > 0 ? totalLatency / results.length : 0;

    // Regression detection
    const regressionDetails: RegressionDetail[] = [];
    let regressionDetected = false;

    if (baselineResult) {
      const delta = baselineResult.avgQualityScore - avgQualityScore;
      if (delta > regressionThreshold) {
        regressionDetected = true;
        // Report per-trace regressions for traces with quality below baseline average
        for (const { trace, result } of results) {
          if (result.qualityScore < baselineResult.avgQualityScore) {
            regressionDetails.push({
              traceId: trace.traceId,
              agentSlug: trace.agentSlug,
              baselineScore: baselineResult.avgQualityScore,
              currentScore: result.qualityScore,
              delta: baselineResult.avgQualityScore - result.qualityScore,
            });
          }
        }
      }
    }

    return {
      runId: randomUUID(),
      datasetId,
      runAt: new Date().toISOString(),
      agentVersion,
      entriesTested: results.length,
      passCount,
      failCount,
      avgQualityScore,
      avgLatencyMs,
      regressionDetected,
      regressionDetails,
    };
  }
}
