/**
 * Retrieval metrics for the Second Brain scoreboard.
 *
 * Definitions are spelled out in full because every number this org reports is
 * judged against them. Nothing here rounds: callers format for display, never
 * for the JSON payload.
 *
 * @module v1/cli/knowledge/eval/metrics
 */

/** A ranked retrieval result, already reduced to one entry per document. */
export interface RankedDoc {
  /** Repo-relative document path — the unit of relevance judgement. */
  docId: string;
  /** Best score seen for this document across its chunks. */
  score: number;
  /** Which chunk produced the best score (for debugging misses). */
  chunkIndex: number;
}

export interface QueryOutcome {
  queryId: string;
  query: string;
  relevant: string[];
  ranked: RankedDoc[];
  /** 1-based rank of the first relevant doc within the top 10, else null. */
  firstRelevantRank: number | null;
  recallAt: Record<number, number>;
  hitAt: Record<number, number>;
  reciprocalRank: number;
  latencyMs: number;
  /** IDF-weighted lexical overlap between query and its gold document(s). */
  overlap: number;
  overlapTercile?: 'low' | 'mid' | 'high';
}

export interface Scoreboard {
  queries: number;
  /** Macro-averaged. Standard definition: |top-k INTERSECT R| / |R|. */
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  /** Fraction of queries with >= 1 relevant doc in top-k. Equals recall when |R| = 1. */
  hitRateAt1: number;
  hitRateAt5: number;
  hitRateAt10: number;
  /** Mean reciprocal rank, cutoff 10. Queries with no hit contribute 0. */
  mrrAt10: number;
  /** Queries where no relevant doc appeared anywhere in the top 10. */
  totalMisses: number;
  latencyMsP50: number;
  latencyMsP95: number;
  /** 95% Wald half-width on hitRateAt5 — how large a delta must be to be signal. */
  hitRateAt5Ci95: number;
}

export const K_VALUES = [1, 5, 10] as const;

/**
 * Reduce chunk-level hits to a ranked list of unique documents. A document's
 * rank is the rank of its best-scoring chunk; further chunks of an
 * already-seen document are dropped rather than pushing other documents down.
 */
export function dedupeByDoc(
  hits: Array<{ docId: string; score: number; chunkIndex: number }>,
  cutoff: number,
): RankedDoc[] {
  const seen = new Set<string>();
  const out: RankedDoc[] = [];
  for (const h of hits) {
    if (!h.docId || seen.has(h.docId)) continue;
    seen.add(h.docId);
    out.push({ docId: h.docId, score: h.score, chunkIndex: h.chunkIndex });
    if (out.length >= cutoff) break;
  }
  return out;
}

export function scoreQuery(args: {
  queryId: string;
  query: string;
  relevant: string[];
  ranked: RankedDoc[];
  latencyMs: number;
  overlap?: number;
}): QueryOutcome {
  const rel = new Set(args.relevant);
  const recallAt: Record<number, number> = {};
  const hitAt: Record<number, number> = {};

  for (const k of K_VALUES) {
    const top = args.ranked.slice(0, k);
    const found = top.filter((r) => rel.has(r.docId)).length;
    recallAt[k] = rel.size === 0 ? 0 : found / rel.size;
    hitAt[k] = found > 0 ? 1 : 0;
  }

  let firstRelevantRank: number | null = null;
  for (let i = 0; i < args.ranked.length && i < 10; i++) {
    if (rel.has(args.ranked[i].docId)) {
      firstRelevantRank = i + 1;
      break;
    }
  }

  return {
    queryId: args.queryId,
    query: args.query,
    relevant: args.relevant,
    ranked: args.ranked,
    firstRelevantRank,
    recallAt,
    hitAt,
    reciprocalRank: firstRelevantRank ? 1 / firstRelevantRank : 0,
    latencyMs: args.latencyMs,
    overlap: args.overlap ?? 0,
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function aggregate(outcomes: QueryOutcome[]): Scoreboard {
  const n = outcomes.length;
  const lat = outcomes.map((o) => o.latencyMs);
  const h5 = mean(outcomes.map((o) => o.hitAt[5]));
  // Wald 95% half-width. With small n this is wide on purpose: it is the
  // honest statement that a small delta is not yet a signal.
  const ci = n === 0 ? 0 : 1.96 * Math.sqrt((h5 * (1 - h5)) / n);
  return {
    queries: n,
    recallAt1: mean(outcomes.map((o) => o.recallAt[1])),
    recallAt5: mean(outcomes.map((o) => o.recallAt[5])),
    recallAt10: mean(outcomes.map((o) => o.recallAt[10])),
    hitRateAt1: mean(outcomes.map((o) => o.hitAt[1])),
    hitRateAt5: h5,
    hitRateAt10: mean(outcomes.map((o) => o.hitAt[10])),
    mrrAt10: mean(outcomes.map((o) => o.reciprocalRank)),
    totalMisses: outcomes.filter((o) => o.firstRelevantRank === null).length,
    latencyMsP50: percentile(lat, 50),
    latencyMsP95: percentile(lat, 95),
    hitRateAt5Ci95: ci,
  };
}

// -- Tokenisation ---------------------------------------------------
// Canonical definition lives in `memory/text-tokens.ts` — a neutral module
// that is unambiguously production code, safe from any future `!eval/`
// exclusion in the published files set. Re-exported here so existing eval
// callers (retrievers.ts, harness.ts, signals.ts) need no import change.

import { contentTokens, STOPWORDS } from '../../memory/text-tokens.js';

export { contentTokens, STOPWORDS };

// -- Anti-triviality guard ------------------------------------------
// A query that is a near-verbatim substring of its target measures string
// matching, not retrieval. Such pairs are removed from the scored set and
// reported, so the headline number cannot be inflated by them.

export interface TrivialityReport {
  /** Fraction of the query's content tokens appearing anywhere in the doc. */
  overlapRatio: number;
  /** Longest run of consecutive query tokens appearing consecutively in the doc. */
  maxContiguousRun: number;
  trivial: boolean;
  reason?: string;
}

/**
 * @param query   the golden-set query string
 * @param docText the FULL text of the target document
 */
export function assessTriviality(query: string, docText: string): TrivialityReport {
  const q = contentTokens(query);
  const d = contentTokens(docText);
  if (q.length === 0) return { overlapRatio: 0, maxContiguousRun: 0, trivial: false };

  const docSet = new Set(d);
  const overlapRatio = q.filter((t) => docSet.has(t)).length / q.length;

  const positions = new Map<string, number[]>();
  d.forEach((t, i) => {
    const arr = positions.get(t);
    if (arr) arr.push(i);
    else positions.set(t, [i]);
  });
  let maxRun = 0;
  for (let start = 0; start < q.length; start++) {
    for (const p of positions.get(q[start]) ?? []) {
      let run = 0;
      while (start + run < q.length && p + run < d.length && q[start + run] === d[p + run]) run++;
      if (run > maxRun) maxRun = run;
    }
  }

  let trivial = false;
  let reason: string | undefined;
  if (maxRun >= 4) {
    trivial = true;
    reason = `${maxRun}-token verbatim run from the query appears in the target`;
  } else if (maxRun >= 3 && overlapRatio >= 0.8) {
    trivial = true;
    reason = `3-token verbatim run plus ${Math.round(overlapRatio * 100)}% token overlap`;
  }
  return { overlapRatio, maxContiguousRun: maxRun, trivial, reason };
}

// -- IDF-weighted lexical overlap (Requirement D) --------------------
// Plain token overlap over-credits common words. IDF weighting asks the real
// question: does the query share the RARE vocabulary of its target? A query
// that shares only "the system" with its gold doc is a genuinely hard query
// even if raw overlap looks moderate.

export interface IdfModel {
  idf: Map<string, number>;
  docCount: number;
}

export function buildIdf(docs: string[]): IdfModel {
  const df = new Map<string, number>();
  for (const text of docs) {
    const unique: Set<string> = new Set(contentTokens(text));
    unique.forEach((t) => df.set(t, (df.get(t) ?? 0) + 1));
  }
  const idf = new Map<string, number>();
  const N = docs.length;
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  return { idf, docCount: N };
}

/** Unknown (never-seen) query terms get the maximum IDF the corpus supports. */
function idfOf(model: IdfModel, token: string): number {
  return model.idf.get(token) ?? Math.log(1 + (model.docCount + 0.5) / 0.5);
}

/**
 * IDF-weighted overlap in [0,1]: the share of the query's total information
 * mass that is literally present in the gold document.
 */
export function idfOverlap(model: IdfModel, query: string, docText: string): number {
  const q = contentTokens(query);
  if (q.length === 0) return 0;
  const docSet: Set<string> = new Set(contentTokens(docText));
  let total = 0;
  let matched = 0;
  const qUnique: Set<string> = new Set(q);
  qUnique.forEach((t) => {
    const w = idfOf(model, t);
    total += w;
    if (docSet.has(t)) matched += w;
  });
  return total === 0 ? 0 : matched / total;
}

/** Split outcomes into terciles by overlap and aggregate each independently. */
export function terciles(outcomes: QueryOutcome[]): {
  cutLow: number;
  cutHigh: number;
  low: Scoreboard;
  mid: Scoreboard;
  high: Scoreboard;
} {
  const sorted = [...outcomes].sort((a, b) => a.overlap - b.overlap);
  const n = sorted.length;
  const a = Math.floor(n / 3);
  const b = Math.floor((2 * n) / 3);
  const low = sorted.slice(0, a);
  const mid = sorted.slice(a, b);
  const high = sorted.slice(b);
  for (const o of low) o.overlapTercile = 'low';
  for (const o of mid) o.overlapTercile = 'mid';
  for (const o of high) o.overlapTercile = 'high';
  return {
    cutLow: sorted[a]?.overlap ?? 0,
    cutHigh: sorted[b]?.overlap ?? 0,
    low: aggregate(low),
    mid: aggregate(mid),
    high: aggregate(high),
  };
}

// -- Paired comparison ----------------------------------------------
// Two overlapping single-proportion CIs systematically UNDERSTATE a paired
// effect: the same queries run through both retrievers, so query-difficulty
// variance is shared and cancels. McNemar's test uses only the discordant
// pairs — the queries where the two retrievers disagree — which is exactly
// the information a per-arm CI throws away.

export interface PairedComparison {
  a: string;
  b: string;
  /** Queries where A hit at k and B missed. */
  aWins: number;
  /** Queries where B hit at k and A missed. */
  bWins: number;
  ties: number;
  /** Two-sided McNemar p, exact binomial on the discordant pairs. */
  p: number;
  significant: boolean;
  note: string;
}

/** Exact two-sided binomial test at p=0.5 — correct for the small discordant
 *  counts this eval produces, where the chi-square approximation is unsafe. */
function exactBinomialTwoSided(k: number, n: number): number {
  if (n === 0) return 1;
  const logC = (nn: number, kk: number): number => {
    let r = 0;
    for (let i = 1; i <= kk; i++) r += Math.log(nn - kk + i) - Math.log(i);
    return r;
  };
  const pmf = (i: number) => Math.exp(logC(n, i) - n * Math.LN2);
  const target = pmf(k) * (1 + 1e-9);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= target) p += pmf(i);
  return Math.min(1, p);
}

export function pairedCompare(
  aName: string,
  aOutcomes: QueryOutcome[],
  bName: string,
  bOutcomes: QueryOutcome[],
  k: 1 | 5 | 10 = 5,
): PairedComparison {
  const bById = new Map(bOutcomes.map((o) => [o.queryId, o]));
  let aWins = 0,
    bWins = 0,
    ties = 0;
  for (const a of aOutcomes) {
    const b = bById.get(a.queryId);
    if (!b) continue;
    const ah = a.hitAt[k],
      bh = b.hitAt[k];
    if (ah === bh) ties++;
    else if (ah > bh) aWins++;
    else bWins++;
  }
  const discordant = aWins + bWins;
  const p = exactBinomialTwoSided(Math.min(aWins, bWins), discordant);
  return {
    a: aName,
    b: bName,
    aWins,
    bWins,
    ties,
    p,
    significant: p < 0.05,
    note:
      discordant === 0
        ? 'The two retrievers never disagreed; no paired evidence either way.'
        : `${discordant} discordant queries at k=${k}. ` +
          (p < 0.05
            ? `${bWins > aWins ? bName : aName} wins; the difference survives a paired test.`
            : 'The difference does NOT survive a paired test — it is not yet distinguishable from chance.'),
  };
}
