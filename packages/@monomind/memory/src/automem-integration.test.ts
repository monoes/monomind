/**
 * AutoMem Integration Tests
 *
 * Tests for the AutoMem learning loop components:
 * - LearningBridge proficiency metrics
 * - ScaffoldOptimizer gated revision
 * - MemoryDecisionCurator trace curation
 * - EpisodicStore memory op logging
 * - AutoMemoryBridge consult-before-write
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LearningBridge } from './learning-bridge.js';
import { ScaffoldOptimizer } from './scaffold-optimizer.js';
import { MemoryDecisionCurator } from './memory-decision-curator.js';
import { EpisodicStore } from './episodic-store.js';
import type { IMemoryBackend, MemoryEntry } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ===== Mock Backend =====

function createMockBackend(): IMemoryBackend & { storedEntries: MemoryEntry[] } {
  const storedEntries: MemoryEntry[] = [];

  return {
    storedEntries,
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockImplementation(async (entry: MemoryEntry) => {
      storedEntries.push(entry);
    }),
    get: vi.fn().mockResolvedValue(null),
    getByKey: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    bulkInsert: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockResolvedValue(0),
    listNamespaces: vi.fn().mockResolvedValue([]),
    clearNamespace: vi.fn().mockResolvedValue(0),
    getStats: vi.fn().mockResolvedValue({
      totalEntries: 0,
      entriesByNamespace: {},
      entriesByType: {},
      memoryUsage: 0,
      avgQueryTime: 0,
      avgSearchTime: 0,
    }),
    healthCheck: vi.fn().mockResolvedValue({
      status: 'healthy',
      components: { storage: 'healthy', index: 'healthy' },
    }),
  };
}

// ===== LearningBridge Proficiency Metrics =====

describe('LearningBridge proficiency metrics', () => {
  let bridge: LearningBridge;
  let backend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    backend = createMockBackend();
    bridge = new LearningBridge(backend, { enabled: true });
  });

  it('starts with zero counters', () => {
    const stats = bridge.getStats();
    expect(stats.memoryWrites).toBe(0);
    expect(stats.memorySearches).toBe(0);
    expect(stats.writeSearchRatio).toBe(0);
    expect(stats.redundantWrites).toBe(0);
    expect(stats.emptySearches).toBe(0);
  });

  it('tracks write counts', () => {
    bridge.recordMemoryWrite(false);
    bridge.recordMemoryWrite(false);
    bridge.recordMemoryWrite(true);

    const stats = bridge.getStats();
    expect(stats.memoryWrites).toBe(3);
    expect(stats.redundantWrites).toBe(1);
  });

  it('tracks search counts', () => {
    bridge.recordMemorySearch(false);
    bridge.recordMemorySearch(true);

    const stats = bridge.getStats();
    expect(stats.memorySearches).toBe(2);
    expect(stats.emptySearches).toBe(1);
  });

  it('computes write/search ratio', () => {
    bridge.recordMemoryWrite(false);
    bridge.recordMemoryWrite(false);
    bridge.recordMemorySearch(false);

    const stats = bridge.getStats();
    expect(stats.writeSearchRatio).toBe(2);
  });

  it('returns 0 ratio when no searches', () => {
    bridge.recordMemoryWrite(false);
    expect(bridge.getStats().writeSearchRatio).toBe(0);
  });
});

// ===== EpisodicStore Memory Op Logging =====

describe('EpisodicStore.logMemoryOp', () => {
  let store: EpisodicStore;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `automem-test-${Date.now()}.jsonl`);
    store = new EpisodicStore({ filePath: tmpFile, maxRunsPerEpisode: 20 });
  });

  it('ignores ops when no episode is open', () => {
    // Should not throw
    store.logMemoryOp('write', 'test detail');
    expect(store.hasOpenEpisode()).toBe(false);
  });

  it('logs ops into open episode content', async () => {
    await store.addRun('run-1', 'coder', 'feature', 'did stuff', 'session-1');

    store.logMemoryOp('write', 'stored auth pattern');
    store.logMemoryOp('search', 'looked up auth');
    store.logMemoryOp('skip-duplicate', 'auth already exists');

    const episode = await store.closeEpisode();
    expect(episode).not.toBeNull();
    expect(episode!.summary).toContain('[memory:write] stored auth pattern');
    expect(episode!.summary).toContain('[memory:search] looked up auth');
    expect(episode!.summary).toContain('[memory:skip-duplicate] auth already exists');
  });

  it('adds agent slug from memory op', async () => {
    await store.addRun('run-1', 'coder', 'feature', 'content', 'session-1');
    store.logMemoryOp('write', 'detail', 'memory-bridge');

    const episode = await store.closeEpisode();
    expect(episode!.agentSlugs).toContain('memory-bridge');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });
});

// ===== ScaffoldOptimizer =====

describe('ScaffoldOptimizer', () => {
  let optimizer: ScaffoldOptimizer;
  let backend: ReturnType<typeof createMockBackend>;
  let bridge: LearningBridge;
  let store: EpisodicStore;
  let tmpFile: string;

  beforeEach(() => {
    optimizer = new ScaffoldOptimizer({ minEpisodesToAnalyze: 2 });
    backend = createMockBackend();
    bridge = new LearningBridge(backend, { enabled: true });
    tmpFile = path.join(os.tmpdir(), `scaffold-test-${Date.now()}.jsonl`);
    store = new EpisodicStore({ filePath: tmpFile, maxRunsPerEpisode: 50 });
  });

  it('skips optimization when too few episodes', async () => {
    const result = await optimizer.optimize(store, bridge);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('proposes prune rule on high redundant write rate', async () => {
    // Create 3 episodes with many skip-duplicate ops
    for (let i = 0; i < 3; i++) {
      await store.addRun(`run-${i}`, 'coder', 'feature',
        '[memory:skip-duplicate] dup1\n[memory:skip-duplicate] dup2\n[memory:skip-duplicate] dup3\n[memory:write] real1',
        'session-1',
      );
      await store.closeEpisode();
    }

    const result = await optimizer.optimize(store, bridge);
    const pruneRevisions = result.accepted.filter(r => r.type === 'prune-rule');
    expect(pruneRevisions.length).toBeGreaterThanOrEqual(1);
    expect(pruneRevisions[0].description).toContain('redundant write');
  });

  it('tracks optimization count', async () => {
    // Need at least minEpisodesToAnalyze (2) closed episodes
    for (let i = 0; i < 3; i++) {
      await store.addRun(`run-${i}`, 'coder', 'feature', 'content', 'session-1');
      await store.closeEpisode();
    }

    await optimizer.optimize(store, bridge);
    expect(optimizer.getOptimizationCount()).toBe(1);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });
});

// ===== MemoryDecisionCurator =====

describe('MemoryDecisionCurator', () => {
  let curator: MemoryDecisionCurator;
  let backend: ReturnType<typeof createMockBackend>;
  let store: EpisodicStore;
  let tmpFile: string;

  beforeEach(() => {
    backend = createMockBackend();
    curator = new MemoryDecisionCurator(backend);
    tmpFile = path.join(os.tmpdir(), `curator-test-${Date.now()}.jsonl`);
    store = new EpisodicStore({ filePath: tmpFile, maxRunsPerEpisode: 50 });
  });

  it('returns empty result for no episodes', async () => {
    const result = await curator.curateFromEpisodes(store);
    expect(result.total).toBe(0);
    expect(result.curated).toBe(0);
  });

  it('curates write ops that were later read', async () => {
    await store.addRun('run-1', 'coder', 'feature',
      '[memory:write] stored auth pattern\n[memory:read] stored auth pattern\n[memory:search] auth query',
      'session-1',
    );
    await store.closeEpisode();

    const result = await curator.curateFromEpisodes(store);
    expect(result.total).toBe(3);
    expect(result.curated).toBeGreaterThanOrEqual(1);

    // Verify stored in backend
    expect(backend.store).toHaveBeenCalled();
    const stored = backend.storedEntries.filter(e => e.namespace === 'memory-training');
    expect(stored.length).toBeGreaterThanOrEqual(1);
    expect(stored[0].tags).toContain('curated');
  });

  it('does not leak writes across episode boundaries', async () => {
    // Episode 1: write "auth" but never read it
    await store.addRun('run-1', 'coder', 'feature',
      '[memory:write] stored auth pattern',
      'session-1',
    );
    await store.closeEpisode();

    // Episode 2: read "auth" — should NOT make episode 1's write "useful"
    await store.addRun('run-2', 'coder', 'feature',
      '[memory:read] stored auth pattern',
      'session-2',
    );
    await store.closeEpisode();

    const result = await curator.curateFromEpisodes(store);
    // Episode 1 write was never read within its episode → not useful
    // Episode 2 read is useful (successful session) → curated
    // Only the read from episode 2 should be curated, not the orphan write from episode 1
    const stored = backend.storedEntries.filter(e => e.namespace === 'memory-training');
    const writeEntries = stored.filter(e => e.content.startsWith('[write]'));
    expect(writeEntries).toHaveLength(0);
  });

  it('discards writes that were never read in failed sessions', async () => {
    await store.addRun('run-1', 'coder', 'failed',
      '[memory:write] wasted write',
      'session-1',
    );
    await store.closeEpisode();

    const result = await curator.curateFromEpisodes(store);
    // Write was never read AND session type is 'failed' → not useful → discarded
    expect(result.curated).toBe(0);
  });

  it('getCuratedDecisions returns stored entries', async () => {
    // Empty backend
    const decisions = await curator.getCuratedDecisions();
    expect(decisions).toHaveLength(0);
  });

  it('getStats returns counts by op type', async () => {
    const stats = await curator.getStats();
    expect(stats.total).toBe(0);
    expect(stats.byOp).toEqual({});
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });
});

// ===== AutoMemoryBridge + EpisodicStore Wiring =====

describe('AutoMemoryBridge.setEpisodicStore', () => {
  let backend: ReturnType<typeof createMockBackend>;
  let store: EpisodicStore;
  let tmpFile: string;

  beforeEach(() => {
    backend = createMockBackend();
    tmpFile = path.join(os.tmpdir(), `bridge-ep-test-${Date.now()}.jsonl`);
    store = new EpisodicStore({ filePath: tmpFile, maxRunsPerEpisode: 20 });
  });

  it('logs memory ops to episodic store on recordInsight', async () => {
    const { AutoMemoryBridge } = await import('./auto-memory-bridge.js');
    const bridge = new AutoMemoryBridge(backend, {
      workingDir: os.tmpdir(),
      memoryDir: path.join(os.tmpdir(), `automem-bridge-test-${Date.now()}`),
      syncMode: 'on-session-end',
    });

    bridge.setEpisodicStore(store);

    // Open an episode so logMemoryOp has somewhere to write
    await store.addRun('run-1', 'coder', 'feature', 'initial content', 'session-1');

    await bridge.recordInsight({
      category: 'debugging',
      summary: 'Test insight for episodic wiring',
      source: 'test',
      confidence: 0.9,
    });

    const episode = await store.closeEpisode();
    expect(episode).not.toBeNull();
    // Should have [memory:search] from consultBeforeWrite and [memory:write] from recordInsight
    const memLines = episode!.summary.split('\n').filter(l => l.startsWith('[memory:'));
    expect(memLines.length).toBeGreaterThanOrEqual(1);

    bridge.destroy();
    // Clean up memory dir
    try { fs.rmSync(bridge.getMemoryDir(), { recursive: true }); } catch { /* ignore */ }
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  });
});
