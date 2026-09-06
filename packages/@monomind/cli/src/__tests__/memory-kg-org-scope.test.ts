/**
 * Org ownership of memory knowledge-graph facts
 * (memory-KG review 2026-09-05 finding K2 / graph-boundaries finding B2).
 *
 * This is the MEMORY knowledge graph (entities/relations/rules on the memory
 * bridge), not the Monograph code graph.
 *
 * Every org under one project root shares ONE org-memory store, and the KG
 * used three fixed namespaces inside it with no org argument. The acceptance
 * case both reviews asked for is here: two orgs assert DIFFERENT facts about
 * the SAME entity name, and each rolls back independently.
 *
 * The memory bridge is replaced with a deterministic in-memory fake so the
 * namespace a call actually reached can be asserted directly — that is the
 * property under test, and a real backend only lets you observe it indirectly.
 * `learnOrgKnowledge` is driven through its real call chain (a stub daemon is
 * all it needs) so the assertions cover what the runtime does, not just what
 * memory-kg.ts is capable of.
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
  // orgMemoryUsable() checks the bridge did not redirect the org store path.
  bridgeGetDbPath: (p: string) => p,
  bridgeStoreEntry: async (o: {
    key: string;
    value: string;
    namespace?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    generateEmbeddingFlag?: boolean;
  }) => {
    const namespace = o.namespace ?? 'default';
    const id = `entry_${++idSeq}`;
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
    const limit = Math.min(o.limit ?? 100, 10_000);
    const offset = o.offset ?? 0;
    const entries = entriesIn(o.namespace ?? 'default').slice(offset, offset + limit);
    return { success: true, entries, total: entries.length };
  },
  bridgeDeleteEntry: async (o: { id?: string; namespace?: string }) => {
    const loc = o.id ? byId.get(o.id) : undefined;
    if (!loc) return { success: true, deleted: false };
    ns(loc.namespace).delete(loc.key);
    byId.delete(o.id as string);
    return { success: true, deleted: true };
  },
  /** Case-insensitive substring match, reported as a keyword (non-semantic)
   *  hit so rule dedup takes its exact-text path rather than a cosine one. */
  bridgeSearchEntries: async (o: { query: string; namespace?: string; limit?: number }) => {
    const q = o.query.trim().toLowerCase();
    const hits = entriesIn(o.namespace ?? 'default')
      .filter((e) => e.content.toLowerCase().includes(q) || q.includes(e.key.toLowerCase()))
      .slice(0, o.limit ?? 10);
    return {
      success: true,
      results: hits.map((h) => ({
        id: h.id,
        key: h.key,
        content: h.content,
        tags: h.tags,
        score: 1,
        provenance: 'keyword',
      })),
    };
  },
  bridgeRecordUsage: async () => ({ success: true }),
}));

import {
  kgGlossary,
  kgIngest,
  kgIngestRules,
  kgListRules,
  kgNamespaces,
  kgPromote,
  kgQualifyOrigin,
  kgRollback,
  kgSearch,
  kgStats,
  normalizeName,
} from '../memory/memory-kg.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import { learnOrgKnowledge, orgKgScope, orgMemoryDbPath } from '../orgrt/org-memory.js';

const ROOT = '/tmp/monomind-kg-scope-test';
const ALPHA = orgKgScope('alpha');
const BETA = orgKgScope('beta');
/** The one entity name both orgs use, with incompatible facts behind it. */
const SHARED_NAME = 'Ledger';
const ALPHA_FACT = 'Ledger is the double-entry accounting service owned by alpha';
const BETA_FACT = 'Ledger is the append-only audit log owned by beta';

function nodeIn(scope: { org?: string }, name: string): FakeEntry | undefined {
  return ns(kgNamespaces(scope).nodes).get(`n:${normalizeName(name)}`);
}

/** Minimal daemon surface `learnOrgKnowledge` touches. */
function stubDaemon(): OrgDaemon {
  return { root: ROOT, orgLearnedRuns: new Set<string>() } as unknown as OrgDaemon;
}

beforeEach(() => {
  store.clear();
  byId.clear();
  idSeq = 0;
});

describe('org ownership of memory KG facts', () => {
  it('keeps two orgs’ facts about the same entity name independent', async () => {
    const daemon = stubDaemon();
    // The real runtime path: the coordinator's org_learn payload.
    await learnOrgKnowledge(daemon, 'alpha', 'r1', {
      nodes: [{ name: SHARED_NAME, type: 'Service', description: ALPHA_FACT }],
    });
    await learnOrgKnowledge(daemon, 'beta', 'r1', {
      nodes: [{ name: SHARED_NAME, type: 'Service', description: BETA_FACT }],
    });

    // Identity is name-only, so BOTH orgs produce key `n:ledger`. Only the
    // namespace keeps them apart — unscoped, the second write overwrote the
    // first and one org silently inherited the other's fact.
    const a = nodeIn(ALPHA, SHARED_NAME);
    const b = nodeIn(BETA, SHARED_NAME);
    expect(a?.key).toBe('n:ledger');
    expect(b?.key).toBe('n:ledger');
    expect(a?.metadata.description).toBe(ALPHA_FACT);
    expect(b?.metadata.description).toBe(BETA_FACT);

    // Neither org wrote anything into the project-shared graph.
    expect(entriesIn(kgNamespaces().nodes)).toHaveLength(0);

    // Provenance names the org that asserted the claim, not just the run id —
    // `run:r1` alone is the same string in both orgs.
    expect(a?.metadata.origin_refs).toEqual(['org:alpha/run:r1']);
    expect(b?.metadata.origin_refs).toEqual(['org:beta/run:r1']);
  });

  it('rolls back one org without touching the other’s identically named claim', async () => {
    const daemon = stubDaemon();
    await learnOrgKnowledge(daemon, 'alpha', 'r1', {
      nodes: [{ name: SHARED_NAME, description: ALPHA_FACT }],
    });
    await learnOrgKnowledge(daemon, 'beta', 'r1', {
      nodes: [{ name: SHARED_NAME, description: BETA_FACT }],
    });

    // Exactly what `monomind org memory alpha rollback run:r1` runs.
    const res = await kgRollback({
      originRef: 'run:r1',
      scope: ALPHA,
      dbPath: orgMemoryDbPath(ROOT),
    });

    expect(res.success).toBe(true);
    expect(res.deleted).toBe(1);
    expect(nodeIn(ALPHA, SHARED_NAME)).toBeUndefined();
    // Beta never asserted alpha's ref and does not share alpha's namespace.
    expect(nodeIn(BETA, SHARED_NAME)?.metadata.description).toBe(BETA_FACT);
  });

  it('refuses to reach another org’s claim even when handed its qualified ref', async () => {
    const daemon = stubDaemon();
    await learnOrgKnowledge(daemon, 'beta', 'r1', {
      nodes: [{ name: SHARED_NAME, description: BETA_FACT }],
    });

    // An operator typing beta's full origin ref into alpha's command: the ref
    // is re-qualified under alpha and resolved in alpha's namespaces, so it
    // matches nothing rather than deleting beta's claim.
    const res = await kgRollback({
      originRef: 'org:beta/run:r1',
      scope: ALPHA,
      dbPath: orgMemoryDbPath(ROOT),
    });

    expect(res.success).toBe(true);
    expect(res.deleted).toBe(0);
    expect(nodeIn(BETA, SHARED_NAME)).toBeDefined();
  });

  it('scopes stats, glossary, rules and search to the asking org', async () => {
    const dbPath = orgMemoryDbPath(ROOT);
    await kgIngest({
      nodes: [{ name: 'AlphaOnly' }, { name: SHARED_NAME, description: ALPHA_FACT }],
      edges: [{ source: 'AlphaOnly', target: SHARED_NAME, relation: 'writes_to' }],
      originRef: 'run:r1',
      scope: ALPHA,
      dbPath,
    });
    await kgIngestRules({
      rules: [{ rule: 'Alpha closes the books on Fridays' }],
      originRef: 'run:r1',
      scope: ALPHA,
      dbPath,
    });
    await kgIngest({
      nodes: [{ name: 'BetaOnly' }, { name: SHARED_NAME, description: BETA_FACT }],
      edges: [{ source: 'BetaOnly', target: SHARED_NAME, relation: 'appends_to' }],
      originRef: 'run:r1',
      scope: BETA,
      dbPath,
    });
    await kgIngestRules({
      rules: [{ rule: 'Beta never truncates the audit log' }],
      originRef: 'run:r1',
      scope: BETA,
      dbPath,
    });

    const stats = await kgStats({ dbPath, scope: ALPHA });
    // Alpha's own two entities plus its rule node — not beta's.
    expect(stats.nodes).toBe(3);
    expect(stats.edges).toBe(1);
    expect(stats.rules).toBe(1);

    const glossary = await kgGlossary({ dbPath, scope: ALPHA });
    expect(glossary).toContain('AlphaOnly');
    expect(glossary).not.toContain('BetaOnly');

    const rules = await kgListRules({ dbPath, scope: ALPHA });
    expect(rules.map((r) => r.rule).join(' ')).toContain('Alpha closes the books');
    expect(rules.map((r) => r.rule).join(' ')).not.toContain('audit log');

    const search = await kgSearch({ query: SHARED_NAME, dbPath, scope: ALPHA, limit: 5 });
    expect(search.success).toBe(true);
    expect(search.context).toContain('AlphaOnly');
    expect(search.context).not.toContain('BetaOnly');
  });

  it('shares knowledge only through an explicit promotion, as an independent assertion', async () => {
    const dbPath = orgMemoryDbPath(ROOT);
    await kgIngest({
      nodes: [{ name: SHARED_NAME, description: ALPHA_FACT }],
      originRef: 'run:r1',
      scope: ALPHA,
      dbPath,
    });
    // Learning alone never reaches the shared graph.
    expect(nodeIn({}, SHARED_NAME)).toBeUndefined();

    const promoted = await kgPromote({ originRef: 'run:r1', from: ALPHA, dbPath });
    expect(promoted.success).toBe(true);
    expect(promoted.nodes).toBe(1);
    // The shared copy names the org that vouched for it.
    expect(promoted.promotedAs).toBe('promoted:org:alpha/run:r1');
    expect(nodeIn({}, SHARED_NAME)?.metadata.origin_refs).toEqual(['promoted:org:alpha/run:r1']);

    // Withdrawing the org's own claim leaves the shared one standing: the two
    // are separate assertions, so sharing is not undone by an internal cleanup.
    await kgRollback({ originRef: 'run:r1', scope: ALPHA, dbPath });
    expect(nodeIn(ALPHA, SHARED_NAME)).toBeUndefined();
    expect(nodeIn({}, SHARED_NAME)?.metadata.description).toBe(ALPHA_FACT);

    // …and the shared copy is withdrawn by its own ref.
    const undo = await kgRollback({ originRef: promoted.promotedAs, dbPath });
    expect(undo.deleted).toBe(1);
    expect(nodeIn({}, SHARED_NAME)).toBeUndefined();
  });

  it('leaves project-shared knowledge on the unscoped namespaces', async () => {
    // The MCP `memory_kg_*` surface passes no scope; it must keep writing where
    // it always did, or every existing project graph becomes unreachable.
    expect(kgNamespaces()).toEqual({ nodes: 'kg:nodes', edges: 'kg:edges', rules: 'rules' });
    expect(kgQualifyOrigin('session:abc')).toBe('session:abc');

    await kgIngest({ nodes: [{ name: 'ProjectWide' }], originRef: 'session:abc' });
    expect(ns('kg:nodes').get('n:projectwide')?.metadata.origin_refs).toEqual(['session:abc']);
  });
});
