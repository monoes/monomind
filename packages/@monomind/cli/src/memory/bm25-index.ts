/**
 * In-process Okapi BM25 over live document chunks — the lexical arm of the
 * hybrid retrieval stack (Second Brain plan item 1).
 *
 * WIRING STATUS (#126)
 * ---------------------
 * As of this change, `memory-bridge.ts`'s `bridgeSearchEntries()` calls this
 * as its JS-fallback keyword scorer (replacing a naive token-overlap-fraction
 * scan) WHEN the FTS5 fast path is unavailable/empty AND the queried entry
 * set is small enough to build cheaply (currently capped at 1,500 entries —
 * see BM25_ENTRY_CAP in memory-bridge.ts; this module's own measured cost of
 * ~1.7s/12.5k chunks is why a cap exists at all). Above the cap, or with
 * `MONOMIND_BM25=0`, the old token-overlap scan still runs. The 0.697
 * Recall@5 cited below was measured by the EVAL HARNESS's separate scorer
 * (`knowledge/eval/retrievers.ts`) against the full corpus with no size cap
 * and no FTS5-availability branching — it does NOT automatically transfer to
 * this capped, conditional production wiring. Treat it as the number that
 * justified building this module, not as a live guarantee; re-measure via
 * `monomind doc eval` after this change to get the real number for the
 * actual wired path.
 *
 * WHY THIS IS NOT FTS5
 * --------------------
 * The plan specified "add FTS5 over `memory_entries.content`". It was changed
 * on measured grounds. The Recall@5 0.697 that promoted item 1 — beating the
 * shipping dense stack's 0.591 on every headline metric — was produced by an
 * in-process Okapi BM25 with k1=1.2, b=0.75, in `knowledge/eval/retrievers.ts`.
 * That file carries the warning:
 *
 *   "It is NOT the SQLite FTS5 implementation that item 1 will add — the two
 *    will differ, and scoreboard rows must not treat them as interchangeable."
 *
 * FTS5 has a different tokenizer, different stemming and different defaults, so
 * shipping it would ship a scorer whose 0.697 we had never measured. This file
 * therefore mirrors the eval scorer's parameters and tokenisation exactly, so
 * the baseline number transfers to production rather than being re-earned.
 *
 * It also removes, rather than solves, an entire workstream: no FTS5
 * capability-detection, no graceful degradation, and no two-tier retrieval
 * quality between `better-sqlite3` and the `sql.js` WASM fallback (which has no
 * FTS5 module compiled in at all — verified by execution, not inspection). It
 * needs no change to `@monoes/memory`, so it carries no npm publish gate.
 *
 * DEFERRED SCALING — EXPLICIT TRIGGER
 * -----------------------------------
 * Measured on the real store 2026-07-28:
 *
 *   live chunks only    673 rows      113 ms build     ~15 MB
 *   whole store      12,522 rows    1,729 ms build    ~314 MB
 *
 * A per-process build is free at 10^3-10^4 chunks and stops being free around
 * 10^6. `SCALING_REVIEW_CHUNKS` below is that trigger: cross it and persistence
 * (FTS5, or sqlite-vec for the dense side) has to be reconsidered. Note that by
 * then plan item 4's SQL superseded-predicate will have made the live set the
 * only thing scanned anyway, so the trigger may never fire.
 *
 * THE LIVE-ONLY REQUIREMENT IS ENFORCED HERE, NOT BY CALLERS
 * ----------------------------------------------------------
 * Building over live rows only is a hard requirement: the difference is 113 ms
 * against 1,729 ms and 15 MB against 314 MB. So this module does the superseded
 * filtering ITSELF rather than accepting pre-filtered input. A caller cannot
 * forget, and a caller added later cannot forget either.
 *
 * That is the same lesson as item 4b-i's ingest guard: two `._` resource forks
 * reached the live index despite a correct guard in the directory walk, because
 * the guard sat at one call site instead of at the boundary every caller passes
 * through. Guards belong where they cannot be bypassed.
 *
 * @module v1/cli/memory/bm25-index
 */

import { contentTokens } from './text-tokens.js';

/** Chunk-count at which the per-process build stops being obviously free. */
export const SCALING_REVIEW_CHUNKS = 1_000_000;

/**
 * Above this, something is wrong with the live filter — the whole store is
 * being indexed. Loud rather than silent: a 314 MB allocation that still
 * *works* is exactly the kind of regression no scoreboard row would ever show.
 */
export const LIVE_CHUNK_WARN_THRESHOLD = 50_000;

/** Okapi parameters — identical to `knowledge/eval/retrievers.ts`. */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export interface Bm25Chunk {
  /** Store key, `doc:<contentHash>:<chunkIndex>`. */
  key: string;
  text: string;
}

export interface Bm25Hit {
  key: string;
  /** Raw Okapi BM25 score. NOT a similarity and never comparable to a cosine. */
  score: number;
}

export interface Bm25Stats {
  indexed: number;
  supersededSkipped: number;
  vocabulary: number;
  buildMs: number;
}

/**
 * Tokeniser — literally `contentTokens` from `text-tokens.ts`, the neutral
 * module both production retrieval and the eval harness import.
 *
 * A mirrored implementation drifted on first contact: the harness filters a
 * ~100-word stopword list and the reimplementation did not, so "fall back to
 * keyword" tokenised differently and the production scorer was already a
 * different scorer than the one that measured 0.697. A single source of truth
 * makes drift impossible rather than merely detectable.
 */
export const bm25Tokens = contentTokens;

export class Bm25Index {
  private docs: string[][] = [];
  private tfs: Map<string, number>[] = [];
  private keys: string[] = [];
  private df = new Map<string, number>();
  private avgdl = 0;
  private idfCache = new Map<string, number>();

  readonly stats: Bm25Stats;

  private constructor(stats: Bm25Stats) {
    this.stats = stats;
  }

  /**
   * Build over live chunks only.
   *
   * `isSuperseded` is applied HERE rather than by the caller — see the module
   * note. Pass the predicate from `knowledge/document-pipeline.ts` so the
   * definition of "live" stays in one place.
   */
  static build(
    chunks: Bm25Chunk[],
    isSuperseded: (key: string) => boolean,
  ): Bm25Index {
    const started = Date.now();

    const live: Bm25Chunk[] = [];
    let skipped = 0;
    for (const c of chunks) {
      if (isSuperseded(c.key)) { skipped++; continue; }
      live.push(c);
    }

    const idx = new Bm25Index({
      indexed: live.length,
      supersededSkipped: skipped,
      vocabulary: 0,
      buildMs: 0,
    });

    for (const c of live) {
      const toks = bm25Tokens(c.text);
      idx.keys.push(c.key);
      idx.docs.push(toks);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      idx.tfs.push(tf);
      for (const t of tf.keys()) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
    }

    const totalLen = idx.docs.reduce((s, d) => s + d.length, 0);
    idx.avgdl = idx.docs.length ? totalLen / idx.docs.length : 0;

    idx.stats.vocabulary = idx.df.size;
    idx.stats.buildMs = Date.now() - started;

    if (live.length > LIVE_CHUNK_WARN_THRESHOLD) {
      // Not a throw: a genuinely large project may exceed this. But it must
      // never pass unremarked, because the failure mode (live filter stopped
      // applying) still returns correct results — just 15x slower and 20x
      // fatter, invisibly.
      console.warn(
        `[bm25-index] indexed ${live.length} chunks (>${LIVE_CHUNK_WARN_THRESHOLD}) with only ` +
        `${skipped} filtered as superseded — check that the superseded filter is still applying. ` +
        `Measured cost: 673 live chunks = 113ms/15MB; 12,522 unfiltered = 1,729ms/314MB.`,
      );
    }

    return idx;
  }

  private idf(term: string): number {
    const cached = this.idfCache.get(term);
    if (cached !== undefined) return cached;
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length;
    // Standard BM25 IDF with the +1 that keeps it non-negative.
    const v = n === 0 ? 0 : Math.log(1 + (N - n + 0.5) / (n + 0.5));
    this.idfCache.set(term, v);
    return v;
  }

  /** Okapi BM25, best-first. Scores are raw BM25, never rescaled. */
  search(query: string, limit: number): Bm25Hit[] {
    const qt = bm25Tokens(query);
    if (!qt.length || !this.docs.length) return [];

    const scores = new Float64Array(this.docs.length);
    for (const term of qt) {
      const idf = this.idf(term);
      if (idf === 0) continue;
      for (let i = 0; i < this.docs.length; i++) {
        const f = this.tfs[i].get(term);
        if (!f) continue;
        const norm = 1 - BM25_B + BM25_B * (this.docs[i].length / (this.avgdl || 1));
        scores[i] += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
      }
    }

    const hits: Bm25Hit[] = [];
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > 0) hits.push({ key: this.keys[i], score: scores[i] });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /**
   * Share of a query's total IDF mass that finds ANY support in this index,
   * in [0,1].
   *
   * This is the query-adaptive fusion signal for item 1 (plan Part B). It is a
   * WITHIN-RETRIEVER measurement — it never compares a BM25 score to a cosine,
   * so it introduces no cross-retriever calibration.
   *
   * Rationale: the low-overlap tercile is defined by low IDF-weighted overlap
   * between query and gold document. That is unobservable at query time, but
   * "how much of this query's rare, information-bearing vocabulary exists in
   * the corpus at all" is observable, and it is precisely the condition under
   * which BM25 has nothing to work with and must score near-randomly. On the
   * measured baseline BM25 gets 0.182 Recall@5 in the low-overlap tercile
   * against dense's 0.500.
   *
   * UNVALIDATED: that this correlates with the overlap terciles is a
   * hypothesis, to be checked against the DEV split before any fusion is built
   * on it. Do not treat it as established.
   */
  lexicalSupport(query: string): number {
    const qt = bm25Tokens(query);
    if (!qt.length) return 0;

    const N = this.docs.length;
    let total = 0;
    let supported = 0;
    for (const term of new Set(qt)) {
      const n = this.df.get(term) ?? 0;
      // Corpus-independent IDF weight: how informative the term WOULD be.
      // Using this.idf() would score absent terms 0 on both sides of the
      // ratio and make every query look fully supported.
      const weight = Math.log(1 + N / (1 + n));
      total += weight;
      if (n > 0) supported += weight;
    }
    return total === 0 ? 0 : supported / total;
  }

  /** Number of live chunks indexed. */
  get size(): number {
    return this.docs.length;
  }
}
