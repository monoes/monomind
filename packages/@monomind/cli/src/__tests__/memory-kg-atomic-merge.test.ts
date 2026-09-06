/**
 * Atomic provenance merge and relationship-level feedback IDs
 * (memory-KG review 2026-09-05, finding K5 remainder).
 *
 * This is the MEMORY knowledge graph (entities/relations/rules on the memory
 * bridge), not the Monograph code graph.
 *
 * kgIngest's node/edge writes are a read (bridgeGetEntry) -> claim-ledger
 * merge (applyClaim) -> write (bridgeStoreEntry) sequence. Before this, the
 * write was an unconditional upsert: two callers racing to merge onto the
 * same row could each read the same state, and the second write would
 * silently discard the first's claim. `bridgeStoreEntry`'s `ifVersion`
 * (backed by a real single-statement compare-and-swap on the bridge —
 * SqlBackend.storeIfVersion/storeIfAbsent) closes that: this fake bridge
 * reproduces the race deterministically by injecting a concurrent writer's
 * commit the first time a given key is stored, forcing memory-kg.ts's CAS
 * retry loop (`withCasRetry`) to run.
 *
 * Also covers the companion K5 ask: kgSearch's triplets carry the edge's
 * bridge id and graph key, so a caller can rate a specific relationship
 * directly instead of only its seed entity.
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
/** key -> one-shot hook run just before that key's NEXT bridgeStoreEntry CAS
 *  check, simulating a concurrent writer's commit landing in the gap between
 *  this call's read and its write. */
const interceptOnce = new Map<string, () => void>();
const countCalls: string[] = [];

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
    const m = ns(namespace);
    const intercept = interceptOnce.get(o.key);
    if (intercept) {
      interceptOnce.delete(o.key);
      intercept();
    }
    const existing = m.get(o.key);
    if (o.ifVersion !== undefined) {
      if (o.ifVersion === 'absent') {
        if (existing) return { success: false, id: existing.id, conflict: true, error: 'exists' };
      } else if (!existing || existing.version !== o.ifVersion) {
        return {
          success: false,
          id: existing?.id ?? '',
          conflict: true,
          error: 'version conflict',
        };
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
    const limit = o.limit ?? 100;
    const offset = o.offset ?? 0;
    const all = entriesIn(o.namespace ?? 'default');
    const entries = all.slice(offset, offset + limit);
    return { success: true, entries, total: entries.length };
  },
  bridgeDeleteEntry: async () => ({ success: true, deleted: false }),
  // Keyword-ish seed search: substring match on rendered content, fixed score.
  bridgeSearchEntries: async (o: { query: string; namespace?: string }) => {
    const q = o.query.trim().toLowerCase();
    const results = entriesIn(o.namespace ?? 'default')
      .filter((e) => e.content.toLowerCase().includes(q))
      .map((e) => ({ id: e.id, key: e.key, content: e.content, score: 0.9, tags: e.tags }));
    return { success: true, results, searchMethod: 'keyword' as const };
  },
  bridgeCountEntries: async (namespace: string) => {
    countCalls.push(namespace);
    return ns(namespace).size;
  },
}));

import { KG_NODES_NS, kgIngest, kgSearch, kgStats, nodeKey } from '../memory/memory-kg.js';

function node(name: string) {
  return entriesIn(KG_NODES_NS).find((e) => e.metadata.name === name);
}

describe('memory KG atomic provenance merge (K5)', () => {
  beforeEach(() => {
    store.clear();
    idSeq = 0;
    interceptOnce.clear();
    countCalls.length = 0;
  });

  it('merges two non-concurrent origins onto the same entity normally', async () => {
    const a = await kgIngest({ nodes: [{ name: 'Alpha' }], originRef: 'run:A' });
    expect(a.success).toBe(true);
    const b = await kgIngest({ nodes: [{ name: 'Alpha' }], originRef: 'run:B' });
    expect(b.success).toBe(true);

    expect(node('Alpha')?.metadata.origin_refs).toEqual(['run:A', 'run:B']);
  });

  it("does not lose a concurrent writer's claim when a merge write hits a version conflict", async () => {
    await kgIngest({ nodes: [{ name: 'Alpha' }], originRef: 'run:A' });
    const key = node('Alpha')!.key;
    expect(key).toBe(nodeKey('entity', 'Alpha'));

    // Simulate run:C's own read-merge-write landing in the gap between our
    // upcoming run:B ingest's read and its write: bump the row's version and
    // append run:C's claim, exactly as a concurrent writer's commit would.
    interceptOnce.set(key, () => {
      const m = ns(KG_NODES_NS);
      const e = m.get(key)!;
      const claims = [
        ...((e.metadata.claims as unknown[]) ?? []),
        { origin: 'run:C', description: '', at: Date.now(), method: 'asserted' },
      ];
      m.set(key, {
        ...e,
        metadata: {
          ...e.metadata,
          claims,
          origin_refs: (claims as { origin: string }[]).map((c) => c.origin),
        },
        version: e.version + 1,
      });
    });

    const b = await kgIngest({ nodes: [{ name: 'Alpha' }], originRef: 'run:B' });
    expect(b.success).toBe(true);

    // Both the injected concurrent claim (run:C) and this call's own claim
    // (run:B) must survive — neither the CAS conflict nor its retry may drop
    // the other writer's update.
    expect(node('Alpha')?.metadata.origin_refs).toEqual(['run:A', 'run:C', 'run:B']);
  });

  it('does not lose a concurrently-created entity when two callers assert it as new', async () => {
    const key = nodeKey('entity', 'Beta');

    // Simulate a concurrent caller's own create (run:X) landing between our
    // run:Y ingest's read (which found nothing) and its create-if-absent write.
    interceptOnce.set(key, () => {
      ns(KG_NODES_NS).set(key, {
        id: 'entry_concurrent',
        key,
        namespace: KG_NODES_NS,
        content: 'Beta — entity',
        tags: ['kg', ''],
        metadata: {
          kg: 'node',
          name: 'Beta',
          type: 'entity',
          claims: [{ origin: 'run:X', description: '', at: Date.now(), method: 'asserted' }],
          origin_refs: ['run:X'],
        },
        version: 1,
      });
    });

    const y = await kgIngest({ nodes: [{ name: 'Beta' }], originRef: 'run:Y' });
    expect(y.success).toBe(true);

    expect(node('Beta')?.metadata.origin_refs).toEqual(['run:X', 'run:Y']);
  });
});

describe('kgSearch triplets carry the edge id (K5)', () => {
  beforeEach(() => {
    store.clear();
    idSeq = 0;
    interceptOnce.clear();
    countCalls.length = 0;
  });

  it('lets a caller address a specific relationship by its bridge id and graph key', async () => {
    await kgIngest({
      nodes: [{ name: 'Alpha' }, { name: 'Widget' }],
      edges: [
        { source: 'Alpha', target: 'Widget', relation: 'owns', description: 'Alpha owns Widget' },
      ],
      originRef: 'run:A',
    });

    const res = await kgSearch({ query: 'Alpha' });
    expect(res.success).toBe(true);
    expect(res.triplets.length).toBeGreaterThan(0);

    const edgeEntry = entriesIn('kg:edges')[0];
    expect(res.triplets[0].id).toBe(edgeEntry.id);
    expect(res.triplets[0].key).toBe(edgeEntry.key);
  });
});

describe('kgStats uses a real count when the bridge supports one (K7)', () => {
  beforeEach(() => {
    store.clear();
    idSeq = 0;
    interceptOnce.clear();
    countCalls.length = 0;
  });

  it('reports exact namespace counts via bridgeCountEntries instead of a full scan', async () => {
    await kgIngest({
      nodes: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }],
      originRef: 'run:A',
    });

    const stats = await kgStats();

    expect(stats.nodes).toBe(3);
    expect(countCalls).toContain(KG_NODES_NS);
  });
});
