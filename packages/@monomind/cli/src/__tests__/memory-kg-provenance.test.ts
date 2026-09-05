/**
 * Memory knowledge-graph write-result and provenance integrity
 * (knowledge-graph review 2026-09-05, finding 11).
 *
 * This is the MEMORY knowledge graph (entities/relations/rules on the memory
 * bridge), not the Monograph code graph.
 *
 * The memory bridge is replaced with a deterministic in-memory fake so the
 * three properties under test can be asserted exactly — a real backend cannot
 * be told to fail one specific write, and embedding-based rule dedup is not
 * reproducible enough to pin a "same rule from two origins" case on.
 *
 * Covers:
 *  - a rejected bridge write surfaces as failure, not silent success
 *  - a rule asserted by two origins survives rollback of the first
 *  - the same rule is gone once BOTH origins have been withdrawn
 *  - rollback and stats cover a namespace larger than one list page
 *
 * The fake enforces the bridge's real paging contract (limit/offset, and the
 * backend's own 10,000-row ceiling on a single call), which is what makes the
 * multi-page cases meaningful: a real backend cannot be asked to return
 * exactly the page boundaries these tests need.
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
let idSeq = 0;
/** Set to make the next matching store() reject, mimicking a backend refusal. */
let failStoreWhen: ((key: string, namespace: string) => boolean) | null = null;
/** Mirrors sql-backend.ts's MAX_QUERY_LIMIT — one list call can never exceed it. */
const BACKEND_MAX_ROWS = 10_000;
let listCalls: { namespace: string; limit?: number; offset?: number }[] = [];

/** id → location, so delete-by-id stays O(1) on the large fixtures below. */
const byId = new Map<string, { namespace: string; key: string }>();

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
    if (failStoreWhen?.(o.key, namespace))
      return { success: false, id: '', error: 'disk full (simulated)' };
    const id = `entry_${++idSeq}`;
    // Upsert replaces the row: the bridge stores a new id and drops the old one.
    const previous = ns(namespace).get(o.key);
    if (previous) byId.delete(previous.id);
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
    listCalls.push({ namespace: o.namespace ?? 'default', limit: o.limit, offset: o.offset });
    // The real backend clamps limit to MAX_QUERY_LIMIT (10,000) and defaults to
    // 100 — a caller cannot opt out of paging by asking for everything.
    const limit = Math.min(o.limit ?? 100, BACKEND_MAX_ROWS);
    const offset = o.offset ?? 0;
    const all = entriesIn(o.namespace ?? 'default');
    const entries = all.slice(offset, offset + limit);
    // `total` is the page length, exactly as the bridge reports it.
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
  // Rule dedup: exact-text match on the stored rule, reported as a keyword
  // (non-semantic) hit so kgIngestRules takes its exact-text comparison path.
  bridgeSearchEntries: async (o: { query: string; namespace?: string }) => {
    const hit = entriesIn(o.namespace ?? 'default').find(
      (e) => e.content.split('\n')[0].trim().toLowerCase() === o.query.trim().toLowerCase(),
    );
    return {
      success: true,
      results: hit
        ? [{ id: hit.id, key: hit.key, content: hit.content, score: 1, provenance: 'keyword' }]
        : [],
    };
  },
}));

import {
  KG_EDGES_NS,
  KG_NODES_NS,
  kgIngest,
  kgIngestRules,
  kgRollback,
  kgStats,
  normalizeName,
  RULES_NS,
} from '../memory/memory-kg.js';

const RULE = 'Always run the build before committing a refactor';

function ruleEntry() {
  return entriesIn(RULES_NS).find((e) => e.content.startsWith(RULE));
}
function ruleNode() {
  return entriesIn(KG_NODES_NS).find((e) => e.key === `n:${normalizeName(RULE)}`);
}

describe('memory KG write results and provenance', () => {
  beforeEach(() => {
    store.clear();
    byId.clear();
    idSeq = 0;
    failStoreWhen = null;
    listCalls = [];
  });

  it('reports a rejected bridge write as a failure instead of silent success', async () => {
    failStoreWhen = (key) => key === 'n:beta';

    const res = await kgIngest({
      nodes: [{ name: 'Alpha' }, { name: 'Beta' }],
      originRef: 'run:1',
    });

    expect(res.success).toBe(false);
    expect(res.failures?.join(' ')).toContain('n:beta');
    expect(res.error).toMatch(/failed/i);
    // The counter must describe what actually persisted, not what was asked for.
    expect(res.nodesAdded).toBe(1);
    expect(entriesIn(KG_NODES_NS).map((e) => e.key)).toEqual(['n:alpha']);
  });

  it('keeps a rule alive after rolling back one of its two supporting origins', async () => {
    const first = await kgIngestRules({ rules: [{ rule: RULE }], originRef: 'run:A' });
    expect(first.success).toBe(true);
    expect(first.accepted).toBe(1);

    // Same rule, independently asserted by a second run: deduplicated, but its
    // origin must still be recorded as support.
    const second = await kgIngestRules({ rules: [{ rule: RULE }], originRef: 'run:B' });
    expect(second.success).toBe(true);
    expect(second.verdicts[0].verdict).toBe('already_known');
    expect(ruleEntry()?.metadata.origin_refs).toEqual(['run:A', 'run:B']);
    expect(ruleNode()?.metadata.origin_refs).toEqual(['run:A', 'run:B']);

    const rollback = await kgRollback({ originRef: 'run:A' });
    expect(rollback.success).toBe(true);
    expect(rollback.deleted).toBe(0);
    expect(rollback.retained).toBeGreaterThan(0);

    // run:B still vouches for it, so the rule survives — with run:A withdrawn
    // from its support set rather than left behind as residue.
    expect(ruleEntry()?.metadata.origin_refs).toEqual(['run:B']);
    expect(ruleNode()?.metadata.origin_refs).toEqual(['run:B']);
  });

  it('deletes the rule once both supporting origins have been withdrawn', async () => {
    await kgIngestRules({ rules: [{ rule: RULE }], originRef: 'run:A' });
    await kgIngestRules({ rules: [{ rule: RULE }], originRef: 'run:B' });

    const a = await kgRollback({ originRef: 'run:A' });
    expect(a.success).toBe(true);
    expect(ruleEntry()).toBeDefined();

    const b = await kgRollback({ originRef: 'run:B' });
    expect(b.success).toBe(true);
    expect(b.deleted).toBeGreaterThan(0);

    // No origin still supports the claim, so nothing is left claiming it.
    expect(ruleEntry()).toBeUndefined();
    expect(ruleNode()).toBeUndefined();
  });
});

// ── Namespaces larger than one list page ────────────────────────────
//
// A single bridgeListEntries call cannot return more than the backend's
// 10,000-row ceiling, so these fixtures deliberately sit just past it: the
// capped implementation these tests replaced saw exactly 10,000 rows no matter
// how large the graph was, and reported success on a rollback that had never
// looked at the rest.

/** One row past the backend's single-call ceiling, plus a tail whose entries
 *  are reachable only by a second page. */
const BIG = BACKEND_MAX_ROWS + 50;
/** Entries at these indices get a second origin, so rollback must REWRITE them
 *  rather than delete. Both sit past the first page. */
const SHARED_FROM = BACKEND_MAX_ROWS + 10;

function bigNodeName(i: number): string {
  return `Node ${String(i).padStart(6, '0')}`;
}

/** Ingest BIG nodes under `run:big`; the tail also carries `run:other`. */
async function seedLargeGraph(): Promise<void> {
  // kgIngest caps each call at 500 nodes, so build the fixture in batches.
  for (let start = 0; start < BIG; start += 500) {
    const nodes: { name: string }[] = [];
    for (let i = start; i < Math.min(start + 500, BIG); i++) nodes.push({ name: bigNodeName(i) });
    const res = await kgIngest({ nodes, originRef: 'run:big' });
    expect(res.success).toBe(true);
  }
  const shared: { name: string }[] = [];
  for (let i = SHARED_FROM; i < BIG; i++) shared.push({ name: bigNodeName(i) });
  const res = await kgIngest({ nodes: shared, originRef: 'run:other' });
  expect(res.success).toBe(true);
}

describe('memory KG scans cover namespaces larger than one page', () => {
  beforeEach(() => {
    store.clear();
    byId.clear();
    idSeq = 0;
    failStoreWhen = null;
    listCalls = [];
  });

  it('withdraws an origin from every element, including those past the first page', async () => {
    await seedLargeGraph();
    expect(entriesIn(KG_NODES_NS)).toHaveLength(BIG);

    const res = await kgRollback({ originRef: 'run:big' });

    expect(res.success).toBe(true);
    expect(res.failures).toBeUndefined();
    // Everything backed only by run:big is gone; the shared tail survives.
    const sharedCount = BIG - SHARED_FROM;
    expect(res.deleted).toBe(BIG - sharedCount);
    expect(res.retained).toBe(sharedCount);

    const survivors = entriesIn(KG_NODES_NS);
    expect(survivors).toHaveLength(sharedCount);
    // The property that matters: NOTHING anywhere still claims run:big support.
    // The capped scan left every element past row 10,000 carrying it while
    // reporting the rollback succeeded.
    for (const e of survivors) expect(e.metadata.origin_refs).toEqual(['run:other']);

    // The scan really did page rather than ask for one oversized list.
    const nodePages = listCalls.filter((c) => c.namespace === KG_NODES_NS);
    expect(nodePages.length).toBeGreaterThan(1);
    expect(Math.max(...nodePages.map((c) => c.limit ?? 0))).toBeLessThanOrEqual(BACKEND_MAX_ROWS);
    expect(nodePages.some((c) => (c.offset ?? 0) > 0)).toBe(true);
  });

  it('reports real counts instead of the last page length', async () => {
    await seedLargeGraph();

    const stats = await kgStats();

    // `bridgeListEntries.total` is the returned page length, so the capped
    // implementation reported exactly BACKEND_MAX_ROWS here forever.
    expect(stats.nodes).toBe(BIG);
    expect(stats.edges).toBe(0);
    expect(entriesIn(KG_EDGES_NS)).toHaveLength(0);
  });
});
