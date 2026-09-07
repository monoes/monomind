/**
 * Derived index: adjacency + origin-support, rebuild, and dual-write (K7,
 * memory-KG next-steps handoff 2026-09-07, stage 3).
 *
 * This is the MEMORY knowledge graph (entities/relations/rules on the memory
 * bridge), not the Monograph code graph.
 *
 * `kgRebuildIndex` builds `kg:adj`/`kg:origin-idx` from a full canonical scan
 * and only flips a scope to `ready` after validating the result against an
 * independent reference read. Once `ready`, `kgSearch`'s edge gathering and
 * `kgRollback`'s origin scan use the index; `kgIngest`/`kgIngestRules`/
 * `kgRollback` keep it current via best-effort dual-write hooks that
 * downgrade the scope to `failed` (never silently drift) on any write
 * failure.
 *
 * Covers:
 *  - a scope with no index (`absent`) behaves exactly as before K7
 *  - `kgRebuildIndex` reaches `ready` with correct counts on a small graph
 *  - `kgSearch` and `kgRollback` produce IDENTICAL results whether the index
 *    is used or not (the equivalence property K7 exists to prove)
 *  - dual-write freshness: an ingest/rollback after `ready` is immediately
 *    reflected through the index, with no second rebuild
 *  - resumability: a rebuild that left `building` with a checkpointed cursor
 *    resumes from there instead of rescanning finished phases
 *
 * The fake bridge enforces the real backend's CAS (`ifVersion`) and
 * namespace/offset paging contract, same discipline as
 * memory-kg-atomic-merge.test.ts and memory-kg-provenance.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  version: number;
}

const store = new Map<string, Map<string, FakeEntry>>();
let idSeq = 0;
const listCalls: { namespace: string; limit?: number; offset?: number }[] = [];
/** When set, every `bridgeListEntries` call past this many total calls
 *  returns null — simulating the backend going unavailable mid-scan. */
let failListAfterCalls: number | null = null;
let listCallCount = 0;
/** When set, the next `bridgeStoreEntry` to this exact (namespace, key)
 *  fails once, then clears itself — simulating one silently-dropped write
 *  instead of a whole-backend outage. */
let failStoreOnceFor: { namespace: string; key: string } | null = null;

function ns(namespace: string): Map<string, FakeEntry> {
  let m = store.get(namespace);
  if (!m) store.set(namespace, (m = new Map()));
  return m;
}
function entriesIn(namespace: string): FakeEntry[] {
  return [...ns(namespace).values()];
}

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeStoreEntry: async (o: {
    key: string;
    value: string;
    namespace?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    generateEmbeddingFlag?: boolean;
    ifVersion?: number | 'absent';
  }) => {
    const namespace = o.namespace ?? 'default';
    if (
      failStoreOnceFor &&
      failStoreOnceFor.namespace === namespace &&
      failStoreOnceFor.key === o.key
    ) {
      failStoreOnceFor = null;
      return { success: false, id: '', error: 'simulated write failure' };
    }
    const m = ns(namespace);
    const existing = m.get(o.key);
    if (o.ifVersion !== undefined) {
      if (o.ifVersion === 'absent') {
        if (existing) return { success: false, id: existing.id, conflict: true, error: 'exists' };
      } else if (!existing || existing.version !== o.ifVersion) {
        return { success: false, id: existing?.id ?? '', conflict: true, error: 'version conflict' };
      }
    }
    const id = existing?.id ?? `entry_${++idSeq}`;
    const version = (existing?.version ?? 0) + 1;
    m.set(o.key, {
      id,
      key: o.key,
      namespace,
      content: o.value,
      tags: o.tags ?? [],
      metadata: o.metadata ?? {},
      version,
    });
    return { success: true, id };
  },
  bridgeGetEntry: async (o: { key: string; namespace?: string }) => {
    const e = ns(o.namespace ?? 'default').get(o.key);
    return e ? { success: true, found: true, entry: e } : { success: true, found: false };
  },
  bridgeListEntries: async (o: { namespace?: string; limit?: number; offset?: number }) => {
    listCallCount++;
    if (failListAfterCalls !== null && listCallCount > failListAfterCalls) return null;
    const namespace = o.namespace ?? 'default';
    listCalls.push({ namespace, limit: o.limit, offset: o.offset });
    const limit = o.limit ?? 100;
    const offset = o.offset ?? 0;
    const all = entriesIn(namespace);
    const entries = all.slice(offset, offset + limit);
    return { success: true, entries, total: entries.length };
  },
  bridgeDeleteEntry: async (o: { id?: string; key?: string; namespace?: string }) => {
    const namespace = o.namespace ?? 'default';
    const m = ns(namespace);
    const key = o.key ?? (o.id ? [...m.values()].find((e) => e.id === o.id)?.key : undefined);
    const entry = key ? m.get(key) : undefined;
    if (!key || !entry) return { success: true, deleted: false };
    m.delete(key);
    return { success: true, deleted: true };
  },
  // Substring match, fixed score — enough for kgSearch's seed lookup and
  // kgIngestRules' dedup probe; K7's own tests don't exercise rule dedup.
  bridgeSearchEntries: async (o: { query: string; namespace?: string }) => {
    const q = o.query.trim().toLowerCase();
    const results = entriesIn(o.namespace ?? 'default')
      .filter((e) => e.content.toLowerCase().includes(q))
      .map((e) => ({ id: e.id, key: e.key, content: e.content, score: 0.9, tags: e.tags }));
    return { success: true, results, searchMethod: 'keyword' as const };
  },
  bridgeCountEntries: async (namespace: string) => ns(namespace).size,
}));

import {
  kgIndexStatus,
  kgIngest,
  kgRebuildIndex,
  kgRollback,
  kgSearch,
  KG_NODES_NS,
  KG_INDEX_STATUS_NS,
} from '../memory/memory-kg.js';

function node(name: string) {
  return entriesIn(KG_NODES_NS).find((e) => e.metadata.name === name);
}

beforeEach(() => {
  store.clear();
  idSeq = 0;
  listCalls.length = 0;
  failListAfterCalls = null;
  listCallCount = 0;
  failStoreOnceFor = null;
});

describe('a scope with no index behaves exactly as before K7', () => {
  it('reports absent status and still answers correctly via the exhaustive scan', async () => {
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Alpha', target: 'Beta', relation: 'depends_on' }],
      originRef: 'run:a',
    });
    expect((await kgIndexStatus()).state).toBe('absent');
    // No index rows were written — the dual-write hooks are a no-op while absent.
    expect(entriesIn('kg:adj')).toHaveLength(0);
    expect(entriesIn('kg:origin-idx')).toHaveLength(0);

    const res = await kgSearch({ query: 'Alpha' });
    expect(res.success).toBe(true);
    expect(res.triplets).toHaveLength(1);
    expect(res.triplets[0].relation).toBe('depends_on');
  });
});

describe('kgRebuildIndex builds a correct, validated index', () => {
  it('reaches ready with correct counts on a small graph', async () => {
    await kgIngest({
      nodes: [],
      edges: [
        { source: 'Alpha', target: 'Beta', relation: 'depends_on' },
        { source: 'Beta', target: 'Gamma', relation: 'depends_on' },
      ],
      originRef: 'run:a',
    });

    const result = await kgRebuildIndex();
    expect(result.success).toBe(true);
    expect(result.status.state).toBe('ready');
    expect(result.status.counts).toEqual({ nodes: 3, edges: 2, rules: 0 });
    // Small graph: every entity/origin the scan saw fits in the sample, so
    // this was full validation, not a partial guarantee.
    expect(result.validation?.full).toBe(true);

    expect((await kgIndexStatus()).state).toBe('ready');
  });
});

describe('indexed and exhaustive-scan retrieval agree (the K7 equivalence property)', () => {
  async function seedGraph(): Promise<void> {
    await kgIngest({
      nodes: [],
      edges: [
        { source: 'Alpha', target: 'Beta', relation: 'depends_on' },
        { source: 'Beta', target: 'Gamma', relation: 'calls' },
        { source: 'Alpha', target: 'Gamma', relation: 'related_to' },
      ],
      originRef: 'run:a',
    });
  }

  it('kgSearch returns the same triplets before and after the index is ready', async () => {
    await seedGraph();
    const before = await kgSearch({ query: 'Alpha' });
    expect(before.success).toBe(true);
    expect(before.triplets.length).toBeGreaterThan(0);

    const build = await kgRebuildIndex();
    expect(build.status.state).toBe('ready');

    const after = await kgSearch({ query: 'Alpha' });
    expect(after.success).toBe(true);
    const sortedKeys = (r: typeof before) => r.triplets.map((t) => t.key).sort();
    expect(sortedKeys(after)).toEqual(sortedKeys(before));
    // Ranking/scoring must be identical too, not just the candidate set.
    expect(after.triplets.map((t) => t.score)).toEqual(before.triplets.map((t) => t.score));
  });

  it('kgRollback withdraws the same entries whether indexed or scanned', async () => {
    await seedGraph();
    await kgRebuildIndex();
    expect((await kgIndexStatus()).state).toBe('ready');

    const rollback = await kgRollback({ originRef: 'run:a' });
    expect(rollback.success).toBe(true);
    // Everything was asserted by run:a alone: 3 nodes + 3 edges deleted.
    expect(rollback.deleted).toBe(6);
    expect(rollback.retained).toBe(0);
    expect(entriesIn(KG_NODES_NS)).toHaveLength(0);
    // A withdrawal that empties the graph must not itself fail the index —
    // it's still trustworthy, just describing an empty graph now.
    expect((await kgIndexStatus()).state).toBe('ready');
  });
});

describe('dual-write keeps the index fresh without a second rebuild', () => {
  it('a new edge ingested after ready is found immediately through the index', async () => {
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Alpha', target: 'Beta', relation: 'depends_on' }],
      originRef: 'run:a',
    });
    await kgRebuildIndex();
    expect((await kgIndexStatus()).state).toBe('ready');

    const beforeListCalls = listCalls.length;
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Alpha', target: 'Delta', relation: 'new_relation' }],
      originRef: 'run:b',
    });
    // The new edge's adjacency entries exist without another rebuild call.
    expect(entriesIn('kg:adj').length).toBeGreaterThan(0);

    const res = await kgSearch({ query: 'Alpha' });
    expect(res.triplets.some((t) => t.relation === 'new_relation')).toBe(true);
    // Retrieval went through the index (no full kg:edges scan): the only new
    // bridgeListEntries traffic since the ingest is small, not a namespace scan.
    const edgeScanCalls = listCalls
      .slice(beforeListCalls)
      .filter((c) => c.namespace === 'kg:edges' && (c.offset ?? 0) === 0 && (c.limit ?? 0) > 10);
    expect(edgeScanCalls).toHaveLength(0);
  });

  it('a rollback after ready removes the edge from indexed search results', async () => {
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Alpha', target: 'Beta', relation: 'depends_on' }],
      originRef: 'run:a',
    });
    await kgRebuildIndex();
    expect((await kgIndexStatus()).state).toBe('ready');

    await kgRollback({ originRef: 'run:a' });
    expect((await kgIndexStatus()).state).toBe('ready');

    const res = await kgSearch({ query: 'Alpha' });
    expect(res.triplets).toHaveLength(0);
  });
});

describe('kgRebuildIndex resumes an interrupted build instead of restarting', () => {
  // 1,001 edges — past scanNamespace's 1,000-row page, so an interruption
  // partway through the edges phase is meaningful, not a same-page no-op.
  const EDGES = 1001;

  async function seedBigGraph(): Promise<void> {
    for (let start = 0; start < EDGES; start += 500) {
      const edges: { source: string; target: string; relation: string }[] = [];
      for (let i = start; i < Math.min(start + 500, EDGES); i++) {
        edges.push({ source: 'Hub', target: `Leaf ${i}`, relation: 'relates_to' });
      }
      const res = await kgIngest({ nodes: [], edges, originRef: 'run:big' });
      expect(res.success).toBe(true);
    }
  }

  it('a build-phase failure is resumable and picks up where it stopped', async () => {
    await seedBigGraph();
    const totalNodes = entriesIn(KG_NODES_NS).length;

    // Let a few pages through, then simulate the backend going unavailable —
    // real interruption via the same mechanism kgRebuildIndex itself reads
    // (`bridgeListEntries` returning null), not a hand-seeded shortcut.
    failListAfterCalls = 2;
    const first = await kgRebuildIndex();
    expect(first.success).toBe(false);
    expect(first.status.state).toBe('failed');
    expect(first.status.resumable).toBe(true);
    // Real progress was checkpointed — not still at the very start.
    const stoppedAt = first.status.cursor;
    expect(stoppedAt).toBeDefined();
    expect(stoppedAt!.phase === 'edges' ? stoppedAt!.offset > 0 : true).toBe(true);

    failListAfterCalls = null;
    listCalls.length = 0;
    const second = await kgRebuildIndex();
    expect(second.success).toBe(true);
    expect(second.status.state).toBe('ready');
    expect(second.status.counts).toEqual({ nodes: totalNodes, edges: EDGES, rules: 0 });

    // A phase the first call fully finished is not rescanned by the second.
    if (stoppedAt && stoppedAt.phase !== 'nodes') {
      expect(listCalls.some((c) => c.namespace === KG_NODES_NS)).toBe(false);
    }
    // Whichever phase it stopped mid-way through resumed from that offset,
    // not from 0.
    if (stoppedAt) {
      const resumedNamespace = stoppedAt.phase === 'edges' ? 'kg:edges' : 'kg:rules';
      const firstCallForPhase = listCalls.find((c) => c.namespace === resumedNamespace);
      if (firstCallForPhase) expect(firstCallForPhase.offset).toBe(stoppedAt.offset);
    }

    // Correctness, not just "no crash": the resumed build is a real, complete,
    // validated index — kgSearch finds a leaf from EVERY part of the range,
    // including ones added before AND after the interruption point.
    expect((await kgIndexStatus()).state).toBe('ready');
    const early = await kgSearch({ query: 'Leaf 1' });
    const late = await kgSearch({ query: `Leaf ${EDGES - 1}` });
    expect(early.triplets.length).toBeGreaterThan(0);
    expect(late.triplets.length).toBeGreaterThan(0);
  });

  it('a validation-phase failure is NOT resumable — the next call restarts fresh', async () => {
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Alpha', target: 'Beta', relation: 'depends_on' }],
      originRef: 'run:a',
    });
    const alpha = node('Alpha')!;

    // Simulate one silently-dropped write: Alpha's adjacency write fails
    // once, but the SCAN's caller doesn't see it (kgRebuildIndex doesn't
    // abort the whole build over one addToAdj failure — that's exactly
    // what validation exists to catch instead).
    failStoreOnceFor = { namespace: 'kg:adj', key: alpha.key };
    const rebuild = await kgRebuildIndex();
    expect(rebuild.success).toBe(false);
    expect(rebuild.status.state).toBe('failed');
    expect(rebuild.status.resumable).toBeFalsy();
    expect(rebuild.status.error).toMatch(/validation failed/i);

    // A fresh scan (not a resume, since this failure was not resumable)
    // re-derives Alpha's entry correctly, and the graph is trustworthy again.
    const again = await kgRebuildIndex();
    expect(again.success).toBe(true);
    expect(again.status.state).toBe('ready');
    const res = await kgSearch({ query: 'Alpha' });
    expect(res.triplets).toHaveLength(1);
    expect(res.triplets[0].relation).toBe('depends_on');
  });
});
