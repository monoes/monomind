/**
 * Performance MCP Tools — on-disk metrics/benchmark store.
 * Extracted from performance-tools.ts.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from './types.js';

// Storage paths
const STORAGE_DIR = '.monomind';
const PERF_DIR = 'performance';
const METRICS_FILE = 'metrics.json';

export interface PerfMetrics {
  timestamp: string;
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; heap: number };
  // No real latency/throughput instrumentation feeds this store — these are
  // only populated when genuinely measured (never today), so they must stay
  // nullable rather than seeded with made-up numbers on first run.
  latency: { avg: number; p50: number; p95: number; p99: number } | null;
  throughput: { requests: number; operations: number } | null;
  errors: { count: number; rate: number };
}

export interface Benchmark {
  id: string;
  name: string;
  type: string;
  results: {
    duration: number;
    iterations: number;
    opsPerSecond: number;
    memory: number;
  };
  createdAt: string;
}

export interface PerfStore {
  metrics: PerfMetrics[];
  benchmarks: Record<string, Benchmark>;
  version: string;
}

export function getPerfDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, PERF_DIR);
}

export function getPerfPath(): string {
  return join(getPerfDir(), METRICS_FILE);
}

export function ensurePerfDir(): void {
  const dir = getPerfDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const MAX_PERF_STORE_BYTES = 50 * 1024 * 1024; // 50 MB

// Bumped from 3.0.0: pre-3.1.0 stores may contain `metrics` entries whose
// latency/throughput fields were fabricated on first run (50/40/100/200ms,
// +1/+10 ops) and then compounded into "history" averages on every
// subsequent call. Those fields are dropped on load so old fake data can't
// keep poisoning stats — cpu/memory history (which was always real) is kept.
const PERF_STORE_VERSION = '3.1.0';

export function loadPerfStore(): PerfStore {
  try {
    const path = getPerfPath();
    if (existsSync(path) && statSync(path).size <= MAX_PERF_STORE_BYTES) {
      const store = JSON.parse(readFileSync(path, 'utf-8')) as PerfStore;
      if (store.version !== PERF_STORE_VERSION) {
        store.metrics = (store.metrics || []).map((m) => ({
          ...m,
          latency: null,
          throughput: null,
        }));
        store.version = PERF_STORE_VERSION;
      }
      return store;
    }
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[performance-tools] failed to load perf store, using empty store:', e);
  }
  return { metrics: [], benchmarks: {}, version: PERF_STORE_VERSION };
}

export function savePerfStore(store: PerfStore): void {
  ensurePerfDir();
  const dest = getPerfPath();
  const tmpPath = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmpPath, dest);
}
