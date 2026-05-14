#!/usr/bin/env node
/**
 * Headless Runtime for Background Workers
 * Runs without TTY for daemon processes and scheduled tasks
 *
 * Usage:
 *   npx @monoes/cli headless --worker <type>
 *   npx @monoes/cli headless --daemon
 *   npx @monoes/cli headless --benchmark
 *
 * Environment:
 *   MONOMIND_HEADLESS=true
 *   CLAUDE_CODE_HEADLESS=true
 *
 * @module v1/cli/runtime/headless
 */
import { type HeadlessWorkerType } from '../services/headless-worker-executor.js';
interface HeadlessConfig {
    mode: 'worker' | 'daemon' | 'benchmark' | 'status';
    workerType?: HeadlessWorkerType;
    timeout?: number;
    verbose?: boolean;
}
interface BenchmarkResults {
    sona: {
        avgMs: number;
        targetMet: boolean;
    };
    flashAttention: {
        throughputPerMs: number;
        speedup: number;
    };
    hnsw: {
        entriesIndexed: number;
        searchTime: number;
    };
}
/**
 * Run a specific worker
 */
declare function runWorker(workerType: HeadlessWorkerType, timeout: number): Promise<void>;
/**
 * Run daemon mode
 */
declare function runDaemon(): Promise<void>;
/**
 * Run benchmarks
 */
declare function runBenchmarks(): Promise<BenchmarkResults>;
/**
 * Show system status
 */
declare function showStatus(): Promise<void>;
/**
 * Main entry point
 */
declare function main(): Promise<void>;
export { main, runWorker, runDaemon, runBenchmarks, showStatus };
export type { HeadlessConfig, BenchmarkResults };
//# sourceMappingURL=headless.d.ts.map