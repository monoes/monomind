// packages/@monomind/cli/src/__tests__/kg-eval-combined.test.ts
//
// K9 retrieval evaluation baseline — combined document/KG retrieval
// category (memory-KG next-steps handoff 2026-09-07, section 4.1). Split
// from kg-eval-retrieval.test.ts because `knowledge_search`'s MCP handler
// resolves its store internally (no `dbPath` in its input schema), so a
// real isolated backend isn't reachable the way kgSearch/kgIngest allow —
// this file uses the same mocked-bridge pattern as
// knowledge-retrieval-contract.test.ts instead, plus a mocked
// `searchKnowledge` (document-pipeline.js) so a document excerpt can exist
// without real file I/O.
//
// Synthetic-graph half of section 4.1 only — see kg-eval-retrieval.test.ts's
// header for why, and the baseline report for the deferred
// representative-question half.

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
    const limit = Math.min(o.limit ?? 100, 10_000);
    const offset = o.offset ?? 0;
    const entries = entriesIn(o.namespace ?? 'default').slice(offset, offset + limit);
    return { success: true, entries, total: entries.length };
  },
  bridgeDeleteEntry: async () => ({ success: true, deleted: false }),
  bridgeRecordUsage: async () => ({ success: true }),
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

/** Controlled per-test document excerpts, returned by the mocked
 *  `searchKnowledge` — real document ingestion needs real files and a
 *  resolvable rootDir `knowledge_search`'s handler doesn't expose, so this
 *  isolates the property under test (fusion behavior) from that machinery. */
let docExcerpts: { id: string; filePath: string; text: string; similarity: number }[] = [];
vi.mock('../knowledge/document-pipeline.js', () => ({
  searchKnowledge: async (query: string) => {
    const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
    return docExcerpts
      .filter((e) => tokens.some((t) => e.text.toLowerCase().includes(t)))
      .map((e, i) => ({ ...e, chunkIndex: 0, scope: 'shared', similarity: e.similarity ?? 0.8 - i * 0.01 }));
  },
}));

import { knowledgeTools } from '../mcp-tools/knowledge-tools.js';
import type { MCPToolResult } from '../mcp-tools/types.js';
import { kgIngest } from '../memory/memory-kg.js';

async function knowledgeSearch(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = knowledgeTools.find((t) => t.name === 'knowledge_search');
  if (!tool) throw new Error('knowledge_search is not registered');
  const res = (await tool.handler(input, {} as never)) as MCPToolResult;
  return JSON.parse(String(res.content[0].text));
}

interface SurfaceOutcome {
  surface: string;
  status: string;
  results?: number;
}
interface Retrieval {
  requested: string[];
  executed: string[];
  surfaces: SurfaceOutcome[];
}

interface EvalRow {
  id: string;
  metric: string;
  value: number;
  note: string;
}
const RESULTS: EvalRow[] = [];

beforeEach(() => {
  store.clear();
  idSeq = 0;
  docExcerpts = [];
});

describe('K9 baseline: combined document/KG retrieval', () => {
  it('cd1: a query with both a matching document excerpt and a matching KG fact surfaces both, fused', async () => {
    docExcerpts = [
      {
        id: 'doc-1',
        filePath: '/docs/runbook.md',
        text: 'Harbormaster is the deployment orchestrator for the edge fleet',
        similarity: 0.8,
      },
    ];
    await kgIngest({
      nodes: [{ name: 'Harbormaster', type: 'Service', description: 'edge fleet deployment orchestrator' }],
      edges: [],
      originRef: 'eval:cd1',
    });

    const res = await knowledgeSearch({ query: 'Harbormaster', surfaces: ['chunks', 'kg'] });
    const retrieval = res.retrieval as Retrieval;
    const results = res.results as { kind: string }[];

    const hasExcerpt = results.some((r) => r.kind === 'excerpt');
    const hasKg = results.some((r) => r.kind === 'entity' || r.kind === 'triplet');
    const bothSurfaced = hasExcerpt && hasKg ? 1 : 0;
    RESULTS.push({
      id: 'cd1-both-surfaces-present',
      metric: 'fusion-completeness',
      value: bothSurfaced,
      note: `kinds=${results.map((r) => r.kind).join(',')}`,
    });
    expect(bothSurfaced).toBe(1);
    expect(retrieval.executed).toEqual(expect.arrayContaining(['documents', 'memory_graph']));
  });

  it('cd2: a KG-only hit is not suppressed when the document surface is empty within a combined request', async () => {
    // No matching document excerpt — docExcerpts stays empty this test.
    await kgIngest({
      nodes: [{ name: 'Solitary Beacon', type: 'Service', description: 'graph-only entity, no document mentions it' }],
      edges: [],
      originRef: 'eval:cd2',
    });

    const res = await knowledgeSearch({ query: 'Solitary Beacon', surfaces: ['chunks', 'kg'] });
    const results = res.results as { kind: string; name?: string }[];
    const found = results.some((r) => r.kind === 'entity' && r.name === 'Solitary Beacon') ? 1 : 0;
    RESULTS.push({
      id: 'cd2-kg-not-suppressed-by-empty-docs',
      metric: 'correctness',
      value: found,
      note: `count=${res.count}`,
    });
    expect(found).toBe(1);
  });

  // eslint-disable-next-line vitest/expect-expect -- this test only reports the summary table
  it('prints the summary table for this category', () => {
    // eslint-disable-next-line no-console
    console.log('\n=== K9 baseline: combined document/KG retrieval ===');
    for (const r of RESULTS) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.id}: ${r.metric}=${r.value.toFixed(3)}  (${r.note})`);
    }
    const mean = RESULTS.reduce((s, r) => s + r.value, 0) / RESULTS.length;
    // eslint-disable-next-line no-console
    console.log(`  category mean: ${mean.toFixed(3)}`);
  });
});
