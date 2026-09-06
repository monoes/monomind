/**
 * Memory knowledge-graph retrieval evidence — extraction method, conflict, the
 * node-set cutoff, and honest reporting of which retrieval actually ran
 * (memory-KG review 2026-09-05, K6 and K9).
 *
 * This is the MEMORY knowledge graph (entities/relations/rules on the memory
 * bridge), not the Monograph code graph.
 *
 * The bridge is a deterministic in-memory fake. Two things a real backend
 * cannot be asked for are what make these tests possible: an exact seed ranking
 * (so "the set member ranks 16th" is a fact, not a hope), and a chosen
 * `searchMethod` (so the keyword-fallback path can be asserted without
 * uninstalling the embedding model).
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

/** namespace → key → entry */
const store = new Map<string, Map<string, FakeEntry>>();
let idSeq = 0;
/** What the fake bridge search reports about itself. */
let searchMethod: 'semantic' | 'keyword' | 'keyword-fallback' = 'semantic';
let fallbackReason: string | undefined;
/** Node names the seed search should return, best first, with their scores.
 *  Ordering is the ranking — the fake never scores anything itself. */
let seedRanking: { name: string; score: number }[] = [];
/** Seed limits kgSearch actually asked for, so the over-fetch is observable. */
let seedLimits: number[] = [];

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
    const id = `entry_${++idSeq}`;
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
    const all = entriesIn(o.namespace ?? 'default');
    const entries = all.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100));
    return { success: true, entries, total: entries.length };
  },
  bridgeDeleteEntry: async () => ({ success: true, deleted: true }),
  bridgeSearchEntries: async (o: { namespace?: string; limit?: number }) => {
    seedLimits.push(o.limit ?? 10);
    const rows = entriesIn(o.namespace ?? 'default');
    const results = seedRanking
      .map(({ name, score }) => {
        const hit = rows.find((e) => e.metadata.name === name);
        return hit
          ? { id: hit.id, key: hit.key, content: hit.content, score, tags: hit.tags }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .slice(0, o.limit ?? 10);
    return {
      success: true,
      results,
      searchTime: 0,
      searchMethod,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  },
}));

import {
  heuristicExtract,
  KG_EDGES_NS,
  KG_NODES_NS,
  kgIngest,
  kgSearch,
} from '../memory/memory-kg.js';

function edgeFor(relation: string): FakeEntry | undefined {
  return entriesIn(KG_EDGES_NS).find((e) => e.metadata.relation === relation);
}
function nodeFor(name: string): FakeEntry | undefined {
  return entriesIn(KG_NODES_NS).find((e) => e.metadata.name === name);
}

beforeEach(() => {
  store.clear();
  idSeq = 0;
  searchMethod = 'semantic';
  fallbackReason = undefined;
  seedRanking = [];
  seedLimits = [];
});

describe('extraction method is recorded per claim', () => {
  it('stores a heuristic ingest as heuristic, not as a stated fact', async () => {
    await kgIngest({
      nodes: [{ name: 'Payments' }, { name: 'Ledger' }],
      edges: [{ source: 'Payments', target: 'Ledger', relation: 'mentioned_with' }],
      originRef: 'run:1',
      method: 'heuristic',
    });

    expect(nodeFor('Payments')?.metadata.method).toBe('heuristic');
    expect(edgeFor('mentioned_with')?.metadata.method).toBe('heuristic');
    const claims = edgeFor('mentioned_with')?.metadata.claims as { method?: string }[];
    expect(claims.map((c) => c.method)).toEqual(['heuristic']);
  });

  it('defaults to asserted when the caller supplied the payload itself', async () => {
    await kgIngest({ nodes: [{ name: 'Payments' }], originRef: 'run:1' });
    expect(nodeFor('Payments')?.metadata.method).toBe('asserted');
  });

  it('lets one asserted origin upgrade an element several heuristics guessed at', async () => {
    await kgIngest({ nodes: [{ name: 'Payments' }], originRef: 'run:1', method: 'heuristic' });
    await kgIngest({ nodes: [{ name: 'Payments' }], originRef: 'run:2', method: 'heuristic' });
    expect(nodeFor('Payments')?.metadata.method).toBe('heuristic');

    await kgIngest({
      nodes: [{ name: 'Payments', description: 'Settles merchant payouts nightly.' }],
      originRef: 'run:3',
    });

    // A fact someone stated does not become less stated because two regexes
    // also stumbled onto it.
    expect(nodeFor('Payments')?.metadata.method).toBe('asserted');
  });

  it('leaves the method unknown when any surviving claim predates the recording', async () => {
    await kgIngest({ nodes: [{ name: 'Payments' }], originRef: 'run:1' });
    // A row written before extraction method existed: one claim, no method.
    const row = nodeFor('Payments');
    if (!row) throw new Error('fixture node missing');
    row.metadata.claims = [{ origin: 'run:0', description: 'legacy', at: 1 }];

    await kgIngest({ nodes: [{ name: 'Payments' }], originRef: 'run:2' });

    // Unknown is not `asserted`: reading it that way would relabel every old
    // co-occurrence guess in the graph as a stated fact.
    expect(nodeFor('Payments')?.metadata.method).toBeUndefined();
  });
});

describe('heuristicExtract names what it actually observed', () => {
  it('emits mentioned_with for same-sentence co-occurrence, not relates_to', () => {
    const { edges } = heuristicExtract('Payments calls Ledger during settlement.');
    const relations = new Set(edges.map((e) => e.relation));
    expect(relations.has('mentioned_with')).toBe(true);
    expect(relations.has('relates_to')).toBe(false);
  });
});

describe('kgSearch applies the node-set filter before the seed cutoff', () => {
  /** 20 entities; only the 16th-ranked one is in the target set. Under a
   *  filter-after-cutoff read it is invisible. */
  async function seedTwentyWithLateSetMember(): Promise<void> {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      name: `Entity${i}`,
      ...(i === 15 ? { nodeSet: 'billing' } : {}),
    }));
    await kgIngest({ nodes, originRef: 'run:1' });
    seedRanking = nodes.map((n, i) => ({ name: n.name, score: 1 - i * 0.01 }));
  }

  it('finds a set member that ranks below the unfiltered top 15', async () => {
    await seedTwentyWithLateSetMember();

    const res = await kgSearch({ query: 'anything', nodeSet: 'billing' });

    expect(res.seeds.map((s) => s.name)).toEqual(['Entity15']);
  });

  it('over-fetches only when a set filter will follow', async () => {
    await seedTwentyWithLateSetMember();

    await kgSearch({ query: 'anything' });
    await kgSearch({ query: 'anything', nodeSet: 'billing' });

    expect(seedLimits[0]).toBe(15);
    expect(seedLimits[1]).toBeGreaterThan(15);
  });

  it('still returns at most the seed limit after filtering', async () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({
      name: `Entity${i}`,
      nodeSet: 'billing',
    }));
    await kgIngest({ nodes, originRef: 'run:1' });
    seedRanking = nodes.map((n, i) => ({ name: n.name, score: 1 - i * 0.01 }));

    const res = await kgSearch({ query: 'anything', nodeSet: 'billing', limit: 50 });

    expect(res.seeds.length).toBe(15);
  });
});

describe('kgSearch reports the retrieval that actually ran', () => {
  it('surfaces a keyword fallback instead of presenting it as vector search', async () => {
    await kgIngest({ nodes: [{ name: 'Payments' }], originRef: 'run:1' });
    seedRanking = [{ name: 'Payments', score: 0.8 }];
    searchMethod = 'keyword-fallback';
    fallbackReason = 'no-embedding-model';

    const res = await kgSearch({ query: 'payments' });

    expect(res.method).toBe('keyword-fallback');
    expect(res.fallbackReason).toBe('no-embedding-model');
  });

  it('reports the method even when nothing matched', async () => {
    searchMethod = 'keyword';
    seedRanking = [];

    const res = await kgSearch({ query: 'payments' });

    // "Nothing found by keyword search" and "nothing found by vector search"
    // are different answers; an empty result must not erase which one it is.
    expect(res.success).toBe(true);
    expect(res.seeds).toEqual([]);
    expect(res.method).toBe('keyword');
  });
});

describe('triplet ranking weighs the recorded evidence', () => {
  /** Two edges out of the same seed pair, identical in every ranking input
   *  except the evidence recorded on them. */
  async function twoEdgesDifferingOnlyInEvidence(): Promise<void> {
    await kgIngest({
      nodes: [{ name: 'Payments' }, { name: 'Ledger' }],
      edges: [
        { source: 'Payments', target: 'Ledger', relation: 'writes_to' },
        { source: 'Payments', target: 'Ledger', relation: 'mentioned_with' },
      ],
      originRef: 'run:1',
    });
    // Re-assert only the co-occurrence edge as heuristic. Same endpoints, same
    // seed scores; the sole difference is how it was obtained.
    const edge = edgeFor('mentioned_with');
    if (edge) edge.metadata.method = 'heuristic';
    seedRanking = [
      { name: 'Payments', score: 0.9 },
      { name: 'Ledger', score: 0.9 },
    ];
  }

  it('ranks a stated fact above a co-occurrence guess between the same seeds', async () => {
    await twoEdgesDifferingOnlyInEvidence();

    const res = await kgSearch({ query: 'payments ledger' });
    const by = new Map(res.triplets.map((t) => [t.relation, t]));

    expect(by.get('writes_to')?.score).toBeGreaterThan(by.get('mentioned_with')?.score ?? 0);
    expect(by.get('mentioned_with')?.method).toBe('heuristic');
    // Demoted, not hidden: a guess between two strong seeds is still worth
    // returning when nothing better was asserted.
    expect(by.get('mentioned_with')).toBeDefined();
  });

  it('demotes a disputed edge and says that it is disputed', async () => {
    await kgIngest({
      nodes: [{ name: 'Payments' }, { name: 'Ledger' }],
      edges: [
        { source: 'Payments', target: 'Ledger', relation: 'writes_to', description: 'Writes v1.' },
        { source: 'Payments', target: 'Ledger', relation: 'reads_from' },
      ],
      originRef: 'run:1',
    });
    // A second origin contradicts the first about the same edge.
    await kgIngest({
      nodes: [],
      edges: [
        {
          source: 'Payments',
          target: 'Ledger',
          relation: 'writes_to',
          description: 'Does not write; the batch job does.',
        },
      ],
      originRef: 'run:2',
    });
    seedRanking = [
      { name: 'Payments', score: 0.9 },
      { name: 'Ledger', score: 0.9 },
    ];

    const res = await kgSearch({ query: 'payments ledger' });
    const by = new Map(res.triplets.map((t) => [t.relation, t]));

    expect(by.get('writes_to')?.conflict).toBe(true);
    expect(by.get('writes_to')?.score).toBeLessThan(by.get('reads_from')?.score ?? 0);
  });

  it('does not penalize an edge whose method was never recorded', async () => {
    await kgIngest({
      nodes: [{ name: 'Payments' }, { name: 'Ledger' }],
      edges: [
        { source: 'Payments', target: 'Ledger', relation: 'writes_to' },
        { source: 'Payments', target: 'Ledger', relation: 'reads_from' },
      ],
      originRef: 'run:1',
    });
    // An edge from before method recording: no method on the row at all.
    const legacy = edgeFor('reads_from');
    if (legacy) legacy.metadata.method = undefined;
    seedRanking = [
      { name: 'Payments', score: 0.9 },
      { name: 'Ledger', score: 0.9 },
    ];

    const res = await kgSearch({ query: 'payments ledger' });
    const by = new Map(res.triplets.map((t) => [t.relation, t]));

    // Unknown is not evidence against an edge — penalizing it would demote the
    // whole pre-existing graph beneath anything written today.
    expect(by.get('reads_from')?.score).toBe(by.get('writes_to')?.score);
    expect(by.get('reads_from')?.method).toBeUndefined();
  });
});
