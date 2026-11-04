/**
 * The local golden set: query -> relevant document id pairs.
 *
 * CONSTRUCTION RULES (enforced by the harness, not just by good intentions):
 *  1. Every `relevant` id is a repo-relative path that must exist in the
 *     deterministic corpus. Unknown ids are a hard failure, never a silent skip.
 *  2. Queries are written in DIFFERENT vocabulary from the source document —
 *     the wording a person would use months later having forgotten the doc's
 *     own terms. Pairs whose query turns out to be near-verbatim in the target
 *     are removed automatically by `assessTriviality` and reported.
 *  3. Relevance is pinned to LIVE documents: the eval store is rebuilt from the
 *     corpus with exactly one ingest per document, so it contains no superseded
 *     versions at all. Deleting dead rows from the user's store (backlog item 4)
 *     therefore cannot move these numbers.
 *  4. Ambiguous targets are avoided. Where several near-identical documents
 *     could each legitimately answer, either the query is sharpened or all
 *     acceptable documents are listed in `relevant`.
 *
 * @module v1/cli/knowledge/eval/golden-set
 */

export interface GoldenPair {
  id: string;
  query: string;
  /** Repo-relative paths. A hit on ANY counts for hit-rate; recall uses all. */
  relevant: string[];
  /** Free-form grouping for slice reporting. */
  tags?: string[];
}

/**
 * v1 of the set. Authored 2026-07-28 by `benchmark-engineer` against documents
 * read at authoring time. Growing this set is ongoing work; the count is
 * reported honestly by the harness rather than padded with near-duplicates.
/**
 * Pair data lives in `golden-set.json` (v1 pairs, then the v2 expansion — see below),
 * read once at load. The build copies the JSON next to the compiled module.
 */
export const GOLDEN_SET: GoldenPair[] = JSON.parse(
  readFileSync(new URL('./golden-set.json', import.meta.url), 'utf8'),
);

// ── Dev / test split ────────────────────────────────────────────────
// Sealed at construction time, deterministically, before any number existed.
//
// Why this exists: the same org authors the queries, writes the relevance
// labels, tunes the retrieval parameters and wants to reach a stop condition.
// Every ingredient of "tuned to the eval set" is present. The published
// worked example is MemPalace, whose LoCoMo figure moved 60.3 -> 88.9 by
// changing a scoring rule against the eval set, with a public repo and a
// committed methodology doc — more transparency than discipline alone buys.
//
// Rules, enforced in the harness rather than by good intentions:
//   - TEST never reports per-query results. If you can see which queries
//     failed you will fix those queries, and that requires no bad faith.
//   - The stop condition is evaluated on TEST only.
//   - Every TEST run is appended to a ledger. A TEST set run forty times with
//     tuning in between has become a dev set, and the count is the only way
//     anyone will notice.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type Split = 'dev' | 'test';

/** Stable per-pair hash in [0,1). Depends only on the pair id, so adding or
 *  removing pairs never reshuffles the existing assignments. */
function pairHash(id: string): number {
  const h = createHash('sha256').update(`second-brain-split-v1::${id}`).digest();
  return h.readUInt32BE(0) / 0x100000000;
}

/** Share of pairs assigned to the sealed test split. */
export const TEST_SHARE = 0.3;

/** Identifies the assignment scheme. Bump this whenever assignment changes:
 *  numbers measured under different schemes are not comparable, and the
 *  regression suite uses this to say so instead of inventing a regression. */
export const SPLIT_SCHEME = 'hash-threshold-v2';

/**
 * Stratified 70/30 dev/test split, STABLE UNDER GROWTH.
 *
 * The assignment is a pure function of the pair's own id — `pairHash(id) <
 * TEST_SHARE` — so adding pairs never moves an existing pair between splits.
 *
 * The first version ranked pairs within their tag group and took the lowest
 * 30%, which gave an exact 70/30 per tag but was NOT stable: appending one
 * pair to a group re-ranked it and silently reassigned existing pairs. Growing
 * the set would have quietly moved queries out of the sealed half and into the
 * tunable one, which is the seal failing open — and it would have done so with
 * no visible symptom at all.
 *
 * Stratification survives because the hash is uniform and independent of the
 * tag, so each tag group lands near 30% on average rather than exactly. That
 * is the right trade: an approximate stratification that cannot leak beats an
 * exact one that can.
 */
export function assignSplits(pairs: GoldenPair[] = GOLDEN_SET): Map<string, Split> {
  const out = new Map<string, Split>();
  for (const p of pairs) out.set(p.id, pairHash(p.id) < TEST_SHARE ? 'test' : 'dev');
  return out;
}

export function pairsForSplit(
  split: Split | 'all',
  pairs: GoldenPair[] = GOLDEN_SET,
): GoldenPair[] {
  if (split === 'all') return pairs;
  const m = assignSplits(pairs);
  return pairs.filter((p) => m.get(p.id) === split);
}

// ── v2 expansion (2026-07-28, appended to golden-set.json) ─────────
//
// 390 pairs authored across seven independent authors over the 422 documents the
// v1 set never touched. Every candidate was screened at AUTHORING time through
// the IDF-overlap metric rather than measured afterwards, because the v1 set
// became high-overlap dominated precisely by authoring first and measuring later.
//
// Target sets are expanded to include byte-identical and near-duplicate siblings
// (5-gram shingle containment >= 0.75): retrieving a true near-duplicate of the
// gold document IS retrieving the right content, and the expansion is computed
// from document content alone, so it cannot fit the set to any retriever.
//
// Authors were instructed to SKIP a document rather than write a weak query for
// it; between them they declined 32 documents as too ambiguous against a sibling.
// A missing query costs precision. A wrong relevance label silently corrupts
// every number the benchmark will ever produce.
