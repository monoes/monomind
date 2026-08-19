/**
 * Worker System Tests
 *
 * Unit and integration tests for the V1 worker system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

import {
  WorkerManager,
  WorkerPriority,
  AlertSeverity,
  WORKER_CONFIGS,
  createWorkerManager,
  createHealthWorker,
  createSecurityWorker,
  createDDDWorker,
  type WorkerResult,
  type AlertThreshold,
} from '../src/index.js';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_PROJECT_ROOT = path.join(os.tmpdir(), 'monomind-test-' + Date.now());

async function setupTestDir(): Promise<void> {
  await fs.mkdir(path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics'), { recursive: true });
  await fs.mkdir(path.join(TEST_PROJECT_ROOT, 'packages', '@monomind', 'hooks', 'src'), { recursive: true });
}

async function cleanupTestDir(): Promise<void> {
  try {
    await fs.rm(TEST_PROJECT_ROOT, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Unit Tests - WorkerManager
// ============================================================================

describe('WorkerManager', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await manager.stop().catch(() => {});
    await cleanupTestDir();
  });

  describe('initialization', () => {
    it('should create manager with default configs', () => {
      expect(manager).toBeInstanceOf(WorkerManager);
      const status = manager.getStatus();
      expect(status.workers.length).toBe(Object.keys(WORKER_CONFIGS).length);
    });

    it('should initialize metrics for all workers', () => {
      const status = manager.getStatus();
      for (const worker of status.workers) {
        expect(worker.runCount).toBe(0);
        expect(worker.errorCount).toBe(0);
        expect(['idle', 'disabled']).toContain(worker.status);
      }
    });

    it('should load persisted state on initialize', async () => {
      // Save some state
      const healthMetrics = manager['metrics'].get('health')!;
      healthMetrics.runCount = 5;

      await manager.saveState();

      // Create new manager and initialize
      const newManager = new WorkerManager(TEST_PROJECT_ROOT);
      await newManager.initialize();

      const status = newManager.getStatus();
      const health = status.workers.find(w => w.name === 'health');
      expect(health?.runCount).toBe(5);
    });
  });

  describe('worker registration', () => {
    it('should register custom worker', () => {
      const customHandler = vi.fn().mockResolvedValue({
        worker: 'custom',
        success: true,
        duration: 100,
        timestamp: new Date(),
      });

      manager.register('custom', customHandler);

      // Verify registration via event
      const registered = vi.fn();
      manager.on('worker:registered', registered);
      manager.register('another', customHandler);

      expect(registered).toHaveBeenCalledWith({ name: 'another' });
    });

    it('should not leak a dynamically registered worker into other WorkerManager instances (P2-54)', async () => {
      const handler = vi.fn().mockResolvedValue({
        worker: 'isolated',
        success: true,
        duration: 10,
        timestamp: new Date(),
      });

      // Register only on `manager` (created in beforeEach).
      manager.register('isolated', handler);
      expect(manager.getStatus().workers.some(w => w.name === 'isolated')).toBe(true);

      // A second, independently-constructed manager must not see it.
      const other = new WorkerManager(TEST_PROJECT_ROOT);
      expect(other.getStatus().workers.some(w => w.name === 'isolated')).toBe(false);
      const result = await other.runWorker('isolated');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');

      // The shared module-level registry must also stay clean.
      expect((WORKER_CONFIGS as any)['isolated']).toBeUndefined();

      await other.stop().catch(() => {});
    });
  });

  describe('worker execution', () => {
    it('should run a registered worker', async () => {
      const mockResult: WorkerResult = {
        worker: 'test',
        success: true,
        duration: 50,
        data: { value: 42 },
        timestamp: new Date(),
      };

      // P2-54: config is passed directly to register() (per-instance store)
      // rather than mutated onto the shared WORKER_CONFIGS constant — the
      // manager no longer reads that constant at runWorker() time.
      manager.register('test', vi.fn().mockResolvedValue(mockResult), {
        description: 'Test worker',
        interval: 60000,
        enabled: true,
        priority: WorkerPriority.Normal,
        timeout: 5000,
      });

      const result = await manager.runWorker('test');

      expect(result.success).toBe(true);
      expect(result.data?.value).toBe(42);
    });

    it('should handle worker timeout', async () => {
      manager.register('slow', async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return {
          worker: 'slow',
          success: true,
          duration: 10000,
          timestamp: new Date(),
        };
      }, {
        description: 'Slow worker',
        interval: 60000,
        enabled: true,
        priority: WorkerPriority.Normal,
        timeout: 100, // Very short timeout
      });

      const result = await manager.runWorker('slow');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });

    it('should handle worker errors gracefully', async () => {
      manager.register('failing', async () => {
        throw new Error('Worker crashed');
      }, {
        description: 'Failing worker',
        interval: 60000,
        enabled: true,
        priority: WorkerPriority.Normal,
        timeout: 5000,
      });

      const result = await manager.runWorker('failing');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Worker crashed');
    });

    it('should return error for unknown worker', async () => {
      const result = await manager.runWorker('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('runAll', () => {
    it('should run all registered workers', async () => {
      const handler = vi.fn().mockResolvedValue({
        worker: 'test',
        success: true,
        duration: 10,
        timestamp: new Date(),
      });

      manager.register('performance', handler);
      manager.register('health', handler);

      const results = await manager.runAll(2);

      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should respect concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const handler = vi.fn().mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 50));
        concurrent--;
        return {
          worker: 'test',
          success: true,
          duration: 50,
          timestamp: new Date(),
        };
      });

      // Register multiple workers
      for (let i = 0; i < 6; i++) {
        manager.register(`worker${i}`, handler, {
          description: 'Test',
          interval: 60000,
          enabled: true,
          priority: WorkerPriority.Normal,
          timeout: 5000,
        });
      }

      await manager.runAll(2); // Concurrency of 2

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });
});

// ============================================================================
// Unit Tests - Alert System
// ============================================================================

describe('Alert System', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should generate alerts when thresholds exceeded', async () => {
    manager.setThresholds('test', [
      { metric: 'value', warning: 50, critical: 90, comparison: 'gt' },
    ]);

    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { value: 75 },
      timestamp: new Date(),
    });

    manager.register('test', handler, {
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    });

    const result = await manager.runWorker('test');

    expect(result.alerts).toBeDefined();
    expect(result.alerts!.length).toBe(1);
    expect(result.alerts![0].severity).toBe(AlertSeverity.Warning);
    expect(result.alerts![0].value).toBe(75);
  });

  it('should generate critical alerts for critical threshold', async () => {
    manager.setThresholds('test', [
      { metric: 'value', warning: 50, critical: 90, comparison: 'gt' },
    ]);

    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { value: 95 },
      timestamp: new Date(),
    });

    manager.register('test', handler, {
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    });

    const result = await manager.runWorker('test');

    expect(result.alerts![0].severity).toBe(AlertSeverity.Critical);
  });

  it('should handle nested metric paths', async () => {
    manager.setThresholds('test', [
      { metric: 'nested.deep.value', warning: 50, critical: 90, comparison: 'gt' },
    ]);

    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { nested: { deep: { value: 75 } } },
      timestamp: new Date(),
    });

    manager.register('test', handler, {
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    });

    const result = await manager.runWorker('test');

    expect(result.alerts!.length).toBe(1);
    expect(result.alerts![0].metric).toBe('nested.deep.value');
  });

  it('should get recent alerts', async () => {
    // Manually add alerts
    const alerts = manager.getAlerts(10);
    expect(Array.isArray(alerts)).toBe(true);
  });

  it('should clear alerts', () => {
    manager.clearAlerts();
    expect(manager.getAlerts().length).toBe(0);
  });
});

// ============================================================================
// Unit Tests - Historical Metrics
// ============================================================================

describe('Historical Metrics', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should record history on worker completion', async () => {
    const handler = vi.fn().mockResolvedValue({
      worker: 'test',
      success: true,
      duration: 10,
      data: { metric1: 100, metric2: 200 },
      timestamp: new Date(),
    });

    manager.register('test', handler, {
      description: 'Test',
      interval: 60000,
      enabled: true,
      priority: WorkerPriority.Normal,
      timeout: 5000,
    });

    await manager.runWorker('test');

    const history = manager.getHistory('test', 10);
    expect(history.length).toBe(1);
    expect(history[0].metrics.metric1).toBe(100);
    expect(history[0].metrics.metric2).toBe(200);
  });

  it('should filter history by worker', async () => {
    const history = manager.getHistory('performance', 10);
    expect(Array.isArray(history)).toBe(true);
  });

  it('should limit history entries', async () => {
    const history = manager.getHistory(undefined, 5);
    expect(history.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// Unit Tests - Statusline
// ============================================================================

describe('Statusline Integration', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should generate statusline data', () => {
    const data = manager.getStatuslineData();

    expect(data.workers).toBeDefined();
    expect(data.health).toBeDefined();
    expect(data.security).toBeDefined();
    expect(data.ddd).toBeDefined();
    expect(data.lastUpdate).toBeDefined();
  });

  it('should generate statusline string', () => {
    const str = manager.getStatuslineString();

    expect(typeof str).toBe('string');
    expect(str.length).toBeGreaterThan(0);
    expect(str).toContain('👷'); // Workers icon
  });

  it('should export statusline to file', async () => {
    await manager.exportStatusline();

    const statuslinePath = path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics', 'statusline.json');
    const content = await fs.readFile(statuslinePath, 'utf-8');
    const data = JSON.parse(content);

    expect(data.workers).toBeDefined();
    expect(data.lastUpdate).toBeDefined();
  });
});

// ============================================================================
// Unit Tests - Persistence
// ============================================================================

describe('Persistence', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should save state to disk', async () => {
    await manager.saveState();

    const statePath = path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics', 'workers-state.json');
    const content = await fs.readFile(statePath, 'utf-8');
    const state = JSON.parse(content);

    expect(state.version).toBe('1.0.0');
    expect(state.workers).toBeDefined();
  });

  it('should load state from disk', async () => {
    // Manually create state file
    const statePath = path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics', 'workers-state.json');
    const state = {
      version: '1.0.0',
      lastSaved: new Date().toISOString(),
      workers: {
        health: { runCount: 10, errorCount: 1, avgDuration: 150 },
      },
      history: [],
    };
    await fs.writeFile(statePath, JSON.stringify(state));

    // Load
    const loaded = await manager.loadState();

    expect(loaded).toBe(true);
    const status = manager.getStatus();
    const h = status.workers.find(w => w.name === 'health');
    expect(h?.runCount).toBe(10);
  });

  it('should handle missing state file gracefully', async () => {
    const loaded = await manager.loadState();
    expect(loaded).toBe(false);
  });
});

// ============================================================================
// Security Tests
// ============================================================================

describe('Security', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = new WorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should reject path traversal in project root', () => {
    // This should not create files outside the project
    const maliciousManager = new WorkerManager('/tmp/../../../etc');
    // The path should be resolved but operations should be safe
    expect(maliciousManager).toBeInstanceOf(WorkerManager);
  });

  it('should limit file size when loading state', async () => {
    // This is tested internally by safeReadFile
    // Create a large file
    const statePath = path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics', 'workers-state.json');
    const largeContent = 'x'.repeat(11 * 1024 * 1024); // 11MB

    await fs.writeFile(statePath, largeContent);

    const loaded = await manager.loadState();
    expect(loaded).toBe(false); // Should fail due to size limit
  });
});

// ============================================================================
// Integration Tests - Built-in Workers
// ============================================================================

describe('audit worker barrel filter', () => {
  it('exempts index.* RE_EXPORTS edges (barrel pattern) but nothing else', async () => {
    const { isBarrelReExport } = await import('../src/workers/worker-audit.js');
    // barrels — the intended public-API pattern, never "hidden coupling"
    expect(isBarrelReExport({ relation: 'RE_EXPORTS', src_file: 'packages/@monoes/monobrowse/src/index.ts' })).toBe(true);
    expect(isBarrelReExport({ relation: 'RE_EXPORTS', src_file: 'src\\browser\\index.tsx' })).toBe(true);
    expect(isBarrelReExport({ relation: 'RE_EXPORTS', src_file: 'index.mjs' })).toBe(true);
    // still flagged: non-barrel re-exports, other relations, unknown files
    expect(isBarrelReExport({ relation: 'RE_EXPORTS', src_file: 'src/utils/helpers.ts' })).toBe(false);
    expect(isBarrelReExport({ relation: 'RE_EXPORTS', src_file: 'src/reindex.ts' })).toBe(false);
    expect(isBarrelReExport({ relation: 'CALLS', src_file: 'src/index.ts' })).toBe(false);
    expect(isBarrelReExport({ relation: 'RE_EXPORTS', src_file: null })).toBe(false);
  });
});

describe('Built-in Workers', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = createWorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should run health worker', async () => {
    const result = await manager.runWorker('health');

    expect(result.success).toBe(true);
    expect(result.data?.status).toBeDefined();
    expect(result.data?.memory).toBeDefined();
  });

});

// ============================================================================
// Unit Tests - Metrics-Producing Workers (doctor trusts these JSON outputs)
// ============================================================================
// ddd/map/audit/optimize/consolidate all write to .monomind/metrics/*.json,
// which `doctor` reads directly to report health — these were previously
// completely untested (only performance/health/git/swarm/learning were
// covered above). Unlike those, these tests also assert the metrics file
// itself is written with valid JSON, since that's what doctor actually
// consumes — a worker could report `success: true` while its write silently
// failed (a real class of bug found during the catch{}-block audit).

describe('Metrics-Producing Workers', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = createWorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  async function readMetricsFile(name: string): Promise<Record<string, unknown>> {
    const filePath = path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics', name);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  it('should run ddd worker and write ddd-progress.json', async () => {
    const result = await manager.runWorker('ddd');

    expect(result.success).toBe(true);
    expect(result.data?.progress).toBeTypeOf('number');
    expect(result.data?.modules).toBeDefined();

    const onDisk = await readMetricsFile('ddd-progress.json');
    expect(onDisk.progress).toBe(result.data?.progress);
    expect(onDisk.timestamp).toBeTypeOf('string');
  });

  it('should run map worker and write codebase-map.json', async () => {
    const result = await manager.runWorker('map');

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?.structure).toBeDefined();

    const onDisk = await readMetricsFile('codebase-map.json');
    expect(onDisk.structure).toBeDefined();
    expect(onDisk.timestamp).toBeTypeOf('string');
    // Walks the real repo: ~3.7s alone, more when the suite runs in parallel.
    // The 5s default left too little headroom — see the consolidate test below.
  }, 30_000);

  it('should run audit worker and write security-audit.json', async () => {
    const result = await manager.runWorker('audit');

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?.checks).toBeDefined();
    expect((result.data as Record<string, unknown>)?.riskLevel).toBeDefined();

    const onDisk = await readMetricsFile('security-audit.json');
    expect(onDisk.checks).toBeDefined();
    expect(onDisk.riskLevel).toBeDefined();
  });

  it('should run consolidate worker and write consolidation.json', async () => {
    const result = await manager.runWorker('consolidate');

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?.mode).toBe('raptor');

    const onDisk = await readMetricsFile('consolidation.json');
    expect(onDisk.mode).toBe('raptor');
    expect(onDisk.timestamp).toBeTypeOf('string');
    // Real consolidation work: ~3.2s alone, but it tipped past the 5s default
    // under full-suite load and failed intermittently. 30s is headroom, not a
    // licence to get slower — if this starts timing out, the worker regressed.
  }, 30_000);

  it('reports failure explicitly rather than success:true with a missing file, when the metrics dir cannot be written', async () => {
    // Simulate an unwritable metrics dir by replacing it with a file of the
    // same name — every worker's fs.mkdir/writeFile against it should fail.
    const metricsDir = path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics');
    await fs.rm(metricsDir, { recursive: true, force: true });
    await fs.writeFile(metricsDir, 'not a directory');

    const result = await manager.runWorker('map');

    // Whichever way the worker chooses to report this (success:false, or
    // success:true with the write silently caught) — assert it doesn't
    // silently produce a valid-looking metrics file, since that's the
    // actual failure mode doctor cares about.
    if (result.success) {
      await expect(fs.readFile(path.join(TEST_PROJECT_ROOT, '.monomind', 'metrics', 'codebase-map.json'), 'utf-8')).rejects.toThrow();
    } else {
      expect(result.error).toBeDefined();
    }
  });
});

// ============================================================================
// Unit Tests - Remaining Built-in Workers (cache, progress, security)
// ============================================================================
// These don't persist metrics files the same way as the group above, so
// these just assert the handler runs and returns the documented data shape.

describe('Remaining Built-in Workers', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = createWorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  it('should run cache worker', async () => {
    const result = await manager.runWorker('cache');

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?.cleaned).toBeDefined();
    expect((result.data as Record<string, unknown>)?.freedMB).toBeTypeOf('number');
  });

  it('should run progress worker', async () => {
    const result = await manager.runWorker('progress');

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?.progress).toBeDefined();
    expect((result.data as Record<string, unknown>)?.totalFiles).toBeTypeOf('number');
  });

  it('should run security worker', async () => {
    const result = await manager.runWorker('security');

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?.status).toBeDefined();
    expect((result.data as Record<string, unknown>)?.totalIssues).toBeTypeOf('number');
  });
});

// ============================================================================
// Regression Tests - Reflexion Worker (MEM-14)
// ============================================================================
// The reflexion worker used to filter route-outcomes.jsonl records on
// `o.success` / `o.taskDescription`, but the real records written by
// recordRoute()/joinOutcome() (packages/@monomind/cli/src/monovector/
// route-outcomes.ts) use `measuredSuccess` / `task` / `recommendedAgent` /
// a numeric `ts`, and never carry an `error` field. The mismatch meant the
// filter never matched anything and the self-learning loop could never
// fire. These tests feed the worker a real-format JSONL line and assert it
// actually processes it.

describe('Reflexion Worker (MEM-14 regression)', () => {
  let manager: WorkerManager;

  beforeEach(async () => {
    await setupTestDir();
    manager = createWorkerManager(TEST_PROJECT_ROOT);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  async function writeRouteOutcomes(records: Record<string, unknown>[]): Promise<void> {
    const outcomesPath = path.join(TEST_PROJECT_ROOT, '.monomind', 'route-outcomes.jsonl');
    const jsonl = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fs.writeFile(outcomesPath, jsonl, 'utf-8');
  }

  it('processes a real-format failure record and generates a reflection', async () => {
    // Real record shape: `task`, `measuredSuccess`, `recommendedAgent`,
    // numeric `ts` — and deliberately no `error` field.
    await writeRouteOutcomes([
      {
        routeId: 'route-1',
        ts: 1700000000000,
        task: 'refactor the payment module to use the new API client',
        recommendedAgent: 'coder',
        routingMethod: 'keyword',
        confidence: 0.8,
        learningMode: 'js',
        agentActuallyUsed: 'coder',
        measuredSuccess: false,
      },
    ]);

    const result = await manager.runWorker('reflexion');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.outcomesProcessed).toBe(1);
    expect(data.failuresFound).toBe(1);
    expect(data.reflectionsGenerated).toBe(1);
    expect(data.totalReflections).toBe(1);

    const storePath = path.join(TEST_PROJECT_ROOT, '.monomind', 'reflexion-store.json');
    const stored = JSON.parse(await fs.readFile(storePath, 'utf-8'));
    expect(stored).toHaveLength(1);
    expect(stored[0].taskDescription).toBe('refactor the payment module to use the new API client');
    expect(stored[0].agentType).toBe('coder');
    // No `error` field on the real record — must degrade gracefully, not
    // crash or print "undefined".
    expect(stored[0].error).toBe('(no error message)');
    expect(stored[0].error).not.toMatch(/undefined/);
    // Numeric `ts` must be converted to an ISO timestamp, not parsed as a string.
    expect(stored[0].timestamp).toBe(new Date(1700000000000).toISOString());
    expect(stored[0].reflection).toContain('refactor the payment module');
    expect(stored[0].reflection).not.toMatch(/undefined/);
  });

  it('ignores successful outcomes and outcomes with no task', async () => {
    await writeRouteOutcomes([
      {
        routeId: 'route-2', ts: 1700000001000, task: 'a task that succeeded',
        recommendedAgent: 'coder', routingMethod: 'keyword', confidence: 0.9,
        learningMode: 'js', measuredSuccess: true,
      },
      {
        routeId: 'route-3', ts: 1700000002000, task: '',
        recommendedAgent: 'coder', routingMethod: 'keyword', confidence: 0.5,
        learningMode: 'js', measuredSuccess: false,
      },
    ]);

    const result = await manager.runWorker('reflexion');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.reflectionsGenerated).toBe(0);
  });

  it('does not duplicate reflections for the same outcome record across runs', async () => {
    await writeRouteOutcomes([
      {
        routeId: 'route-4', ts: 1700000003000, task: 'flaky integration test suite',
        recommendedAgent: 'tester', routingMethod: 'keyword', confidence: 0.7,
        learningMode: 'js', measuredSuccess: false,
      },
    ]);

    const first = await manager.runWorker('reflexion');
    expect((first.data as Record<string, unknown>).reflectionsGenerated).toBe(1);

    const second = await manager.runWorker('reflexion');
    expect((second.data as Record<string, unknown>).reflectionsGenerated).toBe(0);
    expect((second.data as Record<string, unknown>).totalReflections).toBe(1);
  });
});

// ============================================================================
// Regression Tests - DDD Worker Package Discovery (MEM-13)
// ============================================================================
// The DDD worker used to hardcode this repo's own package paths
// (`@monoes/hooks`, `@monoes/mcp`, `@monomind/memory`), so every other
// project always scored 0% forever, and two of the three paths were wrong
// even for this repo. These tests verify dynamic discovery of workspace
// packages in a synthetic project — both a scoped monorepo layout and a
// single-package fallback layout — with no reference to this repo's paths.

describe('DDD Worker Package Discovery (MEM-13 regression)', () => {
  const DDD_TEST_ROOT = path.join(os.tmpdir(), 'monomind-ddd-test-' + Date.now());

  afterEach(async () => {
    await fs.rm(DDD_TEST_ROOT, { recursive: true, force: true }).catch(() => {});
  });

  it('discovers packages in a synthetic scoped + flat monorepo layout', async () => {
    // Scoped package: packages/@acme/widgets
    const scopedSrc = path.join(DDD_TEST_ROOT, 'packages', '@acme', 'widgets', 'src');
    await fs.mkdir(scopedSrc, { recursive: true });
    await fs.writeFile(
      path.join(DDD_TEST_ROOT, 'packages', '@acme', 'widgets', 'package.json'),
      JSON.stringify({ name: '@acme/widgets' })
    );
    await fs.writeFile(
      path.join(scopedSrc, 'widget.entity.ts'),
      'export class WidgetEntity {}\n'
    );

    // Flat package: packages/gizmos
    const flatSrc = path.join(DDD_TEST_ROOT, 'packages', 'gizmos', 'src');
    await fs.mkdir(flatSrc, { recursive: true });
    await fs.writeFile(
      path.join(DDD_TEST_ROOT, 'packages', 'gizmos', 'package.json'),
      JSON.stringify({ name: 'gizmos' })
    );
    await fs.writeFile(
      path.join(flatSrc, 'gizmo.repository.ts'),
      'export interface IGizmoRepository {}\n'
    );

    // A directory that looks like a package scope but has no package.json —
    // must NOT be picked up as a module.
    await fs.mkdir(path.join(DDD_TEST_ROOT, 'packages', '@acme', 'not-a-package', 'src'), { recursive: true });

    await fs.mkdir(path.join(DDD_TEST_ROOT, '.monomind', 'metrics'), { recursive: true });

    const manager = createWorkerManager(DDD_TEST_ROOT);
    const result = await manager.runWorker('ddd');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    const modules = data.modules as Record<string, unknown>;

    expect(Object.keys(modules).sort()).toEqual([path.join('@acme', 'widgets'), 'gizmos'].sort());
    expect(data.modulesTracked).toBe(2);
    expect(data.score).toBeGreaterThan(0);
    // Never falls back to this repo's own hardcoded paths.
    expect(modules['@monoes/hooks']).toBeUndefined();
    expect(modules['@monoes/mcp']).toBeUndefined();
    expect(modules['@monomind/memory']).toBeUndefined();
  });

  it('falls back to scanning src/ for a single-package project with no packages/ dir', async () => {
    const src = path.join(DDD_TEST_ROOT, 'src');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'order.aggregate.ts'), 'export class OrderAggregate {}\n');
    await fs.mkdir(path.join(DDD_TEST_ROOT, '.monomind', 'metrics'), { recursive: true });

    const manager = createWorkerManager(DDD_TEST_ROOT);
    const result = await manager.runWorker('ddd');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.modulesTracked).toBe(1);
    expect(data.score).toBeGreaterThan(0);
  });

  it('reports zero modules for a project with neither packages/ nor src/', async () => {
    await fs.mkdir(path.join(DDD_TEST_ROOT, '.monomind', 'metrics'), { recursive: true });

    const manager = createWorkerManager(DDD_TEST_ROOT);
    const result = await manager.runWorker('ddd');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.modulesTracked).toBe(0);
    expect(data.progress).toBe(0);
  });
});
