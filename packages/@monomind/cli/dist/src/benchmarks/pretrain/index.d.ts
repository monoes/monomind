/**
 * Self-Learning Pre-Training Benchmark Suite
 * Comprehensive benchmarks for SONA, EWC++, MoE, pattern learning
 *
 * Metrics measured:
 * - SONA adaptation latency (<0.05ms target)
 * - Pattern learning throughput
 * - EWC++ consolidation effectiveness
 * - Memory retrieval accuracy
 * - Pre-training convergence speed
 *
 * @module v1/cli/benchmarks/pretrain
 */
export interface BenchmarkResult {
    name: string;
    iterations: number;
    meanMs: number;
    medianMs: number;
    p95Ms: number;
    p99Ms: number;
    minMs: number;
    maxMs: number;
    stdDev: number;
    opsPerSecond: number;
    targetMet: boolean;
    targetMs?: number;
}
export interface BenchmarkSuite {
    name: string;
    results: BenchmarkResult[];
    totalDurationMs: number;
    timestamp: string;
    environment: {
        nodeVersion: string;
        platform: string;
        arch: string;
        cpuCount: number;
    };
}
export interface BenchmarkConfig {
    iterations: number;
    warmupIterations: number;
    targetMs?: number;
    verbose?: boolean;
}
export declare function formatBenchmarkResult(result: BenchmarkResult): string;
export declare function runBenchmark(name: string, fn: () => Promise<void> | void, config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkSONAAdaptation(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkPatternLearning(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkEWCConsolidation(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkMemoryRetrieval(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkEmbeddingGeneration(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkMoERouting(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkBatchCosine(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function benchmarkPretrainPipeline(config: BenchmarkConfig): Promise<BenchmarkResult>;
export declare function runPretrainBenchmarkSuite(config?: Partial<BenchmarkConfig>): Promise<BenchmarkSuite>;
export default runPretrainBenchmarkSuite;
//# sourceMappingURL=index.d.ts.map