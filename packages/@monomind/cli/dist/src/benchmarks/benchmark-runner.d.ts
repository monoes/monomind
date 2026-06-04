/** A single quality metric to evaluate against agent output. */
export interface QualityMetric {
    /** Discriminator selecting which evaluator runs. */
    type: 'contains_expected' | 'length_range' | 'no_hallucination' | 'json_valid' | 'custom_regex' | string;
    /** Per-metric configuration; shape depends on `type`. */
    config?: Record<string, unknown>;
}
/** Result of evaluating one quality metric. */
export interface MetricResult {
    /** The metric type that produced this result. */
    type: string;
    /** Whether the metric passed. */
    passed: boolean;
    /** Observed value (metric-specific). */
    actual: unknown;
    /** Expected value (metric-specific). */
    expected: unknown;
    /** Human-readable explanation. */
    message: string;
}
/** A benchmark definition loaded from a JSON file. */
export interface BenchmarkDefinition {
    /** Unique benchmark identifier. */
    benchmarkId: string;
    /** Agent slug this benchmark targets. */
    agentSlug: string;
    /** Quality metrics to evaluate. */
    qualityMetrics: QualityMetric[];
}
/** Result of running a single benchmark. */
export interface BenchmarkResult {
    /** The benchmark that was run. */
    benchmarkId: string;
    /** Unique run identifier. */
    runId: string;
    /** Agent slug the benchmark targeted. */
    agentSlug: string;
    /** Whether all metrics passed. */
    passed: boolean;
    /** Per-metric results. */
    metricResults: MetricResult[];
    /** ISO timestamp of the run. */
    runAt: string;
    /** Wall-clock duration in milliseconds. */
    durationMs: number;
}
/** A pinned baseline for regression comparison. */
export interface BenchmarkBaseline {
    /** ISO timestamp when the baseline was pinned. */
    pinnedAt: string;
    /** Fraction of results that passed [0, 1]. */
    passRate: number;
    /** Average run duration in milliseconds. */
    avgDurationMs: number;
}
export declare class BenchmarkRunner {
    private baselines;
    /**
     * Load benchmark definitions from JSON files in a directory.
     * Each JSON file should contain a single BenchmarkDefinition or an array of them.
     */
    loadBenchmarks(dir: string): BenchmarkDefinition[];
    /**
     * Evaluate quality metrics against an output string.
     */
    evaluateMetrics(output: string, metrics: QualityMetric[]): MetricResult[];
    /**
     * Run a single benchmark against provided agent output.
     */
    runBenchmark(def: BenchmarkDefinition, agentOutput: string): BenchmarkResult;
    /**
     * Pin current results as the baseline for a benchmark.
     */
    pinBaseline(benchmarkId: string, results: BenchmarkResult[]): BenchmarkBaseline;
    /**
     * Detect regression by comparing current results against a baseline.
     * Returns true if the current pass rate is strictly below the baseline pass rate.
     */
    detectRegression(current: BenchmarkResult[], baseline: BenchmarkBaseline): boolean;
    /**
     * Get a stored baseline by benchmark ID.
     */
    getBaseline(benchmarkId: string): BenchmarkBaseline | undefined;
    private evaluateSingleMetric;
}
export interface SwarmBenchTask {
    /** Unique task ID */
    id: string;
    /** One of the 5 SwarmBench coordination categories */
    type: 'pursuit' | 'synchronization' | 'foraging' | 'flocking' | 'transport';
    /** Human-readable description */
    description: string;
    /** Number of agents participating */
    agentCount: number;
    /** Steps / budget allowed */
    stepBudget: number;
    /** Success criterion function */
    evaluate: (agentOutputs: string[]) => SwarmBenchResult;
}
export interface SwarmBenchResult {
    taskId: string;
    type: SwarmBenchTask['type'];
    passed: boolean;
    score: number;
    stepsTaken: number;
    agentCount: number;
    details: string;
}
export declare const SWARM_BENCH_TASKS: readonly SwarmBenchTask[];
/**
 * Alias for {@link SWARM_BENCH_TASKS}. Kept for ergonomic imports.
 */
export declare const SWARM: readonly SwarmBenchTask[];
/**
 * SwarmBenchRunner — runs the 5 SwarmBench coordination task types.
 * Wraps BenchmarkRunner for regression baseline tracking.
 *
 * Source: https://arxiv.org/abs/2505.04364
 */
export declare class SwarmBenchRunner {
    private readonly inner;
    private baselines;
    /** Run all (or a subset of) SwarmBench tasks against simulated agent outputs. */
    runAll(agentOutputsByTask: Map<string, string[]>): SwarmBenchResult[];
    /** Run a single task type by id. */
    runTask(taskId: string, agentOutputs: string[]): SwarmBenchResult | undefined;
    /** Pin current results as the regression baseline. */
    pinBaseline(results: SwarmBenchResult[]): void;
    /** Detect regression: returns task IDs whose score dropped below baseline. */
    detectRegressions(current: SwarmBenchResult[]): string[];
    /** Expose underlying BenchmarkRunner for general benchmarks. */
    get benchmarkRunner(): BenchmarkRunner;
}
//# sourceMappingURL=benchmark-runner.d.ts.map