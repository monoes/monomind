/**
 * Benchmark Runner for Regression Testing (Task 34)
 * Loads benchmark definitions, evaluates quality metrics, and detects regressions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { containsExpected, lengthRange, noHallucination, jsonValid, customRegex, } from './metric-evaluators.js';
export class BenchmarkRunner {
    baselines = new Map();
    /**
     * Load benchmark definitions from JSON files in a directory.
     * Each JSON file should contain a single BenchmarkDefinition or an array of them.
     */
    loadBenchmarks(dir) {
        const benchmarks = [];
        // Safe-root constraint: reject any path that escapes the working directory
        const safeRoot = path.resolve(process.cwd());
        const resolved = path.resolve(dir);
        const rel = path.relative(safeRoot, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel))
            return [];
        if (!fs.existsSync(resolved)) {
            return benchmarks;
        }
        const files = fs.readdirSync(resolved).filter((f) => f.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(resolved, file);
            const raw = fs.readFileSync(filePath, 'utf-8');
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    benchmarks.push(...parsed);
                }
                else {
                    benchmarks.push(parsed);
                }
            }
            catch {
                // skip malformed file
                continue;
            }
        }
        return benchmarks;
    }
    /**
     * Evaluate quality metrics against an output string.
     */
    evaluateMetrics(output, metrics) {
        return metrics.map((metric) => this.evaluateSingleMetric(output, metric));
    }
    /**
     * Run a single benchmark against provided agent output.
     */
    runBenchmark(def, agentOutput) {
        const startTime = Date.now();
        const metricResults = this.evaluateMetrics(agentOutput, def.qualityMetrics);
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
    pinBaseline(benchmarkId, results) {
        const relevantResults = results.filter((r) => r.benchmarkId === benchmarkId);
        if (relevantResults.length === 0) {
            const baseline = {
                pinnedAt: new Date().toISOString(),
                passRate: 0,
                avgDurationMs: 0,
            };
            this.baselines.set(benchmarkId, baseline);
            return baseline;
        }
        const passCount = relevantResults.filter((r) => r.passed).length;
        const passRate = passCount / relevantResults.length;
        const avgDurationMs = relevantResults.reduce((sum, r) => sum + r.durationMs, 0) /
            relevantResults.length;
        const baseline = {
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
    detectRegression(current, baseline) {
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
    getBaseline(benchmarkId) {
        return this.baselines.get(benchmarkId);
    }
    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------
    evaluateSingleMetric(output, metric) {
        switch (metric.type) {
            case 'contains_expected':
                return containsExpected(output, metric.config);
            case 'length_range':
                return lengthRange(output, metric.config);
            case 'no_hallucination':
                return noHallucination(output, metric.config);
            case 'json_valid':
                return jsonValid(output);
            case 'custom_regex':
                return customRegex(output, metric.config);
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
// ------------------------------------------------------------------
// Default benchmark suite (5 coordination task types)
// ------------------------------------------------------------------
/** Pursuit — agents must collectively report a common target string. */
const pursuitTask = {
    id: 'swarm-pursuit-01',
    type: 'pursuit',
    description: 'All agents converge on and name the same moving target within the step budget',
    agentCount: 4,
    stepBudget: 10,
    evaluate(agentOutputs) {
        const target = 'TARGET_FOUND';
        const hits = agentOutputs.filter(o => o.includes(target)).length;
        const score = agentOutputs.length > 0 ? hits / agentOutputs.length : 0;
        return { taskId: this.id, type: this.type, passed: score >= 0.75, score, stepsTaken: 1, agentCount: agentOutputs.length, details: `${hits}/${agentOutputs.length} agents converged` };
    },
};
/** Synchronization — all agents must emit the same token at the same logical step. */
const synchronizationTask = {
    id: 'swarm-sync-01',
    type: 'synchronization',
    description: 'Agents reach consensus on a shared value simultaneously without direct communication',
    agentCount: 6,
    stepBudget: 5,
    evaluate(agentOutputs) {
        if (agentOutputs.length === 0)
            return { taskId: this.id, type: this.type, passed: false, score: 0, stepsTaken: 0, agentCount: 0, details: 'no outputs' };
        const counts = new Map();
        for (const o of agentOutputs) {
            const tok = o.trim().split(/\s+/)[0] ?? '';
            counts.set(tok, (counts.get(tok) ?? 0) + 1);
        }
        const maxAgree = Math.max(...counts.values());
        const score = maxAgree / agentOutputs.length;
        return { taskId: this.id, type: this.type, passed: score >= 0.8, score, stepsTaken: 1, agentCount: agentOutputs.length, details: `majority agreement: ${(score * 100).toFixed(0)}%` };
    },
};
/** Foraging — agents must collectively mention ≥ N distinct resources. */
const foragingTask = {
    id: 'swarm-forage-01',
    type: 'foraging',
    description: 'Agents distribute to discover and collect distinct resources from the environment',
    agentCount: 5,
    stepBudget: 15,
    evaluate(agentOutputs) {
        const resourcePattern = /RESOURCE_[A-Z]+/g;
        const found = new Set();
        for (const o of agentOutputs) {
            for (const m of o.matchAll(resourcePattern))
                found.add(m[0]);
        }
        const goal = 4;
        const score = Math.min(1, found.size / goal);
        return { taskId: this.id, type: this.type, passed: found.size >= goal, score, stepsTaken: 1, agentCount: agentOutputs.length, details: `${found.size}/${goal} resources found: ${[...found].join(', ')}` };
    },
};
/** Flocking — each agent must maintain formation by referencing its neighbour. */
const flockingTask = {
    id: 'swarm-flock-01',
    type: 'flocking',
    description: 'Agents maintain cohesion and alignment while navigating toward a goal',
    agentCount: 8,
    stepBudget: 20,
    evaluate(agentOutputs) {
        const cohesionKeyword = 'NEIGHBOUR_OK';
        const aligned = agentOutputs.filter(o => o.includes(cohesionKeyword)).length;
        const score = agentOutputs.length > 0 ? aligned / agentOutputs.length : 0;
        return { taskId: this.id, type: this.type, passed: score >= 0.7, score, stepsTaken: 1, agentCount: agentOutputs.length, details: `${aligned}/${agentOutputs.length} in formation` };
    },
};
/** Transport — item must appear in successive agent outputs showing relay progress. */
const transportTask = {
    id: 'swarm-transport-01',
    type: 'transport',
    description: 'Agents relay a payload across a chain; payload must appear in last agent output',
    agentCount: 4,
    stepBudget: 8,
    evaluate(agentOutputs) {
        const payload = 'PAYLOAD_DELIVERED';
        const lastAgentDelivered = agentOutputs.length > 0 && agentOutputs[agentOutputs.length - 1].includes(payload);
        const relayCount = agentOutputs.filter(o => o.includes('RELAY')).length;
        const score = lastAgentDelivered ? 1 : relayCount / Math.max(agentOutputs.length, 1);
        return { taskId: this.id, type: this.type, passed: lastAgentDelivered, score, stepsTaken: agentOutputs.length, agentCount: agentOutputs.length, details: lastAgentDelivered ? 'payload delivered' : `relay progress: ${relayCount}/${agentOutputs.length}` };
    },
};
export const SWARM_BENCH_TASKS = [
    pursuitTask,
    synchronizationTask,
    foragingTask,
    flockingTask,
    transportTask,
];
/**
 * SwarmBenchRunner — runs the 5 SwarmBench coordination task types.
 * Wraps BenchmarkRunner for regression baseline tracking.
 *
 * Source: https://arxiv.org/abs/2505.04364
 */
export class SwarmBenchRunner {
    inner = new BenchmarkRunner();
    baselines = new Map();
    /** Run all (or a subset of) SwarmBench tasks against simulated agent outputs. */
    runAll(agentOutputsByTask) {
        return SWARM_BENCH_TASKS.map(task => {
            const outputs = agentOutputsByTask.get(task.id) ?? [];
            return task.evaluate(outputs);
        });
    }
    /** Run a single task type by id. */
    runTask(taskId, agentOutputs) {
        const task = SWARM_BENCH_TASKS.find(t => t.id === taskId);
        return task?.evaluate(agentOutputs);
    }
    /** Pin current results as the regression baseline. */
    pinBaseline(results) {
        for (const r of results) {
            this.baselines.set(r.taskId, r);
        }
    }
    /** Detect regression: returns task IDs whose score dropped below baseline. */
    detectRegressions(current) {
        return current
            .filter(r => {
            const baseline = this.baselines.get(r.taskId);
            return baseline !== undefined && r.score < baseline.score;
        })
            .map(r => r.taskId);
    }
    /** Expose underlying BenchmarkRunner for general benchmarks. */
    get benchmarkRunner() {
        return this.inner;
    }
}
//# sourceMappingURL=benchmark-runner.js.map