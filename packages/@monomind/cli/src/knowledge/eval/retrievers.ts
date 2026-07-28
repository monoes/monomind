/**
 * Retrievers under test, including the deliberately weak baselines.
 *
 * The weak baselines exist to answer one question the headline number cannot:
 * how much of our score is the retrieval stack, and how much is a golden set
 * so easy that keyword matching nearly solves it? A small gap between
 * `bm25-only` and the real stack means the SET is uninformative, not that the
 * stack is good. See Requirement C in the item-0 brief.
 *
 * @module v1/cli/knowledge/eval/retrievers
 */

import { contentTokens } from './metrics.js';

export interface EvalChunk {
  docId: string;
  chunkIndex: number;
  text: string;
}

export interface RawHit {
  docId: string;
  chunkIndex: number;
  score: number;
}

export interface Retriever {
  name: string;
  description: string;
  /** Must not make network calls. Returns chunk-level hits, best-first. */
  search(query: string, limit: number): Promise<RawHit[]>;
}

// -- BM25 floor ------------------------------------------------------
// Okapi BM25 with the standard k1=1.2, b=0.75. This is OUR OWN scorer, run
// in-process over the same chunk set the dense index holds. It is NOT the
// SQLite FTS5 implementation that item 1 will add — the two will differ, and
// scoreboard rows must not treat them as interchangeable.

export class Bm25Retriever implements Retriever {
  name = 'bm25-only';
  description = 'Okapi BM25 (k1=1.2, b=0.75) over the same chunks, no dense component';

  private docs: string[][] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(private chunks: EvalChunk[]) {
    for (const c of chunks) {
      const toks = contentTokens(c.text);
      this.docs.push(toks);
      for (const t of new Set(toks)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = this.docs.length === 0
      ? 0
      : this.docs.reduce((a, d) => a + d.length, 0) / this.docs.length;
  }

  async search(query: string, limit: number): Promise<RawHit[]> {
    const k1 = 1.2, b = 0.75;
    const N = this.docs.length;
    const q = contentTokens(query);
    const scored: RawHit[] = [];

    for (let i = 0; i < N; i++) {
      const toks = this.docs[i];
      if (toks.length === 0) continue;
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of q) {
        const f = tf.get(term);
        if (!f) continue;
        const n = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (toks.length / this.avgLen))));
      }
      if (score > 0) {
        scored.push({ docId: this.chunks[i].docId, chunkIndex: this.chunks[i].chunkIndex, score });
      }
    }
    scored.sort((a, b2) => b2.score - a.score);
    return scored.slice(0, limit);
  }
}

// -- Random floor ----------------------------------------------------
// The true floor. Deterministic per (query, corpus) via a seeded PRNG so the
// number is reproducible on a clean checkout rather than a fresh coin flip.

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class RandomRetriever implements Retriever {
  name = 'random';
  description = 'Deterministic seeded random document sample — the true floor';

  private docIds: string[];

  constructor(chunks: EvalChunk[], private seed = 'second-brain-eval') {
    this.docIds = [...new Set(chunks.map(c => c.docId))].sort();
  }

  async search(query: string, limit: number): Promise<RawHit[]> {
    let state = hashSeed(this.seed + '::' + query);
    const next = () => {
      state ^= state << 13; state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5; state >>>= 0;
      return state / 0xffffffff;
    };
    const pool = [...this.docIds];
    const out: RawHit[] = [];
    for (let i = 0; i < limit && pool.length > 0; i++) {
      const idx = Math.floor(next() * pool.length) % pool.length;
      out.push({ docId: pool.splice(idx, 1)[0], chunkIndex: 0, score: 1 - i / limit });
    }
    return out;
  }
}

/** Wraps an arbitrary async search function (the real stack) as a Retriever. */
export class FnRetriever implements Retriever {
  constructor(
    public name: string,
    public description: string,
    private fn: (query: string, limit: number) => Promise<RawHit[]>,
  ) {}
  search(query: string, limit: number): Promise<RawHit[]> { return this.fn(query, limit); }
}

// -- RRF fusion -------------------------------------------------------
// Reciprocal Rank Fusion: fusionScore(d) = Σ 1/(k + rank_i) for each
// retriever i that returned document d. Equal weight across all sources.
//
// `score` on the returned RawHit is the RRF fusion score — a rank-derived
// quantity, NOT a similarity and NOT comparable to cosine or BM25 scores.
// Callers that need a per-source score must read the child retrievers
// directly. This is the null hypothesis row: equal weight, no query
// adaptation. Expected to fail the low-overlap gate because BM25 scores
// 0.182 in that tercile and equal-weight fusion drags dense down.

export class RrfRetriever implements Retriever {
  name: string;
  description: string;

  constructor(
    private children: Retriever[],
    /** RRF smoothing constant. Standard values: 10–100. */
    private rrfK: number,
    name?: string,
  ) {
    this.name = name ?? `rrf-k${rrfK}`;
    this.description =
      `Reciprocal Rank Fusion (k=${rrfK}, equal weight) over [${children.map(c => c.name).join(', ')}]`;
  }

  async search(query: string, limit: number): Promise<RawHit[]> {
    // Over-fetch from each child: a document at rank 50 in one child and
    // rank 1 in another should still be fusible, so fetch more than `limit`.
    const childLimit = limit * 5;
    const childResults = await Promise.all(
      this.children.map(c => c.search(query, childLimit)),
    );

    // Build per-document fusion scores. Track the best chunk per document
    // from whichever child scored it highest (for the chunkIndex field).
    const fusion = new Map<string, { score: number; chunkIndex: number; bestChildScore: number }>();

    for (const hits of childResults) {
      // Dedupe by docId within this child before assigning ranks.
      const seen = new Set<string>();
      let rank = 0;
      for (const h of hits) {
        if (seen.has(h.docId)) continue;
        seen.add(h.docId);
        rank++;
        const rrfScore = 1 / (this.rrfK + rank);
        const existing = fusion.get(h.docId);
        if (existing) {
          existing.score += rrfScore;
          if (h.score > existing.bestChildScore) {
            existing.chunkIndex = h.chunkIndex;
            existing.bestChildScore = h.score;
          }
        } else {
          fusion.set(h.docId, { score: rrfScore, chunkIndex: h.chunkIndex, bestChildScore: h.score });
        }
      }
    }

    const fused: RawHit[] = [];
    for (const [docId, v] of fusion) {
      fused.push({ docId, chunkIndex: v.chunkIndex, score: v.score });
    }
    fused.sort((a, b) => b.score - a.score);
    return fused.slice(0, limit);
  }
}
