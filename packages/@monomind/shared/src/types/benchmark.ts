/**
 * Benchmark types for regression testing (Task 34)
 * Defines benchmark definitions, quality metrics, and baseline pinning.
 */

export interface BenchmarkDefinition {
  benchmarkId: string;
  name: string;
  description: string;
  taskDescription: string;     // the prompt to send to the agent
  agentSlug: string;           // which agent to test
  qualityMetrics: QualityMetric[];
  baseline?: BenchmarkBaseline;
}

export interface QualityMetric {
  type: 'contains_expected' | 'length_range' | 'no_hallucination' | 'json_valid' | 'custom_regex';
  config: Record<string, any>;  // e.g. { expected: "auth" } or { min: 100, max: 5000 }
}

export interface BenchmarkResult {
  benchmarkId: string;
  runId: string;
  agentSlug: string;
  passed: boolean;
  metricResults: MetricResult[];
  runAt: string;
  durationMs: number;
}

export interface MetricResult {
  type: string;
  passed: boolean;
  actual: any;
  expected: any;
  message?: string;
}

export interface BenchmarkBaseline {
  pinnedAt: string;
  passRate: number;
  avgDurationMs: number;
}
