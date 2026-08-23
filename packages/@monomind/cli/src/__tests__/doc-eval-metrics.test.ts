// packages/@monomind/cli/src/__tests__/doc-eval-metrics.test.ts
//
// The scoreboard is the arbiter of this project's goal, so its arithmetic is
// pinned against a HAND-WORKED example below. If these numbers ever change,
// every historical scoreboard row becomes incomparable.
import { describe, expect, it } from 'vitest';
import { assignSplits, GOLDEN_SET, pairsForSplit } from '../knowledge/eval/golden-set.js';
import {
  aggregate,
  assessTriviality,
  buildIdf,
  dedupeByDoc,
  idfOverlap,
  scoreQuery,
  terciles,
} from '../knowledge/eval/metrics.js';
import { installNetworkGuard } from '../knowledge/eval/network-guard.js';
import { Bm25Retriever, RandomRetriever } from '../knowledge/eval/retrievers.js';

const rank = (ids: string[]) =>
  ids.map((docId, i) => ({ docId, score: 1 - i / 100, chunkIndex: 0 }));

describe('eval metrics — hand-worked example', () => {
  // Q1: one relevant doc, found at rank 3.
  //     R@1 = 0/1 = 0      R@5 = 1/1 = 1      R@10 = 1      RR = 1/3
  const q1 = scoreQuery({
    queryId: 'q1',
    query: 'q1',
    relevant: ['a.md'],
    ranked: rank(['x.md', 'y.md', 'a.md', 'z.md', 'w.md', 'p.md', 'q.md', 'r.md', 's.md', 't.md']),
    latencyMs: 10,
  });
  // Q2: two relevant docs, at ranks 1 and 6.
  //     R@1 = 1/2 = 0.5    R@5 = 1/2 = 0.5    R@10 = 2/2 = 1    RR = 1/1 = 1
  const q2 = scoreQuery({
    queryId: 'q2',
    query: 'q2',
    relevant: ['b.md', 'c.md'],
    ranked: rank(['b.md', 'p.md', 'q.md', 'r.md', 's.md', 'c.md', 't.md', 'u.md', 'v.md', 'w.md']),
    latencyMs: 20,
  });
  // Q3: relevant doc absent from the top 10 entirely.
  //     R@k = 0 everywhere   RR = 0 (a miss contributes zero, it is not dropped)
  const q3 = scoreQuery({
    queryId: 'q3',
    query: 'q3',
    relevant: ['zz.md'],
    ranked: rank(['1.md', '2.md', '3.md', '4.md', '5.md', '6.md', '7.md', '8.md', '9.md', '10.md']),
    latencyMs: 30,
  });

  it('scores each query exactly as worked by hand', () => {
    expect(q1.recallAt[1]).toBe(0);
    expect(q1.recallAt[5]).toBe(1);
    expect(q1.firstRelevantRank).toBe(3);
    expect(q1.reciprocalRank).toBeCloseTo(1 / 3, 10);

    expect(q2.recallAt[1]).toBe(0.5);
    expect(q2.recallAt[5]).toBe(0.5);
    expect(q2.recallAt[10]).toBe(1);
    expect(q2.reciprocalRank).toBe(1);

    expect(q3.recallAt[10]).toBe(0);
    expect(q3.firstRelevantRank).toBeNull();
    expect(q3.reciprocalRank).toBe(0);
  });

  it('aggregates to the hand-computed macro averages', () => {
    const s = aggregate([q1, q2, q3]);
    expect(s.queries).toBe(3);
    expect(s.recallAt1).toBeCloseTo((0 + 0.5 + 0) / 3, 10); // 0.16667
    expect(s.recallAt5).toBeCloseTo((1 + 0.5 + 0) / 3, 10); // 0.50000
    expect(s.recallAt10).toBeCloseTo((1 + 1 + 0) / 3, 10); // 0.66667
    expect(s.mrrAt10).toBeCloseTo((1 / 3 + 1 + 0) / 3, 10); // 0.44444
    expect(s.totalMisses).toBe(1);
    expect(s.hitRateAt5).toBeCloseTo(2 / 3, 10);
    expect(s.latencyMsP50).toBe(20);
  });

  it('a relevant doc at rank 11 is a miss, not a partial credit', () => {
    const q = scoreQuery({
      queryId: 'q',
      query: 'q',
      relevant: ['late.md'],
      ranked: rank([...Array.from({ length: 10 }, (_, i) => `f${i}.md`), 'late.md']),
      latencyMs: 1,
    });
    expect(q.firstRelevantRank).toBeNull();
    expect(q.reciprocalRank).toBe(0);
    expect(q.recallAt[10]).toBe(0);
  });

  it('dedupes to one entry per document, keeping the best-ranked chunk', () => {
    const out = dedupeByDoc(
      [
        { docId: 'a.md', score: 0.9, chunkIndex: 3 },
        { docId: 'a.md', score: 0.8, chunkIndex: 1 },
        { docId: 'b.md', score: 0.7, chunkIndex: 0 },
      ],
      10,
    );
    expect(out.map((o) => o.docId)).toEqual(['a.md', 'b.md']);
    expect(out[0].chunkIndex).toBe(3);
  });
});

describe('anti-triviality guard', () => {
  const doc =
    'The landlord must return the security deposit within 21 days of move-out or itemize deductions in writing.';

  it('flags a query lifted near-verbatim from the target', () => {
    const t = assessTriviality('return the security deposit within 21 days', doc);
    expect(t.maxContiguousRun).toBeGreaterThanOrEqual(4);
    expect(t.trivial).toBe(true);
  });

  it('passes a genuine paraphrase that shares no run of wording', () => {
    const t = assessTriviality(
      'when do I get my rental money back after leaving the apartment',
      doc,
    );
    expect(t.trivial).toBe(false);
  });

  it('the shipped golden set survives its own guard for most pairs', async () => {
    const { buildCorpus, readDoc } = await import('../knowledge/eval/corpus.js');
    const corpus = buildCorpus(process.cwd());
    const byId = new Map(corpus.docs.map((d) => [d.id, d]));
    let trivial = 0;
    for (const p of GOLDEN_SET) {
      for (const r of p.relevant) {
        const d = byId.get(r);
        // Every golden id must exist in the corpus — a dangling id is a fake number.
        expect(d, `golden pair ${p.id} references missing doc ${r}`).toBeDefined();
        if (assessTriviality(p.query, readDoc(d!)).trivial) {
          trivial++;
          break;
        }
      }
    }
    // Not zero-tolerance: the harness drops these. This asserts the set is not
    // mostly string matching dressed up as retrieval.
    expect(trivial / GOLDEN_SET.length).toBeLessThan(0.25);
  }, 120_000);
});

describe('IDF-weighted overlap', () => {
  it('rates a rare-term match far above a common-term match', () => {
    const corpus = [
      'the system handles the request and the system returns the response',
      'the system handles the request and the system returns the response',
      'the system handles the request and the system returns the response',
      'bitemporal invalidation supersedes an earlier assertion',
    ];
    const idf = buildIdf(corpus);
    // Each query has one term present in the doc and one absent. The only
    // difference is whether the PRESENT term is rare or common.
    const rarePresent = idfOverlap(idf, 'bitemporal system', corpus[3]); // rare hit, common miss
    const commonPresent = idfOverlap(idf, 'system bitemporal', corpus[0]); // common hit, rare miss
    expect(rarePresent).toBeGreaterThan(commonPresent);
    expect(commonPresent).toBeLessThan(0.5);
  });
});

describe('sealed dev/test split', () => {
  it('is deterministic across calls', () => {
    const a = assignSplits();
    const b = assignSplits();
    for (const [id, s] of a) expect(b.get(id)).toBe(s);
  });

  it('is roughly 70/30 and partitions the set exactly once', () => {
    const dev = pairsForSplit('dev');
    const test = pairsForSplit('test');
    expect(dev.length + test.length).toBe(GOLDEN_SET.length);
    expect(new Set([...dev, ...test].map((p) => p.id)).size).toBe(GOLDEN_SET.length);
    const share = test.length / GOLDEN_SET.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.4);
  });

  it('stratifies: every tag present in the set appears in both splits when it has >= 4 pairs', () => {
    // Threshold is 4, not 3: with TEST_SHARE=0.3 and a per-id hash split,
    // a 3-item group has 0.7^3 ≈ 34% odds of landing zero items in `test` —
    // not rare enough to treat as a guarantee. 'domain' shrank to exactly 3
    // after the mastermind skill-deletion cleanup and hit that gap for real
    // (deterministically, since the hash is a pure function of id — not a
    // one-off flake). The next-smallest group is 5, comfortably clear either way.
    const tagsOf = (ps: typeof GOLDEN_SET) => new Set(ps.map((p) => p.tags?.[0] ?? 'untagged'));
    const counts = new Map<string, number>();
    for (const p of GOLDEN_SET) {
      const t = p.tags?.[0] ?? 'untagged';
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const devTags = tagsOf(pairsForSplit('dev'));
    const testTags = tagsOf(pairsForSplit('test'));
    for (const [tag, n] of counts) {
      if (n < 4) continue;
      expect(devTags.has(tag), `tag ${tag} missing from dev`).toBe(true);
      expect(testTags.has(tag), `tag ${tag} missing from test`).toBe(true);
    }
  });
});

describe('weak baselines', () => {
  const chunks = [
    { docId: 'a.md', chunkIndex: 0, text: 'reciprocal rank fusion merges two ranked lists' },
    {
      docId: 'b.md',
      chunkIndex: 0,
      text: 'sourdough starter doubles fastest at seventy eight degrees',
    },
    {
      docId: 'c.md',
      chunkIndex: 0,
      text: 'the timing belt must be replaced before it destroys the valves',
    },
  ];

  it('BM25 ranks the lexically matching chunk first', async () => {
    const hits = await new Bm25Retriever(chunks).search('rank fusion merging lists', 3);
    expect(hits[0].docId).toBe('a.md');
  });

  it('random retrieval is deterministic for the same query and corpus', async () => {
    const r = new RandomRetriever(chunks);
    const a = await r.search('anything', 3);
    const b = await r.search('anything', 3);
    expect(a.map((h) => h.docId)).toEqual(b.map((h) => h.docId));
  });
});

describe('network guard', () => {
  it('blocks and records a fetch attempt rather than allowing it', async () => {
    const g = installNetworkGuard();
    try {
      // Throws synchronously — the call never leaves the process.
      expect(() => (globalThis as any).fetch('https://example.com')).toThrow(
        /BLOCKED network call/,
      );
    } finally {
      g.release();
    }
    expect(g.attempts.length).toBe(1);
    expect(g.attempts[0].api).toBe('fetch');
  });

  it('blocks the universal socket chokepoint, so no import style can slip past', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const net = req('node:net');
    const g = installNetworkGuard();
    try {
      // The defect this test exists for: the first version assigned onto ESM
      // namespace objects, which are non-configurable. It threw, was never
      // exercised, and the offline "proof" would have proven nothing.
      expect(g.unpatched, `guard left entry points unpatched: ${g.unpatched.join(', ')}`).toEqual(
        [],
      );
      // Prototype patch: bites regardless of how the caller obtained `net`.
      expect(() => new net.Socket().connect(80, 'example.com')).toThrow(/BLOCKED network call/);
      expect(() => req('node:http').request('http://example.com')).toThrow(/BLOCKED network call/);
    } finally {
      g.release();
    }
    expect(g.attempts.some((a) => a.api === 'net.Socket.connect')).toBe(true);
  });

  it('restores the originals on release', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const beforeFetch = (globalThis as any).fetch;
    const beforeReq = req('node:http').request;
    const g = installNetworkGuard();
    g.release();
    expect((globalThis as any).fetch).toBe(beforeFetch);
    expect(req('node:http').request).toBe(beforeReq);
  });
});

describe('terciles', () => {
  it('splits by overlap and reports each third independently', () => {
    const mk = (id: string, overlap: number, hit: boolean) =>
      scoreQuery({
        queryId: id,
        query: id,
        relevant: ['t.md'],
        ranked: rank(hit ? ['t.md'] : ['x.md']),
        latencyMs: 1,
        overlap,
      });
    const t = terciles([
      mk('a', 0.1, false),
      mk('b', 0.2, false),
      mk('c', 0.5, true),
      mk('d', 0.9, true),
      mk('e', 0.95, true),
      mk('f', 0.99, true),
    ]);
    expect(t.low.recallAt5).toBe(0);
    expect(t.high.recallAt5).toBe(1);
  });
});
