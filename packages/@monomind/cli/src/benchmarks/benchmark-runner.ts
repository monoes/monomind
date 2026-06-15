/**
 * Benchmark Runner for Regression Testing (Task 34)
 * Loads benchmark definitions, evaluates quality metrics, and detects regressions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  containsExpected,
  lengthRange,
  noHallucination,
  jsonValid,
  customRegex,
} from './metric-evaluators.js';

// ------------------------------------------------------------------
// Local type aliases — defined here so the runner doesn't depend on the
// broken @monomind/shared exports.
// ------------------------------------------------------------------

/** A single quality metric to evaluate against agent output. */
export interface QualityMetric {
  /** Discriminator selecting which evaluator runs. */
  type:
    | 'contains_expected'
    | 'length_range'
    | 'no_hallucination'
    | 'json_valid'
    | 'custom_regex'
    | string;
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

export class BenchmarkRunner {
  private baselines = new Map<string, BenchmarkBaseline>();

  /**
   * Load benchmark definitions from JSON files in a directory.
   * Each JSON file should contain a single BenchmarkDefinition or an array of them.
   */
  loadBenchmarks(dir: string): BenchmarkDefinition[] {
    const benchmarks: BenchmarkDefinition[] = [];
    // Safe-root constraint: reject any path that escapes the working directory
    const safeRoot = path.resolve(process.cwd());
    const resolved = path.resolve(dir);
    const rel = path.relative(safeRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return [];
    if (!fs.existsSync(resolved)) {
      return benchmarks;
    }
    const MAX_BENCH_FILE_SIZE = 1 * 1024 * 1024; // 1 MB per benchmark file
    const files = fs.readdirSync(resolved).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(resolved, file);
      // Guard against OOM: reject symlinks and oversized files before reading
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(filePath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.size > MAX_BENCH_FILE_SIZE) continue;
      const raw = fs.readFileSync(filePath, 'utf-8');
      try {
        const parsed = JSON.parse(raw) as BenchmarkDefinition | BenchmarkDefinition[];
        if (Array.isArray(parsed)) {
          benchmarks.push(...parsed);
        } else {
          benchmarks.push(parsed);
        }
      } catch {
        // skip malformed file
        continue;
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
  runBenchmark(def: BenchmarkDefinition, agentOutput: string): BenchmarkResult {
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
  pinBaseline(benchmarkId: string, results: BenchmarkResult[]): BenchmarkBaseline {
    const relevantResults = results.filter((r) => r.benchmarkId === benchmarkId);
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
  detectRegression(current: BenchmarkResult[], baseline: BenchmarkBaseline): boolean {
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

  private evaluateSingleMetric(output: string, metric: QualityMetric): MetricResult {
    switch (metric.type) {
      case 'contains_expected':
        return containsExpected(output, metric.config as { expected: string });
      case 'length_range':
        return lengthRange(output, metric.config as { min: number; max: number });
      case 'no_hallucination':
        return noHallucination(output, metric.config as { forbidden: string[] });
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

// ------------------------------------------------------------------
// Minimal local type aliases so SwarmBench doesn't depend on the broken
// @monomind/shared exports at the top of this file.
// ------------------------------------------------------------------

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

// ------------------------------------------------------------------
// Default benchmark suite (5 coordination task types)
// ------------------------------------------------------------------

/** Pursuit — agents must collectively report a common target string. */
const pursuitTask: SwarmBenchTask = {
  id: 'swarm-pursuit-01',
  type: 'pursuit',
  description: 'All agents converge on and name the same moving target within the step budget',
  agentCount: 4,
  stepBudget: 10,
  evaluate(agentOutputs: string[]): SwarmBenchResult {
    const target = 'TARGET_FOUND';
    const hits = agentOutputs.filter((o) => o.includes(target)).length;
    const score = agentOutputs.length > 0 ? hits / agentOutputs.length : 0;
    return {
      taskId: this.id,
      type: this.type,
      passed: score >= 0.75,
      score,
      stepsTaken: 1,
      agentCount: agentOutputs.length,
      details: `${hits}/${agentOutputs.length} agents converged`,
    };
  },
};

/** Synchronization — all agents must emit the same token at the same logical step. */
const synchronizationTask: SwarmBenchTask = {
  id: 'swarm-sync-01',
  type: 'synchronization',
  description:
    'Agents reach consensus on a shared value simultaneously without direct communication',
  agentCount: 6,
  stepBudget: 5,
  evaluate(agentOutputs: string[]): SwarmBenchResult {
    if (agentOutputs.length === 0)
      return {
        taskId: this.id,
        type: this.type,
        passed: false,
        score: 0,
        stepsTaken: 0,
        agentCount: 0,
        details: 'no outputs',
      };
    const counts = new Map<string, number>();
    for (const o of agentOutputs) {
      const tok = o.trim().split(/\s+/)[0] ?? '';
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
    const maxAgree = Math.max(...counts.values());
    const score = maxAgree / agentOutputs.length;
    return {
      taskId: this.id,
      type: this.type,
      passed: score >= 0.8,
      score,
      stepsTaken: 1,
      agentCount: agentOutputs.length,
      details: `majority agreement: ${(score * 100).toFixed(0)}%`,
    };
  },
};

/** Foraging — agents must collectively mention ≥ N distinct resources. */
const foragingTask: SwarmBenchTask = {
  id: 'swarm-forage-01',
  type: 'foraging',
  description: 'Agents distribute to discover and collect distinct resources from the environment',
  agentCount: 5,
  stepBudget: 15,
  evaluate(agentOutputs: string[]): SwarmBenchResult {
    const resourcePattern = /RESOURCE_[A-Z]+/g;
    const found = new Set<string>();
    for (const o of agentOutputs) {
      for (const m of o.matchAll(resourcePattern)) found.add(m[0]);
    }
    const goal = 4;
    const score = Math.min(1, found.size / goal);
    return {
      taskId: this.id,
      type: this.type,
      passed: found.size >= goal,
      score,
      stepsTaken: 1,
      agentCount: agentOutputs.length,
      details: `${found.size}/${goal} resources found: ${[...found].join(', ')}`,
    };
  },
};

/** Flocking — each agent must maintain formation by referencing its neighbour. */
const flockingTask: SwarmBenchTask = {
  id: 'swarm-flock-01',
  type: 'flocking',
  description: 'Agents maintain cohesion and alignment while navigating toward a goal',
  agentCount: 8,
  stepBudget: 20,
  evaluate(agentOutputs: string[]): SwarmBenchResult {
    const cohesionKeyword = 'NEIGHBOUR_OK';
    const aligned = agentOutputs.filter((o) => o.includes(cohesionKeyword)).length;
    const score = agentOutputs.length > 0 ? aligned / agentOutputs.length : 0;
    return {
      taskId: this.id,
      type: this.type,
      passed: score >= 0.7,
      score,
      stepsTaken: 1,
      agentCount: agentOutputs.length,
      details: `${aligned}/${agentOutputs.length} in formation`,
    };
  },
};

/** Transport — item must appear in successive agent outputs showing relay progress. */
const transportTask: SwarmBenchTask = {
  id: 'swarm-transport-01',
  type: 'transport',
  description: 'Agents relay a payload across a chain; payload must appear in last agent output',
  agentCount: 4,
  stepBudget: 8,
  evaluate(agentOutputs: string[]): SwarmBenchResult {
    const payload = 'PAYLOAD_DELIVERED';
    const lastAgentDelivered =
      agentOutputs.length > 0 && agentOutputs[agentOutputs.length - 1].includes(payload);
    const relayCount = agentOutputs.filter((o) => o.includes('RELAY')).length;
    const score = lastAgentDelivered ? 1 : relayCount / Math.max(agentOutputs.length, 1);
    return {
      taskId: this.id,
      type: this.type,
      passed: lastAgentDelivered,
      score,
      stepsTaken: agentOutputs.length,
      agentCount: agentOutputs.length,
      details: lastAgentDelivered
        ? 'payload delivered'
        : `relay progress: ${relayCount}/${agentOutputs.length}`,
    };
  },
};

export const SWARM_BENCH_TASKS: readonly SwarmBenchTask[] = [
  pursuitTask,
  synchronizationTask,
  foragingTask,
  flockingTask,
  transportTask,
];

/**
 * Alias for {@link SWARM_BENCH_TASKS}. Kept for ergonomic imports.
 */
export const SWARM = SWARM_BENCH_TASKS;

/**
 * SwarmBenchRunner — runs the 5 SwarmBench coordination task types.
 * Wraps BenchmarkRunner for regression baseline tracking.
 *
 * Source: https://arxiv.org/abs/2505.04364
 */
export class SwarmBenchRunner {
  private readonly inner = new BenchmarkRunner();
  private baselines = new Map<string, SwarmBenchResult>();

  /** Run all (or a subset of) SwarmBench tasks against simulated agent outputs. */
  runAll(agentOutputsByTask: Map<string, string[]>): SwarmBenchResult[] {
    return SWARM_BENCH_TASKS.map((task) => {
      const outputs = agentOutputsByTask.get(task.id) ?? [];
      return task.evaluate(outputs);
    });
  }

  /** Run a single task type by id. */
  runTask(taskId: string, agentOutputs: string[]): SwarmBenchResult | undefined {
    const task = SWARM_BENCH_TASKS.find((t) => t.id === taskId);
    return task?.evaluate(agentOutputs);
  }

  /** Pin current results as the regression baseline. */
  pinBaseline(results: SwarmBenchResult[]): void {
    for (const r of results) {
      this.baselines.set(r.taskId, r);
    }
  }

  /** Detect regression: returns task IDs whose score dropped below baseline. */
  detectRegressions(current: SwarmBenchResult[]): string[] {
    return current
      .filter((r) => {
        const baseline = this.baselines.get(r.taskId);
        return baseline !== undefined && r.score < baseline.score;
      })
      .map((r) => r.taskId);
  }

  /** Expose underlying BenchmarkRunner for general benchmarks. */
  get benchmarkRunner(): BenchmarkRunner {
    return this.inner;
  }
}
