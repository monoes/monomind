/**
 * One retrieval contract across the surfaces `knowledge search` fronts
 * (graph-boundaries review B3; memory-KG review K6 and the org side of K1).
 *
 * Vocabulary, per the boundaries report: "Monograph code graph" is parsed
 * code, "memory knowledge graph" is remembered claims, "Second Brain document
 * index" is document excerpts. `knowledge search` is a retrieval INTERFACE
 * over some of them — never a store.
 *
 * The four defects reproduced here:
 *
 *  1. An isolated entity in the memory knowledge graph was invisible through
 *     MCP `knowledge_search` with `surfaces:['kg']` — the fusion layer took
 *     `triplets` and dropped `seeds`, so a graph with one standalone entity
 *     answered zero.
 *  2. `org_recall` reached the org knowledge graph only AFTER flat-memory
 *     retrieval returned something; an org whose knowledge lived only in the
 *     graph was told nothing was found.
 *  3. "what calls X" scored for `kg` — the MEMORY graph — so a code-dependency
 *     question was answered from remembered assertions, and nothing in the
 *     answer said code was never searched.
 *  4. `learnOrgKnowledge` formatted "Recorded" and marked the run learned
 *     without reading the write result, which also suppressed the end-of-run
 *     heuristic fallback.
 *
 * The memory bridge is a deterministic in-memory fake (same approach as
 * memory-kg-org-scope.test.ts) so a store failure can be injected and the
 * namespace a call reached can be asserted directly.
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
const byId = new Map<string, { namespace: string; key: string }>();
let idSeq = 0;
/** Flipped on to make every write fail, the way a full or read-only store does. */
let writesFail = false;

function ns(namespace: string): Map<string, FakeEntry> {
  let m = store.get(namespace);
  if (!m) store.set(namespace, (m = new Map()));
  return m;
}
function entriesIn(namespace: string): FakeEntry[] {
  return [...ns(namespace).values()];
}

vi.mock('../memory/memory-bridge.js', () => ({
  bridgeGetDbPath: (p: string) => p,
  getProjectRoot: () => process.cwd(),
  bridgeStoreEntry: async (o: {
    key: string;
    value: string;
    namespace?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) => {
    if (writesFail) return { success: false, error: 'store is read-only' };
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
  bridgeDeleteEntry: async () => ({ success: true, deleted: false }),
  bridgeRecordUsage: async () => ({ success: true }),
  /** Case-insensitive token overlap, reported honestly as a keyword hit —
   *  which is exactly what the contract must be able to say out loud. */
  bridgeSearchEntries: async (o: { query: string; namespace?: string; limit?: number }) => {
    const tokens = o.query.toLowerCase().split(/\W+/).filter(Boolean);
    const hits = entriesIn(o.namespace ?? 'default')
      .filter((e) => tokens.some((t) => e.content.toLowerCase().includes(t)))
      .slice(0, o.limit ?? 10);
    return {
      success: true,
      searchTime: 0,
      searchMethod: 'keyword-fallback' as const,
      fallbackReason: 'no-embedding-model' as const,
      results: hits.map((h) => ({
        id: h.id,
        key: h.key,
        namespace: h.namespace,
        content: h.content,
        tags: h.tags,
        score: 0.9,
        provenance: 'keyword',
      })),
    };
  },
}));

import { knowledgeTools } from '../mcp-tools/knowledge-tools.js';
import type { MCPToolResult } from '../mcp-tools/types.js';
import { kgIngest } from '../memory/memory-kg.js';
import { routeQuery } from '../memory/query-router.js';
import type { OrgDaemon } from '../orgrt/daemon.js';
import {
  learnOrgKnowledge,
  orgKgScope,
  orgMemoryDbPath,
  recallOrgMemory,
  searchProjectKnowledge,
} from '../orgrt/org-memory.js';
import type { OrgDef } from '../orgrt/types.js';

const ROOT = '/tmp/monomind-retrieval-contract-test';
const DEF = { goal: 'ship it', run_config: {} } as unknown as OrgDef;

function stubDaemon(): OrgDaemon {
  return {
    root: ROOT,
    orgLearnedRuns: new Set<string>(),
    recallUsage: new Map<string, Set<string>>(),
  } as unknown as OrgDaemon;
}

async function knowledgeSearch(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = knowledgeTools.find((t) => t.name === 'knowledge_search');
  if (!tool) throw new Error('knowledge_search is not registered');
  const res = (await tool.handler(input, {} as never)) as MCPToolResult;
  return JSON.parse(String(res.content[0].text));
}

interface SurfaceOutcome {
  surface: string;
  status: string;
  method?: string;
  results?: number;
  detail?: string;
}
interface Retrieval {
  requested: string[];
  executed: string[];
  failed: string[];
  unsupported: string[];
  surfaces: SurfaceOutcome[];
}

beforeEach(() => {
  store.clear();
  byId.clear();
  idSeq = 0;
  writesFail = false;
});

describe('a standalone entity is reachable through the surface that claims to search it', () => {
  it('returns an isolated entity from knowledge_search surfaces:[kg]', async () => {
    // One entity, zero relations — the exact shape the review reproduced.
    const ingest = await kgIngest({
      nodes: [
        {
          name: 'Kestrel',
          type: 'Service',
          description: 'Kestrel is the standalone billing reconciliation service',
        },
      ],
      originRef: 'test:isolated',
    });
    expect(ingest.success).toBe(true);
    expect(ingest.nodesAdded).toBe(1);

    const res = await knowledgeSearch({ query: 'Kestrel reconciliation', surfaces: ['kg'] });

    expect(res.success).toBe(true);
    // Before the fix this was 0: fusion consumed `triplets` only.
    expect(res.count as number).toBeGreaterThan(0);
    const results = res.results as { kind: string; name?: string }[];
    expect(results.some((r) => r.kind === 'entity' && r.name === 'Kestrel')).toBe(true);
  });

  it('reports the memory knowledge graph as executed, not empty, when it answered', async () => {
    await kgIngest({
      nodes: [{ name: 'Kestrel', description: 'Kestrel handles billing reconciliation' }],
      originRef: 'test:isolated',
    });
    const res = await knowledgeSearch({ query: 'Kestrel reconciliation', surfaces: ['kg'] });
    const retrieval = res.retrieval as Retrieval;
    expect(retrieval.executed).toContain('memory_graph');
    const kgOutcome = retrieval.surfaces.find((s) => s.surface === 'memory_graph');
    expect(kgOutcome?.status).toBe('executed');
    expect(kgOutcome?.results as number).toBeGreaterThan(0);
  });
});

describe('a result states which surfaces actually ran', () => {
  it('names requested, executed and unsupported surfaces', async () => {
    const res = await knowledgeSearch({ query: 'anything at all', surfaces: ['rules', 'memory'] });
    const retrieval = res.retrieval as Retrieval;

    expect(retrieval.requested).toEqual(expect.arrayContaining(['rules', 'memory', 'code_graph']));
    expect(retrieval.executed).toEqual(expect.arrayContaining(['rules', 'memory']));
    // Documents were not part of this route and must not be claimed.
    expect(retrieval.executed).not.toContain('documents');
    expect(retrieval.unsupported).toContain('code_graph');
  });

  it('propagates the bridge’s real retrieval method instead of flattening it', async () => {
    const res = await knowledgeSearch({ query: 'anything at all', surfaces: ['rules'] });
    const rules = (res.retrieval as Retrieval).surfaces.find((s) => s.surface === 'rules');
    // The bridge said keyword-fallback; presenting that as vector-seeded search
    // is the dishonesty K6 called out.
    expect(rules?.method).toBe('keyword-fallback');
  });

  it('states the memory graph’s retrieval method too, not just the flat surfaces', async () => {
    await kgIngest({
      nodes: [{ name: 'Kestrel', description: 'Kestrel handles billing reconciliation' }],
      originRef: 'test:method',
    });
    const res = await knowledgeSearch({ query: 'Kestrel reconciliation', surfaces: ['kg'] });
    const kg = (res.retrieval as Retrieval).surfaces.find((s) => s.surface === 'memory_graph');
    // The graph seeds through the same bridge, so it inherits the same answer —
    // this surface used to be the one that left `method` unstated.
    expect(kg?.method).toBe('keyword-fallback');
  });
});

describe('code-dependency questions', () => {
  it('does not route "what calls X" to the memory knowledge graph', () => {
    const route = routeQuery('what calls the scheduler');
    expect(route.codeQuery).toBe(true);
    // The memory graph holds remembered claims, not parsed code — it must not
    // win this query outright.
    expect(route.confident && route.surfaces[0] === 'kg').toBe(false);
  });

  it.each([
    'what imports the org daemon',
    'who calls kgSearch',
    'find the callers of routeQuery',
    'dependencies of memory-bridge',
    'impact of renaming kgIngest',
  ])('classifies %s as a code question', (q) => {
    expect(routeQuery(q).codeQuery).toBe(true);
  });

  it('leaves genuine memory-graph questions alone', () => {
    expect(routeQuery('how does the billing service relate to the ledger').codeQuery).toBe(false);
    // Negated mentions must not trigger it either.
    expect(routeQuery('notes that do not describe what calls it').codeQuery).toBe(false);
  });

  it('states that the Monograph code graph was not searched, and points at it', async () => {
    const res = await knowledgeSearch({ query: 'what calls the scheduler' });
    expect((res.routing as { codeQuery: boolean }).codeQuery).toBe(true);
    const code = (res.retrieval as Retrieval).surfaces.find((s) => s.surface === 'code_graph');
    expect(code?.status).toBe('unsupported');
    expect(String(code?.detail)).toMatch(/monograph_/);
  });
});

describe('org recall searches flat memory and the org knowledge graph independently', () => {
  it('finds knowledge-graph facts when flat org memory is empty', async () => {
    const daemon = stubDaemon();
    await learnOrgKnowledge(daemon, 'alpha', 'r1', {
      nodes: [
        { name: 'Peregrine', type: 'Policy', description: 'Peregrine caps refunds at 40 percent' },
      ],
    });
    // Nothing was ever written to the org's flat namespace.
    expect(entriesIn('org:alpha')).toHaveLength(0);

    const res = await recallOrgMemory(daemon, 'alpha', DEF, 'Peregrine refunds');

    // Before the fix the empty flat result returned early and this read
    // "No matching org memory found".
    expect(res.hits).toBeGreaterThan(0);
    expect(res.text).toContain('Peregrine');
    expect(res.text).toContain('Knowledge graph');
  });

  it('still merges both surfaces when flat memory does have a hit', async () => {
    const daemon = stubDaemon();
    const { bridgeStoreEntry } = await import('../memory/memory-bridge.js');
    await bridgeStoreEntry({
      key: 'run-r0',
      value: 'Peregrine rollout was paused last quarter',
      namespace: 'org:alpha',
      dbPath: orgMemoryDbPath(ROOT),
    });
    await learnOrgKnowledge(daemon, 'alpha', 'r1', {
      nodes: [{ name: 'Peregrine', description: 'Peregrine caps refunds at 40 percent' }],
    });

    const res = await recallOrgMemory(daemon, 'alpha', DEF, 'Peregrine refunds rollout');
    expect(res.text).toContain('rollout was paused');
    expect(res.text).toContain('Knowledge graph');
  });

  it('says nothing was found only when neither surface found anything', async () => {
    const res = await recallOrgMemory(stubDaemon(), 'alpha', DEF, 'zzqx unmatchable');
    expect(res.hits).toBe(0);
    expect(res.text).toMatch(/No matching org memory or knowledge-graph facts/);
  });

  it('records the graph seeds it answered from, so the run can reinforce them', async () => {
    const daemon = stubDaemon();
    await learnOrgKnowledge(daemon, 'alpha', 'r1', {
      nodes: [{ name: 'Peregrine', description: 'Peregrine caps refunds at 40 percent' }],
    });
    const seed = entriesIn('kg:nodes:org:alpha').find((e) => e.metadata.name === 'Peregrine');

    const res = await recallOrgMemory(daemon, 'alpha', DEF, 'Peregrine refunds');

    expect(res.hits).toBeGreaterThan(0);
    // Only flat-memory ids were recorded before, so a run that succeeded on a
    // graph fact never rated the fact it actually used.
    expect([...(daemon.recallUsage.get('alpha') ?? [])]).toContain(seed?.id);
  });

  it('scopes the graph read to the asking org', async () => {
    const daemon = stubDaemon();
    await learnOrgKnowledge(daemon, 'beta', 'r1', {
      nodes: [{ name: 'Peregrine', description: 'Peregrine caps refunds at 40 percent' }],
    });
    // alpha asks the same question; beta's claim is in beta's namespaces.
    const res = await recallOrgMemory(daemon, 'alpha', DEF, 'Peregrine refunds');
    expect(res.hits).toBe(0);
    expect(orgKgScope('beta')).toEqual({ org: 'beta' });
  });
});

describe('the org document-search tool says which surface it searched', () => {
  it('names the document index and the surfaces it did not read', async () => {
    const res = await searchProjectKnowledge(ROOT, 'zzqx nothing matches this');
    expect(res.text).toMatch(/Second Brain document index/);
    expect(res.text).toMatch(/org_recall/);
    expect(res.text).toMatch(/monograph_/);
  });
});

describe('org_learn reports what actually persisted', () => {
  it('marks the run learned and says Recorded when the writes landed', async () => {
    const daemon = stubDaemon();
    const text = await learnOrgKnowledge(daemon, 'alpha', 'r1', {
      nodes: [{ name: 'Kestrel', description: 'Kestrel reconciles billing' }],
    });
    expect(text).toMatch(/^Recorded in org knowledge graph/);
    expect(daemon.orgLearnedRuns.has('alpha:r1')).toBe(true);
  });

  it('does not claim Recorded — or mark the run learned — when the store refused', async () => {
    const daemon = stubDaemon();
    writesFail = true;
    const text = await learnOrgKnowledge(daemon, 'alpha', 'r1', {
      nodes: [{ name: 'Kestrel', description: 'Kestrel reconciles billing' }],
      rules: [{ rule: 'always reconcile before invoicing' }],
    });

    expect(text).not.toMatch(/^Recorded/);
    expect(text).toMatch(/Partially recorded/);
    expect(text).toMatch(/read-only/);
    // Suppressing the heuristic fallback is the harm: without the run being
    // left unlearned, storeRunMemory would skip extraction too.
    expect(daemon.orgLearnedRuns.has('alpha:r1')).toBe(false);
    // The counters must describe only what persisted — which is nothing.
    expect(text).toMatch(/entities: \+0 new/);
  });
});
