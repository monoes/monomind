/**
 * Benchmark Runner for Regression Testing (Task 34)
 * Loads benchmark definitions, evaluates quality metrics, and detects regressions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  BenchmarkDefinition,
  BenchmarkResult,
  BenchmarkBaseline,
  QualityMetric,
  MetricResult,
} from '@monobrain/shared';
import {
  containsExpected,
  lengthRange,
  noHallucination,
  jsonValid,
  customRegex,
} from './metric-evaluators.js';

export class BenchmarkRunner {
  private baselines: Map<string, BenchmarkBaseline> = new Map();

  /**
   * Load benchmark definitions from JSON files in a directory.
   * Each JSON file should contain a single BenchmarkDefinition or an array of them.
   */
  loadBenchmarks(dir: string): BenchmarkDefinition[] {
    const benchmarks: BenchmarkDefinition[] = [];

    if (!fs.existsSync(dir)) {
      return benchmarks;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        benchmarks.push(...parsed);
      } else {
        benchmarks.push(parsed);
      }
    }

    return benchmarks;
  }

  /**
   * Evaluate quality metrics against an output string.
   */
  evaluateMetrics(output: string, metrics: QualityMetric[]): MetricResult[] {
    return metrics.map((metric) => this.evaluateSingleMetric(output, metric));
  }

  /**
   * Run a single benchmark against provided agent output.
   */
  runBenchmark(
    def: BenchmarkDefinition,
    agentOutput: string,
  ): BenchmarkResult {
    const startTime = Date.now();
    const metricResults = this.evaluateMetrics(
      agentOutput,
      def.qualityMetrics,
    );
    const durationMs = Date.now() - startTime;
    const passed = metricResults.every((r) => r.passed);

    return {
      benchmarkId: def.benchmarkId,
      runId: randomUUID(),
      agentSlug: def.agentSlug,
      passed,
      metricResults,
      runAt: new Date().toISOString(),
      durationMs,
    };
  }

  /**
   * Pin current results as the baseline for a benchmark.
   */
  pinBaseline(benchmarkId: string, results: BenchmarkResult[]): BenchmarkBaseline {
    const relevantResults = results.filter(
      (r) => r.benchmarkId === benchmarkId,
    );

    if (relevantResults.length === 0) {
      const baseline: BenchmarkBaseline = {
        pinnedAt: new Date().toISOString(),
        passRate: 0,
        avgDurationMs: 0,
      };
      this.baselines.set(benchmarkId, baseline);
      return baseline;
    }

    const passCount = relevantResults.filter((r) => r.passed).length;
    const passRate = passCount / relevantResults.length;
    const avgDurationMs =
      relevantResults.reduce((sum, r) => sum + r.durationMs, 0) /
      relevantResults.length;

    const baseline: BenchmarkBaseline = {
      pinnedAt: new Date().toISOString(),
      passRate,
      avgDurationMs,
    };

    this.baselines.set(benchmarkId, baseline);
    return baseline;
  }

  /**
   * Detect regression by comparing current results against a baseline.
   * Returns true if the current pass rate is strictly below the baseline pass rate.
   */
  detectRegression(
    current: BenchmarkResult[],
    baseline: BenchmarkBaseline,
  ): boolean {
    if (current.length === 0) {
      return false;
    }

    const passCount = current.filter((r) => r.passed).length;
    const currentPassRate = passCount / current.length;

    return currentPassRate < baseline.passRate;
  }

  /**
   * Get a stored baseline by benchmark ID.
   */
  getBaseline(benchmarkId: string): BenchmarkBaseline | undefined {
    return this.baselines.get(benchmarkId);
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private evaluateSingleMetric(
    output: string,
    metric: QualityMetric,
  ): MetricResult {
    switch (metric.type) {
      case 'contains_expected':
        return containsExpected(output, metric.config as { expected: string });
      case 'length_range':
        return lengthRange(
          output,
          metric.config as { min: number; max: number },
        );
      case 'no_hallucination':
        return noHallucination(
          output,
          metric.config as { forbidden: string[] },
        );
      case 'json_valid':
        return jsonValid(output);
      case 'custom_regex':
        return customRegex(output, metric.config as { pattern: string });
      default:
        return {
          type: metric.type,
          passed: false,
          actual: null,
          expected: null,
          message: `Unknown metric type: ${metric.type}`,
        };
    }
  }
}
