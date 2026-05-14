/**
 * Benchmark Runner for Regression Testing (Task 34)
 * Loads benchmark definitions, evaluates quality metrics, and detects regressions.
 */
type BenchmarkDefinition = any;
type BenchmarkResult = any;
type BenchmarkBaseline = any;
type QualityMetric = any;
type MetricResult = any;
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
/** Minimal local type aliases so SwarmBench doesn't depend on the broken
 *  @monomind/shared exports at the top of this file. */
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
export {};
//# sourceMappingURL=benchmark-runner.d.ts.map