/**
 * Memory knowledge-graph identity, correction/supersession and graph integrity
 * (memory knowledge-graph review 2026-09-05, findings K4, K3-remaining, K8).
 *
 * This is the MEMORY knowledge graph (entities/relations/rules on the memory
 * bridge), not the Monograph code graph.
 *
 * The memory bridge is replaced with a deterministic in-memory fake, for the
 * same reason as the provenance suite: a real backend cannot be asked to fail
 * one specific write, and embedding-backed rule dedup is not reproducible
 * enough to pin exact-identity assertions on.
 *
 * Every case here fails against the pre-`KG_ID_VERSION` model:
 *  - `Person:Alex` and `Service:Alex` shared one name-only key
 *  - names differing only past 200 normalized characters shared one key
 *  - "longest description wins" discarded a shorter correction
 *  - rollback edited an origin list, so a withdrawn bad update stayed put
 *  - edge-only ingestion produced an edge with zero endpoints
 *  - over-cap payloads were `.slice()`d away in silence
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  hasEmbedding: boolean;
}

/** namespace → key → entry */
const store = new Map<string, Map<string, FakeEntry>>();
const byId = new Map<string, { namespace: string; key: string }>();
let idSeq = 0;

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
  }) => {
    const namespace = o.namespace ?? 'default';
    // The bridge's upsert reuses the existing entry id (memory-bridge.ts
    // carries `createdAt` forward), so the fake keeps the id stable too.
    const previous = ns(namespace).get(o.key);
    const id = previous?.id ?? `entry_${++idSeq}`;
    ns(namespace).set(o.key, {
      id,
      key: o.key,
      namespace,
      content: o.value,
      tags: o.tags ?? [],
      metadata: o.metadata ?? {},
      hasEmbedding: o.generateEmbeddingFlag !== false,
    });
    byId.set(id, { namespace, key: o.key });
    return { success: true, id };
  },
  bridgeGetEntry: async (o: { key: string; namespace?: string }) => {
    const e = ns(o.namespace ?? 'default').get(o.key);
    return e ? { success: true, found: true, entry: e } : { success: true, found: false };
  },
  bridgeListEntries: async (o: { namespace?: string; limit?: number; offset?: number }) => {
    const limit = Math.min(o.limit ?? 100, 10_000);
    const all = entriesIn(o.namespace ?? 'default');
    const entries = all.slice(o.offset ?? 0, (o.offset ?? 0) + limit);
    return { success: true, entries, total: entries.length };
  },
  bridgeDeleteEntry: async (o: { id?: string; key?: string; namespace?: string }) => {
    const namespace = o.namespace ?? 'default';
    const key = o.key ?? (o.id ? byId.get(o.id)?.key : undefined);
    const m = ns(namespace);
    const entry = key ? m.get(key) : undefined;
    if (!key || !entry) return { success: true, deleted: false };
    m.delete(key);
    byId.delete(entry.id);
    return { success: true, deleted: true };
  },
  // Rule dedup: exact-text match, reported as a keyword (non-semantic) hit so
  // kgIngestRules takes its exact-text comparison path.
  bridgeSearchEntries: async (o: { query: string; namespace?: string }) => {
    const hit = entriesIn(o.namespace ?? 'default').find(
      (e) => e.content.split('\n')[0].trim().toLowerCase() === o.query.trim().toLowerCase(),
    );
    return {
      success: true,
      results: hit
        ? [
            {
              id: hit.id,
              key: hit.key,
              content: hit.content,
              tags: hit.tags,
              score: 1,
              provenance: 'keyword',
            },
          ]
        : [],
    };
  },
}));

import {
  KG_EDGES_NS,
  KG_NODES_NS,
  kgIngest,
  kgIngestRules,
  kgIntegrityCheck,
  kgRollback,
  RULES_NS,
} from '../memory/memory-kg.js';

/** Entities carrying this name, whatever their type. */
function nodesNamed(name: string): FakeEntry[] {
  return entriesIn(KG_NODES_NS).filter((e) => e.metadata.name === name);
}

/** The one entity with this (type, name), or undefined. */
function nodeOf(type: string, name: string): FakeEntry | undefined {
  return nodesNamed(name).find((e) => e.metadata.type === type);
}

beforeEach(() => {
  store.clear();
  byId.clear();
  idSeq = 0;
});

describe('entity identity is the (type, name) tuple', () => {
  it('keeps two differently-typed entities with the same name apart', async () => {
    await kgIngest({
      nodes: [{ name: 'Alex', type: 'Person', description: 'Alex is the on-call engineer' }],
      originRef: 'run:1',
    });
    const second = await kgIngest({
      nodes: [{ name: 'Alex', type: 'Service', description: 'Alex is the billing service' }],
      originRef: 'run:2',
    });

    // Name-only identity gave both the key `n:alex`, so the second ingest
    // overwrote the first and one description was simply lost.
    expect(second.nodesAdded).toBe(1);
    expect(second.nodesMerged).toBe(0);
    expect(nodesNamed('Alex')).toHaveLength(2);
    expect(nodeOf('Person', 'Alex')?.metadata.description).toBe('Alex is the on-call engineer');
    expect(nodeOf('Service', 'Alex')?.metadata.description).toBe('Alex is the billing service');

    // A same-name match is a CANDIDATE, reported rather than merged away.
    expect(second.ambiguities?.join(' ')).toContain('Alex');
    expect(second.ambiguities?.join(' ')).toContain('person');
  });

  it('keeps names that differ only past the old truncation point apart', async () => {
    // `normalizeName` truncates at 200 characters, so both of these collapsed
    // onto the same key even though nothing about them is the same entity.
    const prefix = 'l'.repeat(210);
    const first = `${prefix} alpha`;
    const second = `${prefix} beta`;

    await kgIngest({ nodes: [{ name: first, type: 'Service' }], originRef: 'run:1' });
    await kgIngest({ nodes: [{ name: second, type: 'Service' }], originRef: 'run:1' });

    expect(entriesIn(KG_NODES_NS)).toHaveLength(2);
    expect(nodesNamed(first)).toHaveLength(1);
    expect(nodesNamed(second)).toHaveLength(1);
  });

  it('still merges a generic re-extraction onto the one typed entity', async () => {
    // The property name-only identity existed to protect: the LLM says
    // "Module", a later heuristic pass says nothing, and they must stay one
    // entity. That now comes from the name index, not from a lossy key.
    await kgIngest({
      nodes: [{ name: 'Ledger', type: 'Module', description: 'the ledger module' }],
      originRef: 'run:1',
    });
    const generic = await kgIngest({
      nodes: [{ name: 'Ledger', description: 'seen again' }],
      originRef: 'run:2',
    });

    expect(generic.nodesAdded).toBe(0);
    expect(generic.nodesMerged).toBe(1);
    expect(generic.ambiguities).toBeUndefined();
    expect(nodesNamed('Ledger')).toHaveLength(1);
    // A generic label never overwrites an assigned type.
    expect(nodeOf('Module', 'Ledger')).toBeDefined();
  });

  it('promotes an untyped entity in place when a type finally arrives', async () => {
    await kgIngest({
      nodes: [{ name: 'Ledger', description: 'unclassified' }],
      originRef: 'run:1',
    });
    const idBefore = nodesNamed('Ledger')[0].key;

    const typed = await kgIngest({
      nodes: [{ name: 'Ledger', type: 'Module', description: 'the ledger module' }],
      originRef: 'run:2',
    });

    expect(typed.nodesMerged).toBe(1);
    expect(nodesNamed('Ledger')).toHaveLength(1);
    // The ID does not change, so anything already pointing at this entity —
    // every edge, and every reference a caller was handed — stays valid.
    expect(nodesNamed('Ledger')[0].key).toBe(idBefore);
    expect(nodesNamed('Ledger')[0].metadata.type).toBe('Module');
  });

  it('never mints an ID that a promoted entity already occupies', async () => {
    // Promotion keeps an entity's ID while changing its type, which decouples
    // the ID from the type it was minted from. A later assertion in the ORIGINAL
    // bucket therefore re-derives that same ID, and without a uniqueness check
    // its claims land inside the promoted entity — while the same call reports
    // that entity as one it "kept separate from".
    await kgIngest({ nodes: [{ name: 'Alex', description: 'unclassified' }], originRef: 'run:1' });
    await kgIngest({
      nodes: [{ name: 'Alex', type: 'Person', description: 'the on-call engineer' }],
      originRef: 'run:2',
    });
    await kgIngest({
      nodes: [{ name: 'Alex', type: 'Service', description: 'the billing service' }],
      originRef: 'run:3',
    });
    // Untyped again, now that the name is ambiguous and the untyped bucket is
    // occupied by the promoted Person entity.
    await kgIngest({
      nodes: [{ name: 'Alex', description: 'someone said Alex' }],
      originRef: 'run:4',
    });

    expect(nodesNamed('Alex')).toHaveLength(3);
    // The Person entity kept its own description and its own support.
    expect(nodeOf('Person', 'Alex')?.metadata.description).toBe('the on-call engineer');
    expect(nodeOf('Person', 'Alex')?.metadata.origin_refs).toEqual(['run:1', 'run:2']);
    // Every entity under this name has a distinct ID.
    const ids = nodesNamed('Alex').map((e) => e.key);
    expect(new Set(ids).size).toBe(3);
  });

  it('gives two rules sharing a long preamble separate identities', async () => {
    // Rule keys truncated the normalized rule at 120 characters.
    const preamble =
      'When the release pipeline runs on a protected branch and the changelog is'.concat(
        ' already generated and reviewed by the release manager, then ',
      );
    await kgIngestRules({
      rules: [{ rule: `${preamble}tag the release.` }],
      originRef: 'run:1',
    });
    await kgIngestRules({
      rules: [{ rule: `${preamble}publish the packages.` }],
      originRef: 'run:1',
    });

    expect(entriesIn(RULES_NS)).toHaveLength(2);
  });
});

describe('corrections supersede, and rollback puts the previous claim back', () => {
  const STALE =
    'The primary datastore is MySQL 8, replicated across three availability zones ' +
    'with a nightly logical backup to object storage.';
  const CORRECTION = 'Now PostgreSQL';

  async function ingestStaleThenCorrection() {
    await kgIngest({
      nodes: [{ name: 'Store', type: 'Service', description: STALE }],
      originRef: 'run:stale',
    });
    await kgIngest({
      nodes: [{ name: 'Store', type: 'Service', description: CORRECTION }],
      originRef: 'run:fix',
    });
  }

  it('accepts a shorter, later description over a longer stale one', async () => {
    await ingestStaleThenCorrection();

    // "Longest description wins" measured verbosity, so the correction was
    // discarded and the entity kept claiming MySQL.
    expect(nodeOf('Service', 'Store')?.metadata.description).toBe(CORRECTION);
    // Both origins still support the entity, and the graph records that they
    // disagree rather than presenting the winner as settled.
    expect(nodeOf('Service', 'Store')?.metadata.origin_refs).toEqual(['run:stale', 'run:fix']);
    expect(nodeOf('Service', 'Store')?.metadata.conflict).toBe(true);
  });

  it('restores the previous description when the update is rolled back', async () => {
    await ingestStaleThenCorrection();

    const res = await kgRollback({ originRef: 'run:fix' });

    expect(res.success).toBe(true);
    expect(res.deleted).toBe(0);
    expect(res.retained).toBeGreaterThan(0);
    // Reconstructed from the surviving source contribution. Editing an origin
    // list could only remove the ref — the bad description stayed frozen in.
    const node = nodeOf('Service', 'Store');
    expect(node?.metadata.description).toBe(STALE);
    expect(node?.metadata.origin_refs).toEqual(['run:stale']);
    expect(node?.metadata.conflict).toBe(false);
    // The rendered value follows the restored summary, not the withdrawn one.
    expect(node?.content).toContain(STALE);
  });

  it('records dropped support instead of silently truncating it', async () => {
    // Past MAX_CLAIMS the oldest support is dropped — the old code did the same
    // with `origin_refs.slice(-100)` and left the entry claiming a complete
    // history, so a rollback of an older origin found nothing and said so.
    let sawTruncation = false;
    for (let i = 0; i < 205; i++) {
      const res = await kgIngest({
        nodes: [{ name: 'Widely Known', type: 'Service' }],
        originRef: `run:${i}`,
      });
      if (res.provenanceTruncated) sawTruncation = true;
    }

    expect(sawTruncation).toBe(true);
    const node = nodeOf('Service', 'Widely Known');
    expect(node?.metadata.provenance_complete).toBe(false);
    expect(node?.metadata.origins_dropped).toBe(5);
    expect((node?.metadata.origin_refs as string[]).length).toBe(200);
  });
});

describe('graph integrity', () => {
  it('creates the endpoints an edge names instead of leaving it orphaned', async () => {
    const res = await kgIngest({
      nodes: [],
      edges: [{ source: 'Ghost', target: 'Phantom', relation: 'calls' }],
      originRef: 'run:1',
    });

    // Edge-only ingestion used to succeed with zero nodes and one edge, and
    // because retrieval is node-seeded that fact was unreachable through both
    // of its own endpoints.
    expect(res.success).toBe(true);
    expect(res.edgesAdded).toBe(1);
    expect(res.placeholders).toBe(2);
    expect(entriesIn(KG_NODES_NS)).toHaveLength(2);

    const integrity = await kgIntegrityCheck();
    expect(integrity.success).toBe(true);
    expect(integrity.edges).toBe(1);
    expect(integrity.dangling).toEqual([]);
  });

  it('does not blank a description when an edge re-names the node that carries it', async () => {
    // The edge gives no `sourceType`, so the endpoint resolves through the name
    // index rather than through the payload — a second assertion about the same
    // entity from the same origin, carrying no description of its own.
    const res = await kgIngest({
      nodes: [{ name: 'Ledger', type: 'Service', description: 'the ledger service' }],
      edges: [{ source: 'Ledger', target: 'Vault', relation: 'writes_to' }],
      originRef: 'run:1',
    });

    expect(res.success).toBe(true);
    expect(nodeOf('Service', 'Ledger')?.metadata.description).toBe('the ledger service');
    // Only the endpoint that did not exist is a placeholder.
    expect(res.placeholders).toBe(1);
  });

  it('reports an edge whose endpoints do not exist', async () => {
    // Written directly, because ingest can no longer produce this shape — it is
    // what a graph built before endpoint creation still holds.
    ns(KG_EDGES_NS).set('e:orphan', {
      id: 'entry_orphan',
      key: 'e:orphan',
      namespace: KG_EDGES_NS,
      content: 'Ghost calls Phantom',
      tags: ['kg', 'calls'],
      metadata: { kg: 'edge', src: 'n:ghost', dst: 'n:phantom', relation: 'calls' },
      hasEmbedding: false,
    });

    const integrity = await kgIntegrityCheck();

    expect(integrity.dangling).toHaveLength(1);
    expect(integrity.dangling[0].key).toBe('e:orphan');
    expect(integrity.dangling[0].missing).toEqual(['n:ghost', 'n:phantom']);
  });

  it('removes edges whose endpoint a rollback deleted', async () => {
    await kgIngest({
      nodes: [
        { name: 'A', type: 'Service' },
        { name: 'B', type: 'Service' },
      ],
      edges: [
        {
          source: 'A',
          target: 'B',
          relation: 'calls',
          sourceType: 'Service',
          targetType: 'Service',
        },
      ],
      originRef: 'run:1',
    });
    // A second origin supporting only the EDGE — the shape that used to leave a
    // relation standing between two entities that no longer exist.
    const edge = entriesIn(KG_EDGES_NS)[0];
    const claims = edge.metadata.claims as { origin: string; description: string; at: number }[];
    claims.push({ origin: 'run:2', description: '', at: Date.now() });
    edge.metadata.origin_refs = claims.map((c) => c.origin);

    const res = await kgRollback({ originRef: 'run:1' });

    expect(res.success).toBe(true);
    expect(res.danglingEdgesRemoved).toBe(1);
    expect(entriesIn(KG_NODES_NS)).toHaveLength(0);
    expect(entriesIn(KG_EDGES_NS)).toHaveLength(0);
  });
});

describe('over-cap and invalid payloads are reported, not sliced away', () => {
  it('reports how many nodes and edges the per-call cap dropped', async () => {
    const nodes = Array.from({ length: 505 }, (_, i) => ({ name: `Node ${i}`, type: 'Service' }));
    const edges = Array.from({ length: 1003 }, (_, i) => ({
      source: 'Node 0',
      target: `Node ${i}`,
      relation: 'links_to',
      sourceType: 'Service',
      targetType: 'Service',
    }));

    const res = await kgIngest({ nodes, edges, originRef: 'run:1' });

    expect(res.nodesTruncated).toBe(5);
    expect(res.edgesTruncated).toBe(3);
  });

  it('reports rejected items and writes none of them', async () => {
    const res = await kgIngest({
      nodes: [{ name: 'Kept', type: 'Service' }, { name: '   ' }],
      edges: [{ source: 'Kept', target: '', relation: 'calls' }],
      originRef: 'run:1',
    });

    expect(res.nodesRejected).toBe(1);
    expect(res.edgesRejected).toBe(1);
    expect(res.rejections?.join(' ')).toContain('missing name');
    expect(res.rejections?.join(' ')).toContain('missing target');
    expect(res.nodesAdded).toBe(1);
    expect(entriesIn(KG_EDGES_NS)).toHaveLength(0);
  });

  it('reports rules dropped by the per-call cap', async () => {
    const rules = Array.from({ length: 55 }, (_, i) => ({
      rule: `Rule number ${i} that is comfortably longer than the minimum`,
    }));

    const res = await kgIngestRules({ rules, originRef: 'run:1' });

    expect(res.rulesTruncated).toBe(5);
    expect(res.verdicts).toHaveLength(50);
  });
});
