// packages/@monomind/cli/src/__tests__/memory-retrieval-quality.test.ts
// Retrieval-quality golden set for the Second Brain memory path.
//
// Two tiers:
//  1. Always-run: tokenized keyword fallback + namespace scoping + persistence,
//     via the bridge with embeddings disabled (works in any CI).
//  2. Semantic tier: runs only when @huggingface/transformers and its local
//     model actually load — asserts paraphrase recall that keyword search
//     cannot deliver. Skipped (not faked) when the model is unavailable.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  bridgeStoreEntry,
  bridgeSearchEntries,
  bridgeGetDbPath,
} from '../memory/memory-bridge.js';

// The bridge resolves custom dbPaths through a traversal guard that only
// allows paths under cwd or the per-project data dir — so the fixture store
// must live inside cwd, not in os.tmpdir().
const FIXTURE_DIR = mkdtempSync(join(process.cwd(), '.tmp-retrieval-quality-'));

/** Golden set: notes written in one vocabulary, queried in another. */
const GOLDEN: Array<{ key: string; note: string; paraphrase: string; keywordQuery: string }> = [
  {
    key: 'anchoring-checkout',
    note: 'Anchoring effects in checkout flows: showing the annual price first makes the monthly price feel cheap.',
    paraphrase: 'that thing about pricing psychology in the purchase funnel',
    keywordQuery: 'anchoring checkout',
  },
  {
    key: 'mailbox-shutdown-race',
    note: 'Fixed the race where closing an agent mailbox during delivery silently dropped the message.',
    paraphrase: 'bug when shutting down agents while a message was in flight',
    keywordQuery: 'mailbox race',
  },
  {
    key: 'garden-soil-ph',
    note: 'Blueberries need acidic soil, pH between 4.5 and 5.5; add sulfur in autumn.',
    paraphrase: 'how to make the ground right for growing blueberries',
    keywordQuery: 'blueberries soil',
  },
  {
    key: 'grpc-deadline-propagation',
    note: 'Always propagate gRPC deadlines from the edge; per-hop fixed timeouts amplify tail latency.',
    paraphrase: 'why setting the same timeout on every service is bad',
    keywordQuery: 'grpc deadline',
  },
  {
    key: 'vitamin-d-winter',
    note: 'Take vitamin D supplements from October to March; food alone is not enough at this latitude.',
    paraphrase: 'what supplement to take during the dark months',
    keywordQuery: 'vitamin d winter',
  },
  {
    key: 'sourdough-hydration',
    note: 'Sourdough starter doubles fastest at 78F with 100% hydration; feed 1:1:1 every 12 hours.',
    paraphrase: 'how to keep the bread culture alive and active',
    keywordQuery: 'sourdough starter feed',
  },
  {
    key: 'landlord-deposit-law',
    note: 'The landlord must return the security deposit within 21 days of move-out or itemize deductions in writing.',
    paraphrase: 'when do I get my rental money back after leaving the apartment',
    keywordQuery: 'security deposit 21 days',
  },
  {
    key: 'espresso-dial-in',
    note: 'Dial in espresso at 1:2 ratio in 25-30 seconds; sour means grind finer, bitter means grind coarser.',
    paraphrase: 'my coffee shots taste off, how do I adjust the machine',
    keywordQuery: 'espresso grind ratio',
  },
  {
    key: 'toddler-sleep-regression',
    note: 'The 18-month sleep regression usually lasts 2-6 weeks; keep the bedtime routine identical and avoid new sleep crutches.',
    paraphrase: 'why has the baby suddenly stopped sleeping through the night',
    keywordQuery: 'sleep regression 18 month',
  },
  {
    key: 'kubernetes-oomkill',
    note: 'Pods OOMKilled with exit code 137: raise memory limits or fix the leak; requests too low cause node overcommit.',
    paraphrase: 'containers keep getting killed and restarting with code 137',
    keywordQuery: 'oomkilled 137 memory',
  },
  {
    key: 'tax-quarterly-estimates',
    note: 'Freelancers must pay quarterly estimated taxes by Apr 15, Jun 15, Sep 15, Jan 15 — safe harbor is 110% of last year.',
    paraphrase: 'as a self-employed person when do I have to send money to the IRS',
    keywordQuery: 'quarterly estimated taxes',
  },
  {
    key: 'strength-progressive-overload',
    note: 'Progressive overload: add 2.5kg or one rep each session; deload every 6-8 weeks when stalling.',
    paraphrase: 'how to keep getting stronger at the gym without plateauing',
    keywordQuery: 'progressive overload deload',
  },
  {
    key: 'car-timing-belt',
    note: 'Replace the timing belt at 100k km; on interference engines a snapped belt destroys the valves.',
    paraphrase: 'which engine part must be swapped before it wrecks everything',
    keywordQuery: 'timing belt interference',
  },
  {
    key: 'dns-ttl-migration',
    note: 'Before a server migration, lower DNS TTL to 300 seconds at least 48 hours in advance so the cutover propagates fast.',
    paraphrase: 'preparing name records ahead of moving to a new host',
    keywordQuery: 'dns ttl migration',
  },
  {
    key: 'visa-schengen-90-180',
    note: 'The Schengen rule allows 90 days in any rolling 180-day window; overstays are counted at exit and can trigger bans.',
    paraphrase: 'how long can I stay in Europe as a tourist without residency',
    keywordQuery: 'schengen 90 180',
  },
];

const NS = 'knowledge:golden';

describe('memory retrieval quality (Second Brain golden set)', () => {
  let semanticAvailable = false;

  beforeAll(async () => {
    for (const g of GOLDEN) {
      const res = await bridgeStoreEntry({
        key: g.key, value: g.note, namespace: NS, dbPath: FIXTURE_DIR, upsert: true,
      });
      expect(res?.success).toBe(true);
      if (res?.embedding) semanticAvailable = true;
    }
  }, 180_000);

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('persists the store on disk (survives process death, unlike pure in-memory WASM)', () => {
    expect(existsSync(join(bridgeGetDbPath(FIXTURE_DIR), 'memory.db'))).toBe(true);
  });

  it('keyword queries hit their note even with hyphen/space token differences', async () => {
    for (const g of GOLDEN) {
      const res = await bridgeSearchEntries({
        query: g.keywordQuery, namespace: NS, dbPath: FIXTURE_DIR, limit: 3,
      });
      expect(res?.success).toBe(true);
      const keys = (res?.results ?? []).map(r => r.key);
      expect(keys, `keyword query "${g.keywordQuery}" should surface ${g.key}`).toContain(g.key);
    }
  }, 120_000);

  it('regression: "semantic test" style queries match "semantic-test" style keys', async () => {
    await bridgeStoreEntry({ key: 'semantic-test', value: 'x', namespace: NS, dbPath: FIXTURE_DIR, upsert: true, generateEmbeddingFlag: false });
    const res = await bridgeSearchEntries({ query: 'semantic test', namespace: NS, dbPath: FIXTURE_DIR, limit: 10 });
    expect((res?.results ?? []).map(r => r.key)).toContain('semantic-test');
  }, 60_000);

  it('namespace scoping: results never leak across namespaces', async () => {
    await bridgeStoreEntry({ key: 'other-ns-note', value: 'blueberries acidic soil sulfur', namespace: 'knowledge:other', dbPath: FIXTURE_DIR, upsert: true });
    const res = await bridgeSearchEntries({ query: 'blueberries soil', namespace: NS, dbPath: FIXTURE_DIR, limit: 10 });
    expect((res?.results ?? []).every(r => r.namespace === NS)).toBe(true);
  }, 60_000);

  it('semantic tier: paraphrase queries recall the right note (requires local model)', async (ctx) => {
    if (!semanticAvailable) {
      ctx.skip(); // model not available in this environment — do not fake a pass
      return;
    }
    let hits = 0;
    for (const g of GOLDEN) {
      const res = await bridgeSearchEntries({
        query: g.paraphrase, namespace: NS, dbPath: FIXTURE_DIR, limit: 3, threshold: 0.2,
      });
      const keys = (res?.results ?? []).map(r => r.key);
      if (keys.includes(g.key)) hits++;
      expect(res?.searchMethod, `paraphrase "${g.paraphrase}" must use the vector path`).toBe('semantic');
    }
    // Recall@3 ≥ 80% on paraphrases — the bar that keyword search cannot meet.
    const bar = Math.floor(GOLDEN.length * 0.8);
    expect(hits, `paraphrase recall@3 was ${hits}/${GOLDEN.length} (bar: ${bar})`).toBeGreaterThanOrEqual(bar);
  }, 600_000);

  it('multi-chunk documents: a paraphrase targeting a deep section retrieves the right chunk', async (ctx) => {
    if (!semanticAvailable) { ctx.skip(); return; }
    const { chunkDocument } = await import('@monoes/memory');
    const doc = [
      '# Company handbook',
      '## Expense policy',
      'Meals under 50 euro need no receipt. Flights must be booked through the travel portal at least 14 days ahead. '.repeat(30),
      '## Parental leave',
      'Primary caregivers receive 16 weeks fully paid; secondary caregivers receive 6 weeks. Leave can be split into two blocks within the first year. '.repeat(30),
      '## Equipment refresh',
      'Laptops are replaced every 36 months; damaged screens are repaired within one week via the IT desk. '.repeat(30),
    ].join('\n\n');
    const chunks = chunkDocument('handbook', doc, 3200, 400);
    expect(chunks.length).toBeGreaterThan(3);
    const NS_DOC = 'knowledge:handbook';
    for (const c of chunks) {
      const res = await bridgeStoreEntry({ key: c.chunkId, value: c.text, namespace: NS_DOC, dbPath: FIXTURE_DIR, upsert: true });
      expect(res?.success).toBe(true);
    }
    const cases = [
      { query: 'how much time off do new parents get', mustContain: 'Parental leave' },
      { query: 'when can I get a new work laptop', mustContain: 'Equipment refresh' },
      { query: 'do I need to keep receipts for small business lunches', mustContain: 'Expense policy' },
    ];
    for (const c of cases) {
      const res = await bridgeSearchEntries({ query: c.query, namespace: NS_DOC, dbPath: FIXTURE_DIR, limit: 2, threshold: 0.15 });
      const texts = (res?.results ?? []).map(r => r.content).join('\n---\n');
      expect(texts, `"${c.query}" should surface the ${c.mustContain} section`).toContain(c.mustContain);
    }
  }, 600_000);
});

describe('global second brain (cross-project store)', () => {
  it('global-scope ingest routes to the global store; merged search finds it with [global] scope and project wins ties', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    // Env-overridden global brain — never touches the user's real one.
    const globalDir = join(process.cwd(), '.tmp-global-brain-' + process.pid);
    process.env.MONOMIND_GLOBAL_BRAIN_DIR = globalDir;
    const projRoot = mkdtempSync(join(process.cwd(), '.tmp-proj-root-'));
    try {
      const { ingestDocument, searchKnowledge } = await import('../knowledge/document-pipeline.js');
      // one doc only in the global brain
      const gDoc = join(projRoot, 'global-note.md');
      writeFileSync(gDoc, '# Espresso dialing\n\nSour shots need a finer grind; bitter shots need a coarser grind. Aim for 1:2 in 27 seconds.');
      const gRes = await ingestDocument(gDoc, 'global');
      expect(gRes.chunksIndexed).toBeGreaterThan(0);
      // an identical-topic doc in the project store
      mkdirSync(join(projRoot, '.monomind'), { recursive: true });
      const pDoc = join(projRoot, 'project-note.md');
      writeFileSync(pDoc, '# Espresso dialing\n\nSour shots need a finer grind; bitter shots need a coarser grind. Aim for 1:2 in 27 seconds.');
      const pRes = await ingestDocument(pDoc, 'shared', projRoot);
      expect(pRes.chunksIndexed).toBeGreaterThan(0);

      // merged search sees both; identical content → project must rank first (tie boost)
      const all = await searchKnowledge('adjusting espresso grind for sour shots', { rootDir: projRoot, limit: 5, minScore: 0.1, store: 'all' });
      expect(all.length).toBeGreaterThanOrEqual(2);
      const scopes = all.map(e => e.scope);
      expect(scopes).toContain('global');
      expect(scopes).toContain('shared');
      expect(all[0].scope).toBe('shared'); // project wins the tie

      // global-only search excludes project results
      const gOnly = await searchKnowledge('espresso grind', { rootDir: projRoot, limit: 5, minScore: 0.1, store: 'global' });
      expect(gOnly.every(e => e.scope === 'global')).toBe(true);
      expect(gOnly.length).toBeGreaterThan(0);
      // provenance: the global hit points at the actual source file
      expect(gOnly[0].filePath).toBe(gDoc);
    } finally {
      // The project-scope ingest stored into the CWD-keyed project store —
      // delete it so repo-level injection never surfaces test espresso notes.
      try {
        const { createHash } = await import('node:crypto');
        const { readFileSync } = await import('node:fs');
        const { bridgeDeleteEntry } = await import('../memory/memory-bridge.js');
        const h = createHash('sha256').update(readFileSync(join(projRoot, 'project-note.md'), 'utf8')).digest('hex');
        await bridgeDeleteEntry({ key: `doc:${h}:0`, namespace: 'knowledge:shared' });
      } catch { /* best effort */ }
      delete process.env.MONOMIND_GLOBAL_BRAIN_DIR;
      rmSync(globalDir, { recursive: true, force: true });
      rmSync(projRoot, { recursive: true, force: true });
    }
  }, 300_000);

  it('org daemon knowledge_search reports cleanly when no documents match', async () => {
    const { OrgDaemon } = await import('../orgrt/daemon.js');
    const root = mkdtempSync(join(process.cwd(), '.tmp-orgkn-'));
    try {
      const d = new OrgDaemon(root, { forward: false });
      const res = await d.searchProjectKnowledge('completely unmatchable zzqx query about nothing');
      expect(res.hits).toBe(0);
      expect(res.text).toMatch(/No matching documents/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});
