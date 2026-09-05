/**
 * Adapter parity + bounded neighbor expansion.
 *
 * Two things this file locks down, both of which were real bugs:
 *
 * 1. SCORE CONVENTION / DIVERGENT ADAPTERS. The CLI-hosted `monograph_query`
 *    and the package-level `monograph_query` used to run different
 *    BM25/LIKE/fuzzy combinations, and the CLI's `MONOGRAPH_EMBEDDINGS=true`
 *    branch forwarded FTS5's *negative* `rank` straight into a ranker that
 *    takes maxima — so an unrelated neighbour sitting at 0 outranked a genuine
 *    match at -0.656. Both adapters now call the one `searchGraph` service and
 *    every score is higher-is-better.
 *
 * 2. NEIGHBOR EXPANSION. The one-hop expansion used to leak past the `label`
 *    filter and mislabel neighbour-boosted nodes as direct matches.
 *
 * Uses a real SQLite graph and the real @monoes/monograph — no mocks, because
 * mocking the retrieval layer would mock away the thing under test.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  insertEdge,
  insertNode,
  monographQueryTool as packageQueryTool,
  openDb,
  searchGraph,
} from '@monoes/monograph';

let repoDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb>;
const originalCwdEnv = process.env.MONOMIND_CWD;
const originalEmbeddingsEnv = process.env.MONOGRAPH_EMBEDDINGS;

// A corpus that exercises every query class the parity contract covers:
// short identifiers, multi-word phrases, and diacritics.
const nodes = [
  {
    id: 'fn_db_connect',
    label: 'Function',
    name: 'db',
    normLabel: 'db',
    filePath: 'src/db.ts',
    startLine: 3,
    isExported: true,
    language: 'typescript',
  },
  {
    id: 'cls_payment_processor',
    label: 'Class',
    name: 'PaymentProcessor',
    normLabel: 'paymentprocessor',
    filePath: 'src/payments/processor.ts',
    startLine: 10,
    isExported: true,
    language: 'typescript',
  },
  {
    id: 'fn_log_payment',
    label: 'Function',
    name: 'logPayment',
    normLabel: 'logpayment',
    filePath: 'src/payments/log.ts',
    startLine: 20,
    isExported: false,
    language: 'typescript',
  },
  {
    id: 'fn_naive_resolver',
    label: 'Function',
    name: 'naïveResolver',
    normLabel: 'naïveresolver',
    filePath: 'src/resolve.ts',
    startLine: 7,
    isExported: true,
    language: 'typescript',
  },
  {
    id: 'doc_payment_notes',
    label: 'Document',
    name: 'payment-notes.md',
    normLabel: 'payment-notes.md',
    filePath: 'doc/payment-notes.md',
    startLine: 1,
    isExported: false,
    language: 'markdown',
  },
];

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'mono-parity-'));
  mkdirSync(join(repoDir, '.monomind'), { recursive: true });
  dbPath = join(repoDir, '.monomind', 'monograph.db');
  db = openDb(dbPath);
  for (const n of nodes) insertNode(db, n as never);
  // PaymentProcessor → payment-notes.md: the edge that used to let a Document
  // escape a `label: Function` query via expansion.
  insertEdge(db, {
    id: 'e_proc_doc',
    sourceId: 'cls_payment_processor',
    targetId: 'doc_payment_notes',
    relation: 'REFERENCES',
    confidence: 'INFERRED',
    confidenceScore: 0.5,
  } as never);
  insertEdge(db, {
    id: 'e_proc_log',
    sourceId: 'cls_payment_processor',
    targetId: 'fn_log_payment',
    relation: 'CALLS',
    confidence: 'EXPLICIT',
    confidenceScore: 1,
  } as never);
  process.env.MONOMIND_CWD = repoDir;
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    /* best effort */
  }
  if (originalCwdEnv === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = originalCwdEnv;
  if (originalEmbeddingsEnv === undefined) delete process.env.MONOGRAPH_EMBEDDINGS;
  else process.env.MONOGRAPH_EMBEDDINGS = originalEmbeddingsEnv;
  rmSync(repoDir, { recursive: true, force: true });
});

/** Pull the node names out of the CLI adapter's rendered text, in rank order. */
function cliNames(rendered: string): string[] {
  return rendered
    .split('\n')
    .map((l) => /^\s+\[[^\]]+\]\s+(.+?)\s{2,}/.exec(l)?.[1])
    .filter((n): n is string => Boolean(n));
}

async function runCli(input: Record<string, unknown>): Promise<string> {
  const { monographQueryTool } = await import('../src/mcp-tools/monograph/query-tools.js');
  const out = await monographQueryTool.handler(input);
  return (out as { content: Array<{ text: string }> }).content[0].text;
}

// ── 1. Adapter parity ────────────────────────────────────────────────────────

describe('adapter parity: CLI-hosted and package-level monograph_query agree', () => {
  // `expectHits` guards the assertion from degrading into a vacuous [] === [].
  const cases: Array<{ label: string; query: string; expectHits: boolean }> = [
    { label: 'short identifier', query: 'db', expectHits: true },
    { label: 'exact symbol name', query: 'PaymentProcessor', expectHits: true },
    { label: 'phrase', query: 'payment processor', expectHits: true },
    { label: 'diacritics', query: 'naïveResolver', expectHits: true },
    // The FTS index is not diacritic-folded, so the stripped spelling finds
    // nothing — the contract is that BOTH adapters agree it finds nothing.
    { label: 'diacritics stripped', query: 'naiveResolver', expectHits: false },
    { label: 'no hits', query: 'zzzznotpresentzzzz', expectHits: false },
  ];

  for (const envValue of [undefined, 'true'] as const) {
    const envLabel = envValue === undefined ? 'MONOGRAPH_EMBEDDINGS unset' : 'MONOGRAPH_EMBEDDINGS=true';

    describe(envLabel, () => {
      beforeAll(() => {
        if (envValue === undefined) delete process.env.MONOGRAPH_EMBEDDINGS;
        else process.env.MONOGRAPH_EMBEDDINGS = envValue;
      });

      for (const { label, query, expectHits } of cases) {
        it(`returns the same ranking for ${label} ("${query}")`, async () => {
          const pkg = await packageQueryTool.handler({ query, topK: 10, db });
          const pkgNames = pkg.results.map((r) => r.name);

          const rendered = await runCli({ query, limit: 10, expandNeighbors: false });
          const names = rendered.startsWith('No results found.') ? [] : cliNames(rendered);

          // Guard: without this, an empty-vs-empty comparison would "pass"
          // even if retrieval were completely broken.
          if (expectHits) expect(pkgNames.length).toBeGreaterThan(0);
          else expect(pkgNames).toEqual([]);

          expect(names).toEqual(pkgNames);
        });
      }
    });
  }

  it('the removed MONOGRAPH_EMBEDDINGS branch no longer changes any result', async () => {
    delete process.env.MONOGRAPH_EMBEDDINGS;
    const off = await runCli({ query: 'PaymentProcessor', limit: 10, expandNeighbors: false });
    process.env.MONOGRAPH_EMBEDDINGS = 'true';
    const on = await runCli({ query: 'PaymentProcessor', limit: 10, expandNeighbors: false });
    delete process.env.MONOGRAPH_EMBEDDINGS;
    expect(on).toEqual(off);
  });

  it('finds a diacritic-bearing identifier by its literal spelling', async () => {
    // Regression: the query used to be diacritic-stripped while the index was
    // not, so `naïveResolver` could not find the symbol named `naïveResolver`.
    const pkg = await packageQueryTool.handler({ query: 'naïveResolver', topK: 10, db });
    expect(pkg.results.map((r) => r.name)).toContain('naïveResolver');
    const rendered = await runCli({ query: 'naïveResolver', limit: 10, expandNeighbors: false });
    expect(rendered).toContain('naïveResolver');
  });

  it('a no-hits query reports no results from both adapters', async () => {
    const pkg = await packageQueryTool.handler({ query: 'zzzznotpresentzzzz', topK: 10, db });
    expect(pkg.results).toEqual([]);
    const rendered = await runCli({ query: 'zzzznotpresentzzzz', limit: 10 });
    expect(rendered).toContain('No results found.');
  });
});

// ── 2. Score convention ──────────────────────────────────────────────────────

describe('score convention: higher is better, never negative', () => {
  it('searchGraph reports non-negative relevance in both modes', () => {
    for (const mode of ['bm25', 'hybrid'] as const) {
      const results = searchGraph(db, 'PaymentProcessor', { limit: 10, mode });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r.relevance).toBeGreaterThanOrEqual(0);
    }
  });

  it('a genuine match outranks an unrelated node — the reproduced inversion', () => {
    // Under the old convention the real hit scored ≈ -0.656 and lost to an
    // unrelated node at 0. Higher-is-better means the real hit must win.
    const results = searchGraph(db, 'PaymentProcessor', { limit: 10, mode: 'bm25' });
    const hit = results.find((r) => r.name === 'PaymentProcessor');
    expect(hit).toBeDefined();
    expect(hit?.relevance).toBeGreaterThan(0);
    for (const r of results) expect(hit?.relevance).toBeGreaterThanOrEqual(r.relevance);
  });

  it('results are sorted by descending relevance', () => {
    const results = searchGraph(db, 'payment', { limit: 10 });
    const scores = results.map((r) => r.relevance);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

// ── 3. Bounded, filter-preserving neighbor expansion ─────────────────────────

describe('neighbor expansion is bounded, filtered and honestly labelled', () => {
  it('reapplies the label filter after expansion (no off-label leak)', async () => {
    const rendered = await runCli({ query: 'payment', limit: 10, label: 'Function' });
    expect(rendered).not.toContain('[Document]');
    expect(rendered).not.toContain('payment-notes.md');
  });

  it('lists graph neighbors as supporting context, separate from direct matches', async () => {
    const rendered = await runCli({ query: 'PaymentProcessor', limit: 10 });
    expect(rendered).toContain('Direct matches');
    expect(rendered).toContain('Supporting context');
    // A neighbour must never be described as a query match.
    for (const line of rendered.split('\n')) {
      if (line.includes('payment-notes.md')) {
        expect(line).toContain('reached via graph neighbor');
        expect(line).not.toContain('direct');
      }
    }
  });

  it('does not report a neighbor-raised node as a plain direct match', async () => {
    const { expandWithNeighbors } = await import('../src/mcp-tools/monograph/shared.js');
    const seeds = [
      { id: 'cls_payment_processor', name: 'PaymentProcessor', label: 'Class', filePath: '', startLine: null, score: 1 },
      { id: 'fn_log_payment', name: 'logPayment', label: 'Function', filePath: '', startLine: null, score: 0.1 },
    ];
    const out = expandWithNeighbors(db, seeds, 0.5, 10);
    const raised = out.find((r) => r.id === 'fn_log_payment');
    // PaymentProcessor CALLS logPayment, so 1 * 0.5 = 0.5 beats its own 0.1.
    expect(raised?.score).toBeCloseTo(0.5);
    expect(raised?.scoreRaisedByNeighbors).toBe(true);
    expect(raised?.isSupportingContext).toBe(false);
  });

  it('marks true non-seed nodes as supporting context', async () => {
    const { expandWithNeighbors } = await import('../src/mcp-tools/monograph/shared.js');
    const seeds = [
      { id: 'cls_payment_processor', name: 'PaymentProcessor', label: 'Class', filePath: '', startLine: null, score: 1 },
    ];
    const out = expandWithNeighbors(db, seeds, 0.5, 10);
    const doc = out.find((r) => r.id === 'doc_payment_notes');
    expect(doc?.isSupportingContext).toBe(true);
    const seed = out.find((r) => r.id === 'cls_payment_processor');
    expect(seed?.isSupportingContext).toBe(false);
  });

  it('drops off-label neighbors when a label filter is supplied', async () => {
    const { expandWithNeighbors } = await import('../src/mcp-tools/monograph/shared.js');
    const seeds = [
      { id: 'cls_payment_processor', name: 'PaymentProcessor', label: 'Class', filePath: '', startLine: null, score: 1 },
    ];
    const out = expandWithNeighbors(db, seeds, 0.5, 10, { label: 'Function' });
    expect(out.every((r) => r.label === 'Function')).toBe(true);
    expect(out.some((r) => r.id === 'doc_payment_notes')).toBe(false);
  });

  it('validates the damping factor instead of propagating garbage', async () => {
    const { normalizeExpansionDamping, DEFAULT_EXPANSION_DAMPING, expandWithNeighbors } =
      await import('../src/mcp-tools/monograph/shared.js');
    expect(normalizeExpansionDamping(Number.NaN)).toBe(DEFAULT_EXPANSION_DAMPING);
    expect(normalizeExpansionDamping(Number.POSITIVE_INFINITY)).toBe(DEFAULT_EXPANSION_DAMPING);
    expect(normalizeExpansionDamping('0.7' as unknown)).toBe(DEFAULT_EXPANSION_DAMPING);
    expect(normalizeExpansionDamping(-5)).toBe(0);
    expect(normalizeExpansionDamping(42)).toBe(1);
    expect(normalizeExpansionDamping(0.25)).toBe(0.25);

    const seeds = [
      { id: 'cls_payment_processor', name: 'PaymentProcessor', label: 'Class', filePath: '', startLine: null, score: 1 },
    ];
    // NaN damping must not produce NaN scores.
    const out = expandWithNeighbors(db, seeds, Number.NaN, 10);
    for (const r of out) expect(Number.isFinite(r.score)).toBe(true);
  });

  it('caps how much supporting context expansion can add', async () => {
    const { expandWithNeighbors, MAX_SUPPORTING_NODES } = await import(
      '../src/mcp-tools/monograph/shared.js'
    );
    const seeds = [
      { id: 'cls_payment_processor', name: 'PaymentProcessor', label: 'Class', filePath: '', startLine: null, score: 1 },
    ];
    const out = expandWithNeighbors(db, seeds, 0.5, 10_000);
    const supporting = out.filter((r) => r.isSupportingContext);
    expect(supporting.length).toBeLessThanOrEqual(MAX_SUPPORTING_NODES);
  });
});
