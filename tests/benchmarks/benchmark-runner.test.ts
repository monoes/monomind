/**
 * Benchmark Runner Tests (Task 34)
 * 16+ tests covering metric evaluation, benchmark execution,
 * baseline pinning, and regression detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkRunner } from '../../packages/@monomind/cli/src/benchmarks/benchmark-runner.js';
import type {
  BenchmarkDefinition,
  BenchmarkResult,
  BenchmarkBaseline,
  QualityMetric,
} from '../../packages/@monomind/shared/src/types/benchmark.js';

vi.mock('fs');
vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

describe('BenchmarkRunner', () => {
  let runner: BenchmarkRunner;

  beforeEach(() => {
    runner = new BenchmarkRunner();
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------------
  // loadBenchmarks
  // ----------------------------------------------------------------

  describe('loadBenchmarks', () => {
    it('reads JSON files from directory', () => {
      const benchDef: BenchmarkDefinition = {
        benchmarkId: 'b-1',
        name: 'Auth Test',
        description: 'Tests auth output',
        taskDescription: 'Generate auth code',
        agentSlug: 'coder',
        qualityMetrics: [
          { type: 'contains_expected', config: { expected: 'auth' } },
        ],
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'bench1.json' as unknown as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(benchDef));

      const result = runner.loadBenchmarks('/tmp/benchmarks');

      expect(result).toHaveLength(1);
      expect(result[0].benchmarkId).toBe('b-1');
      expect(fs.readdirSync).toHaveBeenCalledWith('/tmp/benchmarks');
    });

    it('returns empty array for non-existent directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = runner.loadBenchmarks('/tmp/nonexistent');

      expect(result).toHaveLength(0);
    });

    it('handles files containing arrays of benchmarks', () => {
      const defs: BenchmarkDefinition[] = [
        {
          benchmarkId: 'b-1',
          name: 'Test 1',
          description: 'Desc 1',
          taskDescription: 'Task 1',
          agentSlug: 'coder',
          qualityMetrics: [],
        },
        {
          benchmarkId: 'b-2',
          name: 'Test 2',
          description: 'Desc 2',
          taskDescription: 'Task 2',
          agentSlug: 'tester',
          qualityMetrics: [],
        },
      ];

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'multi.json' as unknown as fs.Dirent,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(defs));

      const result = runner.loadBenchmarks('/tmp/benchmarks');

      expect(result).toHaveLength(2);
      expect(result[0].benchmarkId).toBe('b-1');
      expect(result[1].benchmarkId).toBe('b-2');
    });
  });

  // ----------------------------------------------------------------
  // evaluateMetrics — contains_expected
  // ----------------------------------------------------------------

  describe('evaluateMetrics - contains_expected', () => {
    it('passes when text contains expected string', () => {
      const metrics: QualityMetric[] = [
        { type: 'contains_expected', config: { expected: 'authentication' } },
      ];

      const results = runner.evaluateMetrics(
        'The authentication module handles login',
        metrics,
      );

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
      expect(results[0].type).toBe('contains_expected');
    });

    it('fails when text is missing expected string', () => {
      const metrics: QualityMetric[] = [
        { type: 'contains_expected', config: { expected: 'authentication' } },
      ];

      const results = runner.evaluateMetrics(
        'The module handles login',
        metrics,
      );

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // evaluateMetrics — length_range
  // ----------------------------------------------------------------

  describe('evaluateMetrics - length_range', () => {
    it('passes when output length is within range', () => {
      const metrics: QualityMetric[] = [
        { type: 'length_range', config: { min: 5, max: 100 } },
      ];

      const results = runner.evaluateMetrics('Hello, world!', metrics);

      expect(results[0].passed).toBe(true);
      expect(results[0].actual).toBe(13);
    });

    it('fails when output length is below minimum', () => {
      const metrics: QualityMetric[] = [
        { type: 'length_range', config: { min: 50, max: 100 } },
      ];

      const results = runner.evaluateMetrics('Short', metrics);

      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe(5);
    });

    it('fails when output length exceeds maximum', () => {
      const metrics: QualityMetric[] = [
        { type: 'length_range', config: { min: 1, max: 5 } },
      ];

      const results = runner.evaluateMetrics('This is too long', metrics);

      expect(results[0].passed).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // evaluateMetrics — no_hallucination
  // ----------------------------------------------------------------

  describe('evaluateMetrics - no_hallucination', () => {
    it('passes when no forbidden words found', () => {
      const metrics: QualityMetric[] = [
        {
          type: 'no_hallucination',
          config: { forbidden: ['quantum', 'blockchain'] },
        },
      ];

      const results = runner.evaluateMetrics(
        'The function returns a sorted array',
        metrics,
      );

      expect(results[0].passed).toBe(true);
      expect(results[0].actual).toBeNull();
    });

    it('fails when forbidden word is found', () => {
      const metrics: QualityMetric[] = [
        {
          type: 'no_hallucination',
          config: { forbidden: ['quantum', 'blockchain'] },
        },
      ];

      const results = runner.evaluateMetrics(
        'This uses quantum computing to sort',
        metrics,
      );

      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toContain('quantum');
    });

    it('performs case-insensitive forbidden word matching', () => {
      const metrics: QualityMetric[] = [
        {
          type: 'no_hallucination',
          config: { forbidden: ['Blockchain'] },
        },
      ];

      const results = runner.evaluateMetrics(
        'Using BLOCKCHAIN technology',
        metrics,
      );

      expect(results[0].passed).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // evaluateMetrics — json_valid
  // ----------------------------------------------------------------

  describe('evaluateMetrics - json_valid', () => {
    it('passes for valid JSON output', () => {
      const metrics: QualityMetric[] = [{ type: 'json_valid', config: {} }];

      const results = runner.evaluateMetrics(
        '{"name": "test", "value": 42}',
        metrics,
      );

      expect(results[0].passed).toBe(true);
      expect(results[0].type).toBe('json_valid');
    });

    it('fails for invalid JSON output', () => {
      const metrics: QualityMetric[] = [{ type: 'json_valid', config: {} }];

      const results = runner.evaluateMetrics(
        'not valid json {broken',
        metrics,
      );

      expect(results[0].passed).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // evaluateMetrics — custom_regex
  // ----------------------------------------------------------------

  describe('evaluateMetrics - custom_regex', () => {
    it('passes when output matches regex pattern', () => {
      const metrics: QualityMetric[] = [
        { type: 'custom_regex', config: { pattern: '^\\d{3}-\\d{4}$' } },
      ];

      const results = runner.evaluateMetrics('123-4567', metrics);

      expect(results[0].passed).toBe(true);
    });

    it('fails when output does not match regex pattern', () => {
      const metrics: QualityMetric[] = [
        { type: 'custom_regex', config: { pattern: '^\\d{3}-\\d{4}$' } },
      ];

      const results = runner.evaluateMetrics('abc-defg', metrics);

      expect(results[0].passed).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // runBenchmark
  // ----------------------------------------------------------------

  describe('runBenchmark', () => {
    const baseDef: BenchmarkDefinition = {
      benchmarkId: 'b-run-1',
      name: 'Run Test',
      description: 'Test run benchmark',
      taskDescription: 'Produce auth output',
      agentSlug: 'coder',
      qualityMetrics: [
        { type: 'contains_expected', config: { expected: 'auth' } },
        { type: 'length_range', config: { min: 5, max: 500 } },
      ],
    };

    it('returns passed=true when all metrics pass', () => {
      const result = runner.runBenchmark(
        baseDef,
        'The auth module is working properly',
      );

      expect(result.passed).toBe(true);
      expect(result.benchmarkId).toBe('b-run-1');
      expect(result.agentSlug).toBe('coder');
      expect(result.runId).toBe('test-uuid-1234');
      expect(result.metricResults).toHaveLength(2);
      expect(result.metricResults.every((m) => m.passed)).toBe(true);
    });

    it('returns passed=false when any metric fails', () => {
      const result = runner.runBenchmark(
        baseDef,
        'No matching content here but it is a long enough string',
      );

      expect(result.passed).toBe(false);
      // contains_expected should fail, length_range should pass
      const containsResult = result.metricResults.find(
        (m) => m.type === 'contains_expected',
      );
      const lengthResult = result.metricResults.find(
        (m) => m.type === 'length_range',
      );
      expect(containsResult?.passed).toBe(false);
      expect(lengthResult?.passed).toBe(true);
    });

    it('includes durationMs and runAt timestamp', () => {
      const result = runner.runBenchmark(baseDef, 'auth output');

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.runAt).toBeTruthy();
      // runAt should be a valid ISO date string
      expect(() => new Date(result.runAt)).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // Multiple metrics in single benchmark
  // ----------------------------------------------------------------

  describe('multiple metrics in single benchmark', () => {
    it('evaluates all metrics together', () => {
      const def: BenchmarkDefinition = {
        benchmarkId: 'b-multi',
        name: 'Multi Metric',
        description: 'Tests multiple metrics',
        taskDescription: 'Produce JSON with auth',
        agentSlug: 'coder',
        qualityMetrics: [
          { type: 'contains_expected', config: { expected: 'token' } },
          { type: 'length_range', config: { min: 10, max: 200 } },
          {
            type: 'no_hallucination',
            config: { forbidden: ['quantum'] },
          },
          { type: 'json_valid', config: {} },
        ],
      };

      const output = '{"token": "abc123", "valid": true}';
      const result = runner.runBenchmark(def, output);

      expect(result.metricResults).toHaveLength(4);
      expect(result.passed).toBe(true);
      expect(result.metricResults.every((m) => m.passed)).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // pinBaseline
  // ----------------------------------------------------------------

  describe('pinBaseline', () => {
    it('stores pass rate and avg duration', () => {
      const results: BenchmarkResult[] = [
        {
          benchmarkId: 'b-pin-1',
          runId: 'r1',
          agentSlug: 'coder',
          passed: true,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 100,
        },
        {
          benchmarkId: 'b-pin-1',
          runId: 'r2',
          agentSlug: 'coder',
          passed: true,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 200,
        },
        {
          benchmarkId: 'b-pin-1',
          runId: 'r3',
          agentSlug: 'coder',
          passed: false,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 300,
        },
      ];

      const baseline = runner.pinBaseline('b-pin-1', results);

      expect(baseline.passRate).toBeCloseTo(2 / 3);
      expect(baseline.avgDurationMs).toBe(200);
      expect(baseline.pinnedAt).toBeTruthy();
    });

    it('handles empty results with zero values', () => {
      const baseline = runner.pinBaseline('b-empty', []);

      expect(baseline.passRate).toBe(0);
      expect(baseline.avgDurationMs).toBe(0);
    });

    it('filters results by benchmarkId', () => {
      const results: BenchmarkResult[] = [
        {
          benchmarkId: 'b-target',
          runId: 'r1',
          agentSlug: 'coder',
          passed: true,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 50,
        },
        {
          benchmarkId: 'b-other',
          runId: 'r2',
          agentSlug: 'coder',
          passed: false,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 500,
        },
      ];

      const baseline = runner.pinBaseline('b-target', results);

      expect(baseline.passRate).toBe(1);
      expect(baseline.avgDurationMs).toBe(50);
    });
  });

  // ----------------------------------------------------------------
  // detectRegression
  // ----------------------------------------------------------------

  describe('detectRegression', () => {
    it('returns true when pass rate drops below baseline', () => {
      const baseline: BenchmarkBaseline = {
        pinnedAt: new Date().toISOString(),
        passRate: 1.0,
        avgDurationMs: 100,
      };

      const current: BenchmarkResult[] = [
        {
          benchmarkId: 'b-reg',
          runId: 'r1',
          agentSlug: 'coder',
          passed: true,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 100,
        },
        {
          benchmarkId: 'b-reg',
          runId: 'r2',
          agentSlug: 'coder',
          passed: false,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 100,
        },
      ];

      expect(runner.detectRegression(current, baseline)).toBe(true);
    });

    it('returns false when performance matches baseline', () => {
      const baseline: BenchmarkBaseline = {
        pinnedAt: new Date().toISOString(),
        passRate: 0.5,
        avgDurationMs: 100,
      };

      const current: BenchmarkResult[] = [
        {
          benchmarkId: 'b-reg',
          runId: 'r1',
          agentSlug: 'coder',
          passed: true,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 100,
        },
        {
          benchmarkId: 'b-reg',
          runId: 'r2',
          agentSlug: 'coder',
          passed: false,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 100,
        },
      ];

      expect(runner.detectRegression(current, baseline)).toBe(false);
    });

    it('returns false when performance exceeds baseline', () => {
      const baseline: BenchmarkBaseline = {
        pinnedAt: new Date().toISOString(),
        passRate: 0.5,
        avgDurationMs: 200,
      };

      const current: BenchmarkResult[] = [
        {
          benchmarkId: 'b-reg',
          runId: 'r1',
          agentSlug: 'coder',
          passed: true,
          metricResults: [],
          runAt: new Date().toISOString(),
          durationMs: 50,
        },
      ];

      expect(runner.detectRegression(current, baseline)).toBe(false);
    });

    it('returns false for empty current results', () => {
      const baseline: BenchmarkBaseline = {
        pinnedAt: new Date().toISOString(),
        passRate: 1.0,
        avgDurationMs: 100,
      };

      expect(runner.detectRegression([], baseline)).toBe(false);
    });
  });
});
