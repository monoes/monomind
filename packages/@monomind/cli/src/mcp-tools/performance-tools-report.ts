/**
 * Performance MCP Tools — report and bottleneck detection.
 * Extracted from performance-tools.ts.
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  type Benchmark,
  ensurePerfDir,
  getPerfDir,
  loadPerfStore,
  type PerfMetrics,
  savePerfStore,
} from './performance-tools-store.js';
import type { MCPTool } from './types.js';

export const performanceReportTools: MCPTool[] = [
  {
    name: 'performance_report',
    description: 'Generate performance report',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        timeRange: { type: 'string', description: 'Time range (1h, 24h, 7d)' },
        format: {
          type: 'string',
          enum: ['json', 'summary', 'detailed'],
          description: 'Report format',
        },
        components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Components to include',
        },
      },
    },
    handler: async (input) => {
      const store = loadPerfStore();
      const format = (input.format as string) || 'summary';

      // Get REAL system metrics via Node.js APIs
      const memUsage = process.memoryUsage();
      const loadAvg = os.loadavg();
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();

      // Calculate real CPU usage percentage from load average
      const cpuPercent = (loadAvg[0] / cpus.length) * 100;

      // Generate current metrics with REAL values
      const currentMetrics: PerfMetrics = {
        timestamp: new Date().toISOString(),
        cpu: { usage: Math.min(cpuPercent, 100), cores: cpus.length },
        memory: {
          used: Math.round((totalMem - freeMem) / 1024 / 1024),
          total: Math.round(totalMem / 1024 / 1024),
          heap: Math.round(memUsage.heapUsed / 1024 / 1024),
        },
        // No real latency/throughput instrumentation exists anywhere in this
        // tool — do not seed fake numbers. Report null with a note instead.
        latency: null,
        throughput: null,
        errors: { count: 0, rate: 0 },
      };

      store.metrics.push(currentMetrics);
      // Keep last 100 metrics
      if (store.metrics.length > 100) {
        store.metrics = store.metrics.slice(-100);
      }
      savePerfStore(store);

      if (format === 'summary') {
        return {
          status: 'healthy',
          cpu: { value: `${currentMetrics.cpu.usage.toFixed(1)}%`, _real: true },
          memory: {
            value: `${currentMetrics.memory.used}MB / ${currentMetrics.memory.total}MB`,
            _real: true,
          },
          heap: { value: `${currentMetrics.memory.heap}MB`, _real: true },
          latency: {
            value: null,
            _real: false,
            _note: 'No latency telemetry recorded yet — no instrumentation wired up here.',
          },
          throughput: {
            value: null,
            _real: false,
            _note: 'No throughput telemetry recorded yet — no instrumentation wired up here.',
          },
          errorRate: {
            value: `${(currentMetrics.errors.rate * 100).toFixed(2)}%`,
            _real: false,
            _note: 'No error tracking wired up — always 0.',
          },
          timestamp: currentMetrics.timestamp,
        };
      }

      // Calculate trends from history
      const history = store.metrics.slice(-10);
      const cpuTrend =
        history.length >= 2
          ? history[history.length - 1].cpu.usage > history[0].cpu.usage
            ? 'increasing'
            : 'stable'
          : 'stable';
      const memTrend =
        history.length >= 2
          ? history[history.length - 1].memory.used > history[0].memory.used
            ? 'increasing'
            : 'stable'
          : 'stable';

      return {
        current: currentMetrics,
        _real: { cpu: true, memory: true, latency: false, throughput: false, errors: false },
        history,
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          cpuModel: cpus[0]?.model,
          loadAverage: loadAvg,
        },
        trends: {
          cpu: cpuTrend,
          memory: memTrend,
          latency: {
            value: 'unknown',
            _note: 'No latency telemetry recorded — trend cannot be computed.',
          },
        },
        // Rule-based thresholds on real cpu/memory readings — not an ML model.
        _recommendationEngine: 'rule-based (static thresholds on real cpu/memory readings)',
        recommendations:
          currentMetrics.memory.used / currentMetrics.memory.total > 0.8
            ? [{ priority: 'high', message: 'Memory usage above 80% - consider cleanup' }]
            : currentMetrics.cpu.usage > 70
              ? [
                  {
                    priority: 'medium',
                    message: 'CPU load elevated - check for resource-intensive processes',
                  },
                ]
              : [{ priority: 'low', message: 'System running normally' }],
      };
    },
  },
  {
    name: 'performance_bottleneck',
    description: 'Detect performance bottlenecks',
    category: 'performance',
    inputSchema: {
      type: 'object',
      properties: {
        component: { type: 'string', description: 'Component to analyze' },
        threshold: { type: 'number', description: 'Alert threshold' },
        deep: { type: 'boolean', description: 'Deep analysis' },
      },
    },
    handler: async (_input) => {
      const loadAvg = os.loadavg();
      const cpus = os.cpus();
      const cpuPercent = Math.min((loadAvg[0] / cpus.length) * 100, 100);

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memPercent = ((totalMem - freeMem) / totalMem) * 100;
      const memUsage = process.memoryUsage();
      const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Measure disk I/O latency with a real write/read cycle
      let diskLatencyMs = -1;
      try {
        ensurePerfDir();
        const probeFile = join(getPerfDir(), '.io-probe');
        const payload = Buffer.alloc(4096, 0x41); // 4 KB
        const t0 = performance.now();
        writeFileSync(probeFile, payload);
        readFileSync(probeFile);
        diskLatencyMs = Math.round((performance.now() - t0) * 100) / 100;
        try {
          unlinkSync(probeFile);
        } catch {
          /* best-effort */
        }
      } catch {
        /* disk probe failed, leave -1 */
      }

      // Check stored benchmark history for slow operations
      const store = loadPerfStore();
      const slowBenchmarks = Object.values(store.benchmarks)
        .filter((b: Benchmark) => b.results.opsPerSecond < 100)
        .map((b: Benchmark) => ({
          name: b.name,
          opsPerSec: b.results.opsPerSecond,
          date: b.createdAt,
        }));

      type Severity = 'critical' | 'high' | 'medium' | 'low';
      const classify = (value: number, thresholds: [number, number, number]): Severity =>
        value > thresholds[0]
          ? 'critical'
          : value > thresholds[1]
            ? 'high'
            : value > thresholds[2]
              ? 'medium'
              : 'low';

      const bottlenecks: Array<{
        component: string;
        severity: Severity;
        value: number;
        threshold: number;
        message: string;
        latencyMs?: number;
      }> = [];

      const cpuSev = classify(cpuPercent, [90, 75, 50]);
      bottlenecks.push({
        component: 'cpu',
        severity: cpuSev,
        value: Math.round(cpuPercent * 10) / 10,
        threshold: cpuSev === 'critical' ? 90 : cpuSev === 'high' ? 75 : 50,
        message: `CPU load at ${Math.round(cpuPercent * 10) / 10}%`,
      });

      const memSev = classify(memPercent, [90, 75, 50]);
      bottlenecks.push({
        component: 'memory',
        severity: memSev,
        value: Math.round(memPercent * 10) / 10,
        threshold: memSev === 'critical' ? 90 : memSev === 'high' ? 75 : 50,
        message: `Memory at ${Math.round(memPercent * 10) / 10}%`,
      });

      if (diskLatencyMs >= 0) {
        const diskSev: Severity =
          diskLatencyMs > 50
            ? 'critical'
            : diskLatencyMs > 20
              ? 'high'
              : diskLatencyMs > 5
                ? 'medium'
                : 'low';
        bottlenecks.push({
          component: 'disk-io',
          severity: diskSev,
          value: diskLatencyMs,
          threshold: diskSev === 'critical' ? 50 : diskSev === 'high' ? 20 : 5,
          message: `Disk I/O latency ${diskLatencyMs}ms`,
          latencyMs: diskLatencyMs,
        });
      }

      if (slowBenchmarks.length > 0) {
        bottlenecks.push({
          component: 'slow-operations',
          severity: 'medium',
          value: slowBenchmarks.length,
          threshold: 0,
          message: `${slowBenchmarks.length} slow benchmark(s) recorded`,
        });
      }

      return {
        success: true,
        _real: true,
        bottlenecks,
        system: {
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          memoryPercent: Math.round(memPercent * 10) / 10,
          heapMB,
          diskLatencyMs,
        },
        slowBenchmarks: slowBenchmarks.slice(0, 5),
      };
    },
  },
];
