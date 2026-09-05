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
    ns(namespace).set(o.key, {
      id,
      key: o.key,
      namespace,
      content: o.value,
      tags: o.tags ?? [],
      metadata: o.metadata ?? {},
      hasEmbedding: o.generateEmbeddingFlag !== false,
    });
    return { success: true, id };
  },
  bridgeGetEntry: async (o: { key: string; namespace?: string }) => {
    const e = ns(o.namespace ?? 'default').get(o.key);
    return e ? { success: true, found: true, entry: e } : { success: true, found: false };
  },
  bridgeListEntries: async (o: { namespace?: string }) => {
    const entries = entriesIn(o.namespace ?? 'default');
    return { success: true, entries, total: entries.length };
  },
  bridgeDeleteEntry: async (o: { id?: string; key?: string; namespace?: string }) => {
    const m = ns(o.namespace ?? 'default');
    for (const [k, e] of m) {
      if ((o.id && e.id === o.id) || (o.key && k === o.key)) {
        m.delete(k);
        return { success: true, deleted: true };
      }
    }
    return { success: true, deleted: false };
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
  KG_NODES_NS,
  kgIngest,
  kgIngestRules,
  kgRollback,
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
    idSeq = 0;
    failStoreWhen = null;
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
