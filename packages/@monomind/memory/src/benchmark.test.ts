import { describe, it, expect, vi } from 'vitest';
import { MemoryGraph } from './memory-graph.js';
import { createDefaultEntry, type IMemoryBackend, type MemoryEntry } from './types.js';

function createMockBackend(entries: MemoryEntry[] = []): IMemoryBackend {
  const stored = new Map<string, MemoryEntry>();
  entries.forEach(e => stored.set(e.id, e));
  return {
    initialize: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    store: vi.fn(async (e: MemoryEntry) => { stored.set(e.id, e); }),
    get: vi.fn(async (id: string) => stored.get(id) ?? null),
    getByKey: vi.fn(async () => null),
    update: vi.fn(async (id: string, u: any) => { const e = stored.get(id); if (e) { Object.assign(e.metadata, u.metadata || {}); return e; } return null; }),
    delete: vi.fn(async (id: string) => stored.delete(id)),
    query: vi.fn(async () => [...stored.values()]),
    search: vi.fn(async () => []),
    bulkInsert: vi.fn(async (es: MemoryEntry[]) => es.forEach(e => stored.set(e.id, e))),
    bulkDelete: vi.fn(async (ids: string[]) => { ids.forEach(id => stored.delete(id)); return ids.length; }),
    count: vi.fn(async () => stored.size),
    listNamespaces: vi.fn(async () => ['default']),
    clearNamespace: vi.fn(async () => 0),
    getStats: vi.fn(async () => ({ totalEntries: stored.size, entriesByNamespace: {}, entriesByType: { semantic: 0, episodic: 0, working: 0, cache: 0 } as Record<string, number>, memoryUsage: 0, avgQueryTime: 0, avgSearchTime: 0 })),
    healthCheck: vi.fn(async () => ({ status: 'healthy' as const, components: { storage: { status: 'healthy' as const, latency: 0 }, index: { status: 'healthy' as const, latency: 0 }, cache: { status: 'healthy' as const, latency: 0 } }, timestamp: Date.now(), issues: [], recommendations: [] })),
  };
}

function makeEntry(id: string, refs: string[] = []): MemoryEntry {
  return { ...createDefaultEntry({ key: id, content: `Content for ${id}`, references: refs, metadata: { confidence: 0.7 + Math.random() * 0.3 } }), id };
}

describe('ADR-049 Performance Benchmarks', () => {
  const targets: Array<{name: string; actual: number; target: number; unit: string}> = [];

  function buildGraphEntries(n: number): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    for (let i = 0; i < n; i++) {
      const refs: string[] = [];
      for (let j = 0; j < 3; j++) {
        const r = Math.floor(Math.random() * n);
        if (r !== i) refs.push(`entry-${r}`);
      }
      entries.push(makeEntry(`entry-${i}`, refs));
    }
    return entries;
  }

  function buildGraph(entries: MemoryEntry[], maxNodes: number): MemoryGraph {
    const g = new MemoryGraph({ maxNodes });
    for (const e of entries) g.addNode(e);
    for (const e of entries) {
      for (const r of e.references) g.addEdge(e.id, r, 'reference');
    }
    return g;
  }

  it('MemoryGraph: build 100 nodes', () => {
    const entries = buildGraphEntries(100);
    const t0 = performance.now();
    buildGraph(entries, 200);
    const dt = performance.now() - t0;
    console.log(`  Graph build (100):  ${dt.toFixed(2)}ms`);
    expect(dt).toBeLessThan(50);
  });

  it('MemoryGraph: build 1000 nodes', () => {
    const entries = buildGraphEntries(1000);
    const t0 = performance.now();
    buildGraph(entries, 1100);
    const dt = performance.now() - t0;
    console.log(`  Graph build (1k):   ${dt.toFixed(2)}ms  [target: <200ms]`);
    targets.push({ name: 'Graph build (1k nodes)', actual: dt, target: 200, unit: 'ms' });
    expect(dt).toBeLessThan(200);
  });

  it('MemoryGraph: build 2000 nodes', () => {
    const entries = buildGraphEntries(2000);
    const t0 = performance.now();
    buildGraph(entries, 2100);
    const dt = performance.now() - t0;
    console.log(`  Graph build (2k):   ${dt.toFixed(2)}ms`);
    expect(dt).toBeLessThan(500);
  });

  it('MemoryGraph: PageRank 1000 nodes', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    const t0 = performance.now();
    g.computePageRank();
    const dt = performance.now() - t0;
    console.log(`  PageRank (1k):      ${dt.toFixed(2)}ms  [target: <100ms]`);
    targets.push({ name: 'PageRank (1k nodes)', actual: dt, target: 100, unit: 'ms' });
    expect(dt).toBeLessThan(100);
  });

  it('MemoryGraph: PageRank 2000 nodes', () => {
    const entries = buildGraphEntries(2000);
    const g = buildGraph(entries, 2100);
    const t0 = performance.now();
    g.computePageRank();
    const dt = performance.now() - t0;
    console.log(`  PageRank (2k):      ${dt.toFixed(2)}ms`);
    expect(dt).toBeLessThan(300);
  });

  it('MemoryGraph: community detection 1000 nodes', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    g.computePageRank();
    const t0 = performance.now();
    g.detectCommunities();
    const dt = performance.now() - t0;
    const stats = g.getStats();
    console.log(`  Communities (1k):   ${dt.toFixed(2)}ms  (${stats.communityCount} found)`);
    expect(dt).toBeLessThan(200);
  });

  it('MemoryGraph: rankWithGraph 10 results', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    g.computePageRank();
    const fakeResults = entries.slice(0, 10).map(e => ({ entry: e, score: Math.random(), distance: Math.random() }));
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) g.rankWithGraph(fakeResults);
    const dt = (performance.now() - t0) / 100;
    console.log(`  rankWithGraph(10):  ${dt.toFixed(3)}ms  (avg of 100 runs)`);
    expect(dt).toBeLessThan(1);
  });

  it('MemoryGraph: getTopNodes(20)', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    g.computePageRank();
    g.detectCommunities();
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) g.getTopNodes(20);
    const dt = (performance.now() - t0) / 100;
    console.log(`  getTopNodes(20):    ${dt.toFixed(3)}ms  (avg of 100 runs)`);
    expect(dt).toBeLessThan(5);
  });

  it('MemoryGraph: getNeighbors depth=2', () => {
    const entries = buildGraphEntries(1000);
    const g = buildGraph(entries, 1100);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) g.getNeighbors(entries[i % entries.length].id, 2);
    const dt = (performance.now() - t0) / 100;
    console.log(`  getNeighbors(d=2):  ${dt.toFixed(3)}ms  (avg of 100 runs)`);
    expect(dt).toBeLessThan(5);
  });

  it('SUMMARY: all targets met', () => {
    console.log('\n=== ADR-049 Performance Summary ===\n');
    for (const t of targets) {
      const pass = t.actual <= t.target;
      const ratio = (t.target / t.actual).toFixed(1);
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${t.name.padEnd(28)} ${t.actual.toFixed(2).padStart(8)} ${t.unit.padEnd(8)}  target: <${t.target}${t.unit}  (${ratio}x headroom)`);
    }
    console.log('');
    const allPass = targets.every(t => t.actual <= t.target);
    expect(allPass).toBe(true);
  });
});
