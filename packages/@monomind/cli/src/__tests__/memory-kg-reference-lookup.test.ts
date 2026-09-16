/**
 * Reference lookup for the memory knowledge graph
 * (memory-KG next-steps handoff 2026-09-07, stage 2 — correctness baseline).
 *
 * This is the MEMORY knowledge graph (entities/relations/rules on the memory
 * bridge), not the Monograph code graph.
 *
 * `kgReferenceEdges` is the exhaustive, uncapped edge read a future indexed
 * adjacency/origin lookup (K7) will have to agree with once one exists — it
 * never depends on an index and never inherits a first-page cap, the same
 * exhaustive-scan discipline `kgRollback` already trusts for origin
 * withdrawal. These fixtures establish that it is trustworthy BEFORE
 * anything is built against it:
 *
 *  - src/dst/origin filtering is correct, including the AND case
 *  - a match past the first scan page (1,000 rows) is still found
 *  - the required-filter guard rejects an unscoped call
 *  - `truncated` is reported honestly when the scan cannot finish
 *
 * `assertSameEdges` is the reusable equivalence assertion stage 3 will call
 * to compare a future indexed lookup's output against this reference read.
 * It is exercised here by checking that two different filters over the same
 * canonical data converge on the identical edge record.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

const store = new Map<string, Map<string, FakeEntry>>();
let idSeq = 0;
let listCalls: { namespace: string; limit?: number; offset?: number }[] = [];
/** When set, every `bridgeListEntries` call past this many total calls
 *  returns null — simulating the backend going unavailable mid-scan. */
let failListAfterCalls: number | null = null;
let listCallCount = 0;

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
  }) => {
    const namespace = o.namespace ?? 'default';
    const id = ns(namespace).get(o.key)?.id ?? `entry_${++idSeq}`;
    ns(namespace).set(o.key, {
      id,
      key: o.key,
      namespace,
      content: o.value,
      tags: o.tags ?? [],
      metadata: o.metadata ?? {},
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
  bridgeDeleteEntry: async () => ({ success: true, deleted: false }),
  bridgeSearchEntries: async () => ({ success: true, results: [] }),
}));

import {
  KG_NODES_NS,
  type KgReferenceEdge,
  kgIngest,
  kgReferenceEdges,
} from '../memory/memory-kg.js';

/** Reusable equivalence assertion (K7): two edge-reference reads describe the
 *  SAME relationships and origins when their (src, relation, dst) triples and
 *  origin sets match, ignoring row order and storage key. */
function assertSameEdges(actual: KgReferenceEdge[], expected: KgReferenceEdge[]): void {
  const norm = (e: KgReferenceEdge) => ({
    src: e.src,
    relation: e.relation,
    dst: e.dst,
    originRefs: [...e.originRefs].sort(),
  });
  const key = (e: { src: string; relation: string; dst: string }) =>
    `${e.src} ${e.relation} ${e.dst}`;
  const bySortedKey = (xs: ReturnType<typeof norm>[]) =>
    [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  expect(bySortedKey(actual.map(norm))).toEqual(bySortedKey(expected.map(norm)));
}

function nodeIdByName(name: string): string {
  const e = entriesIn(KG_NODES_NS).find((row) => row.metadata.name === name);
  if (!e) throw new Error(`fixture bug: no node named ${name}`);
  return e.key;
}

beforeEach(() => {
  store.clear();
  idSeq = 0;
  listCalls = [];
  failListAfterCalls = null;
  listCallCount = 0;
});

describe('kgReferenceEdges requires a filter', () => {
  it('rejects a call with neither endpointId nor originRef', async () => {
    const res = await kgReferenceEdges({});
    expect(res.success).toBe(false);
    expect(res.edges).toEqual([]);
    expect(res.error).toMatch(/required/i);
  });
});

describe('kgReferenceEdges filters a small graph correctly', () => {
  beforeEach(async () => {
    await kgIngest({
      nodes: [],
      edges: [
        { source: 'Alpha', target: 'Beta', relation: 'depends_on' },
        { source: 'Beta', target: 'Gamma', relation: 'depends_on' },
      ],
      originRef: 'run:a',
    });
    await kgIngest({
      nodes: [],
      edges: [{ source: 'Alpha', target: 'Gamma', relation: 'related_to' }],
      originRef: 'run:b',
    });
  });

  it('finds edges by endpointId whether it names the src or the dst', async () => {
    const beta = nodeIdByName('Beta');
    const res = await kgReferenceEdges({ endpointId: beta });
    expect(res.success).toBe(true);
    expect(res.truncated).toBeFalsy();
    expect(res.edges).toHaveLength(2);
    expect(res.edges.map((e) => e.relation).sort()).toEqual(['depends_on', 'depends_on']);
  });

  it('finds edges by originRef', async () => {
    const res = await kgReferenceEdges({ originRef: 'run:b' });
    expect(res.success).toBe(true);
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0].relation).toBe('related_to');
  });

  it('applies endpointId and originRef as AND, not OR', async () => {
    const alpha = nodeIdByName('Alpha');
    // Alpha touches an edge under run:a AND an edge under run:b; only their
    // intersection should come back.
    const res = await kgReferenceEdges({ endpointId: alpha, originRef: 'run:b' });
    expect(res.success).toBe(true);
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0].relation).toBe('related_to');
    expect(res.edges[0].originRefs).toEqual(['run:b']);
  });

  it('returns no matches, not a truncated/error result, for a real but unrelated endpoint', async () => {
    const gamma = nodeIdByName('Gamma');
    const res = await kgReferenceEdges({ endpointId: gamma, originRef: 'run:a' });
    // Gamma has a run:a edge (Beta -> Gamma) — sanity: the filter is not
    // accidentally empty by construction.
    expect(res.edges).toHaveLength(1);

    const res2 = await kgReferenceEdges({ endpointId: gamma, originRef: 'does-not-exist' });
    expect(res2.success).toBe(true);
    expect(res2.truncated).toBeFalsy();
    expect(res2.edges).toEqual([]);
  });
});

describe('kgReferenceEdges is exhaustive across scan pages', () => {
  const LEAVES = 1050; // one past scanNamespace's 1,000-row page size

  beforeEach(async () => {
    // kgIngest caps edges at 1,000 per call, so seed in batches. Every leaf
    // gets a Hub -> Leaf edge under run:seed; only the LAST leaf (guaranteed
    // to land past the first scan page) also gets a second, distinctly
    // relationed edge under run:extra.
    for (let start = 0; start < LEAVES; start += 500) {
      const edges: { source: string; target: string; relation: string }[] = [];
      for (let i = start; i < Math.min(start + 500, LEAVES); i++) {
        edges.push({ source: 'Hub', target: `Leaf ${i}`, relation: 'relates_to' });
      }
      const res = await kgIngest({ nodes: [], edges, originRef: 'run:seed' });
      expect(res.success).toBe(true);
    }
    const res = await kgIngest({
      nodes: [],
      edges: [{ source: 'Hub', target: `Leaf ${LEAVES - 1}`, relation: 'special_relation' }],
      originRef: 'run:extra',
    });
    expect(res.success).toBe(true);
    listCalls = []; // only count scan calls made by the lookups under test
  });

  it('finds an endpoint match past the first scan page', async () => {
    const needle = nodeIdByName(`Leaf ${LEAVES - 1}`);
    const res = await kgReferenceEdges({ endpointId: needle });

    expect(res.success).toBe(true);
    expect(res.truncated).toBeFalsy();
    expect(res.edges).toHaveLength(2);
    expect(res.edges.map((e) => e.relation).sort()).toEqual(['relates_to', 'special_relation']);

    // The scan really paged rather than reading one oversized list.
    expect(listCalls.length).toBeGreaterThan(1);
    expect(listCalls.some((c) => (c.offset ?? 0) > 0)).toBe(true);
  });

  it('finds an origin match past the first scan page', async () => {
    const res = await kgReferenceEdges({ originRef: 'run:extra' });
    expect(res.success).toBe(true);
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0].dst).toBe(nodeIdByName(`Leaf ${LEAVES - 1}`));
  });

  it('two different filters converge on the same edge record (equivalence check)', async () => {
    const needle = nodeIdByName(`Leaf ${LEAVES - 1}`);
    const byEndpoint = await kgReferenceEdges({ endpointId: needle });
    const byOrigin = await kgReferenceEdges({ originRef: 'run:extra' });

    const specialViaEndpoint = byEndpoint.edges.filter((e) => e.relation === 'special_relation');
    assertSameEdges(specialViaEndpoint, byOrigin.edges);
  });

  it('reports truncated instead of a false-complete empty/partial answer when the scan cannot finish', async () => {
    failListAfterCalls = 1; // let the first page through, then go "unavailable"
    const res = await kgReferenceEdges({ originRef: 'run:seed' });

    expect(res.success).toBe(true);
    expect(res.truncated).toBe(true);
    // A truncated read must not be mistaken for "these are all the matches" —
    // it legitimately found some without covering the whole namespace.
    expect(res.edges.length).toBeLessThan(LEAVES);
  });
});
