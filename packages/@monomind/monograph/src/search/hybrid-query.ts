/**
 * The single lexical retrieval service for the monograph knowledge graph.
 *
 * Every adapter — the package-level `monograph_query` MCP tool, the
 * CLI-hosted `monograph_query` MCP tool, `augmentContext`, the eval server —
 * calls {@link searchGraph} rather than assembling its own BM25/LIKE/fuzzy
 * combination. Two adapters answering the same query differently was a real
 * bug, not a hypothetical one.
 *
 * SCORE CONVENTION — higher is better, always non-negative.
 * SQLite FTS5's `rank` is the opposite (negative, more negative = better).
 * That inversion is resolved in exactly one place,
 * {@link relevanceFromFtsRank} in `../storage/fts-store.js`, at the boundary
 * where a rank enters the system. Nothing downstream ever sees a raw rank, so
 * the sign cannot be forwarded into a ranker again.
 *
 * Monograph search is lexical-only. The former embedding/vector branch
 * (gated on MONOGRAPH_EMBEDDINGS=true) was removed — it was never run in
 * practice (the embeddings table stayed empty) and did a JS cosine full scan.
 */

import type Database from 'better-sqlite3';
import { ftsSearch, hybridSearch, relevanceFromFtsRank } from '../storage/fts-store.js';
import { contentWords, summarySearch } from '../storage/summary-search.js';
import { SYMBOL_NODE_LABELS } from '../types.js';
import type { RankedResult } from './rrf.js';

/**
 * Retrieval strategies, named for what they actually do.
 *
 * - `hybrid` — FTS5 BM25 + LIKE fallback + in-memory fuzzy + node-type bonus.
 *   The default: it degrades gracefully on short identifiers, where bare BM25
 *   over a trigram index returns nothing.
 * - `bm25` — FTS5 BM25 only. Narrower, but predictable; used where a caller
 *   wants pure lexical ranking with no heuristic bonuses.
 */
export type RetrievalMode = 'bm25' | 'hybrid';

/**
 * Which part of the graph a search covers.
 *
 * - `code` — symbols, files, routes and tools.
 * - `docs` — markdown sections, documents and concepts.
 * - `agents` — agent and skill definitions.
 * - `all` — everything, ranked purely by relevance.
 * - `auto` (default) — code first, with documentation filling any slots the
 *   code left empty; a query that is plainly about documentation flips that
 *   order. Doc sections outnumber code symbols roughly 1:2 in this repo, so
 *   without this an abstract task query is answered entirely by headings.
 */
export type SearchScope = 'code' | 'docs' | 'agents' | 'all' | 'auto';

export const CODE_SCOPE_LABELS: readonly string[] = [
  ...SYMBOL_NODE_LABELS,
  'File',
  'Module',
  'Route',
  'Tool',
];
export const DOC_SCOPE_LABELS: readonly string[] = ['Section', 'Document', 'Concept'];
export const AGENT_SCOPE_LABELS: readonly string[] = ['Agent', 'Skill'];

// Whole words in a multi-word question — not `agent` inside `agent-pick` or `AgentSpawn`.
const AGENT_INTENT = /(?:^|\s)(?:agents?|subagents?|skills?)(?:\s|$)/i;
const DOC_INTENT =
  /\b(docs?|documentation|readme|guide|adr|changelog|tutorial|concept|explain(?:s|ed)?)\b/i;

/** True when the query is asking which agent or skill to use. */
export function hasAgentIntent(query: string): boolean {
  return /\s/.test(query.trim()) && AGENT_INTENT.test(query);
}

/** True when the query is plainly asking about documentation rather than code. */
export function hasDocIntent(query: string): boolean {
  return DOC_INTENT.test(query);
}

export interface GraphSearchOptions {
  limit?: number;
  /** Exact node label (or labels). Overrides `scope`. */
  label?: string | readonly string[];
  /** Part of the graph to search (default: `auto`). */
  scope?: SearchScope;
  /** Retrieval strategy (default: `hybrid`). */
  mode?: RetrievalMode;
}

export interface GraphSearchResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  /** Higher is better, always ≥ 0. See the score-convention note above. */
  relevance: number;
  /** First line of the symbol in its source file (1-based, null if unknown). */
  startLine: number | null;
  /** Last line of the symbol in its source file (1-based, null if unknown). */
  endLine: number | null;
  /** Which retrieval strategy surfaced this row. */
  matchStrategy: 'fts' | 'like' | 'fuzzy' | 'semantic';
  /** Cosine similarity to the query, set only on hits the embedding lane found. */
  similarity?: number;
}

/**
 * Run a lexical search over the graph and return results under the
 * higher-is-better score convention.
 *
 * The query is prepared identically for every mode so that two adapters
 * asking the same question in the same mode get the same answer.
 *
 * Preparation is `trim()` only, deliberately. The FTS5 index uses the trigram
 * tokenizer, which folds ASCII case but does NOT fold diacritics, and the
 * index stores `name`/`norm_label` verbatim. Stripping diacritics from the
 * query (as the old `bm25Query` did) therefore could never *gain* a match —
 * it only stopped `naïveResolver` from finding the symbol literally named
 * `naïveResolver`. Lowercasing is likewise skipped: it is a no-op for ASCII
 * under both the trigram tokenizer and SQLite's LIKE, and for non-ASCII it
 * would break the LIKE fallback against a capitalized name.
 */
export function searchGraph(
  db: Database.Database,
  query: string,
  options: GraphSearchOptions = {},
): GraphSearchResult[] {
  const { limit = 20, label, mode = 'hybrid', scope = 'auto' } = options;
  if (limit <= 0) return [];

  const normalizedQuery = (query ?? '').trim();
  if (!normalizedQuery) return [];

  if (label || scope === 'all') return searchLabels(db, normalizedQuery, limit, mode, label);
  if (scope === 'code') return searchLabels(db, normalizedQuery, limit, mode, CODE_SCOPE_LABELS);
  if (scope === 'docs') return searchLabels(db, normalizedQuery, limit, mode, DOC_SCOPE_LABELS);

  if (scope === 'agents') return searchLabels(db, normalizedQuery, limit, mode, AGENT_SCOPE_LABELS);

  const order = hasDocIntent(normalizedQuery)
    ? [DOC_SCOPE_LABELS, CODE_SCOPE_LABELS, AGENT_SCOPE_LABELS]
    : [CODE_SCOPE_LABELS, DOC_SCOPE_LABELS, AGENT_SCOPE_LABELS];
  const results: GraphSearchResult[] = [];
  const seen = new Set<string>();
  // A question about agents or skills gets up to half the slots first; the
  // code that matches it (an agent *picker*, say) keeps the rest.
  if (hasAgentIntent(normalizedQuery)) {
    for (const r of searchLabels(
      db,
      normalizedQuery,
      Math.ceil(limit / 2),
      mode,
      AGENT_SCOPE_LABELS,
    )) {
      results.push(r);
      seen.add(r.id);
    }
  }
  for (const labels of order) {
    if (results.length >= limit) break;
    for (const r of searchLabels(db, normalizedQuery, limit - results.length, mode, labels)) {
      if (seen.has(r.id)) continue;
      results.push(r);
      seen.add(r.id);
    }
  }
  return results.slice(0, limit);
}

/**
 * Summary hits sit below an exact lexical hit (whose relevance can exceed 1)
 * but above weak fuzzy ones; a node found by both signals gets the summary
 * score added, since two independent signals agreeing is the strongest evidence.
 */
const SUMMARY_WEIGHT = 0.8;
const LEXICAL_ONLY_FACTOR = 0.25;
/** Tests restate the code they exercise; they rank below it unless asked for. */
export const TEST_PATH =
  /(\.test\.|\.spec\.|_test\.(go|py)$|(^|\/)test_[^/]*\.py$|__tests__|__mocks__|__fixtures__|(^|\/)(tests?|fixtures?|mocks?|e2e|testdata)\/)/;
export const TEST_INTENT = /\b(tests?|specs?|mocks?|fixtures?)\b/i;
export const TEST_FACTOR = 0.6;

/** Scales down hits from test/mock/fixture files unless the query is about tests. */
function demoteTests(query: string, hits: GraphSearchResult[]): GraphSearchResult[] {
  if (TEST_INTENT.test(query)) return hits;
  for (const r of hits) {
    if (r.filePath && TEST_PATH.test(r.filePath)) r.relevance *= TEST_FACTOR;
  }
  return hits;
}

function searchLabels(
  db: Database.Database,
  normalizedQuery: string,
  limit: number,
  mode: RetrievalMode,
  label?: string | readonly string[],
): GraphSearchResult[] {
  const lexical = searchLexical(db, normalizedQuery, limit, mode, label);
  // Documents carry a body excerpt in their summary, so a single word is a
  // meaningful query there (#698); for code a bare word is the lexical path's job.
  const described = summarySearch(
    db,
    normalizedQuery,
    limit * 2,
    label,
    label === DOC_SCOPE_LABELS ? 1 : 2,
  );
  if (described.length === 0) {
    return demoteTests(normalizedQuery, lexical).sort((a, b) => b.relevance - a.relevance);
  }
  // A multi-word question is not an identifier: a lexical-only hit is then
  // usually a substring accident ("handle" inside handleTasksStatus), so it
  // counts for less than a hit the descriptions also support.
  if (contentWords(normalizedQuery).length >= 2) {
    const supported = new Set(described.map((r) => r.id));
    for (const r of lexical) if (!supported.has(r.id)) r.relevance *= LEXICAL_ONLY_FACTOR;
  }
  const byId = new Map(lexical.map((r) => [r.id, r]));
  for (const row of described) {
    const score = SUMMARY_WEIGHT * relevanceFromFtsRank(row.rank);
    const hit = byId.get(row.id);
    if (hit) {
      hit.relevance += score;
    } else {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        normLabel: row.normLabel,
        filePath: row.filePath,
        label: row.label,
        relevance: score,
        startLine: row.startLine,
        endLine: row.endLine,
        matchStrategy: 'fts',
      });
    }
  }
  return demoteTests(normalizedQuery, [...byId.values()])
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

function searchLexical(
  db: Database.Database,
  normalizedQuery: string,
  limit: number,
  mode: RetrievalMode,
  label?: string | readonly string[],
): GraphSearchResult[] {
  if (mode === 'bm25') {
    // Over-fetch a little: FTS5's own ordering is what we keep, but a wider
    // window gives the caller's label filter something to bite on.
    const rows = ftsSearch(db, normalizedQuery, Math.max(limit, 50), label);
    return rows.slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name,
      normLabel: r.normLabel,
      filePath: r.filePath,
      label: r.label,
      relevance: relevanceFromFtsRank(r.rank),
      startLine: r.startLine,
      endLine: r.endLine,
      matchStrategy: 'fts' as const,
    }));
  }

  // hybridSearch already reports a positive, higher-is-better combinedScore
  // (it routes its FTS rows through relevanceFromFtsRank).
  return hybridSearch(db, normalizedQuery, limit, label).map((r) => ({
    id: r.id,
    name: r.name,
    normLabel: r.normLabel,
    filePath: r.filePath,
    label: r.label,
    relevance: r.combinedScore,
    startLine: r.startLine,
    endLine: r.endLine,
    matchStrategy: r.matchStrategy,
  }));
}

export interface BM25QueryOptions {
  limit?: number;
  label?: string;
  /** @deprecated Embeddings are disabled — this option is ignored; search is lexical-only. Will be removed in the next major version. */
  embedder?: unknown;
}

/** @deprecated Use {@link GraphSearchOptions} — this alias will be removed in the next major version. */
export type HybridQueryOptions = BM25QueryOptions;

export interface BM25Result extends RankedResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  /** Higher is better, always ≥ 0 — see the score-convention note above. */
  score: number;
  /** First line of the symbol in its source file (1-based, null if unknown). */
  startLine?: number | null;
  /** Last line of the symbol in its source file (1-based, null if unknown). */
  endLine?: number | null;
}

/** @deprecated Use {@link GraphSearchResult} — this alias will be removed in the next major version. */
export type HybridResult = BM25Result;

/**
 * @deprecated Use {@link searchGraph} with `mode: 'bm25'`. Retained as a thin
 * wrapper so existing callers keep working; it now reports the same
 * higher-is-better `score` as every other path (it used to forward FTS5's
 * raw negative `rank`, which inverted ranking for anything downstream that
 * compared or propagated scores).
 */
export async function bm25Query(
  db: Database.Database,
  query: string,
  options: BM25QueryOptions = {},
): Promise<BM25Result[]> {
  const { limit = 20, label } = options;
  return searchGraph(db, query, { limit, label, mode: 'bm25', scope: 'all' }).map((r) => ({
    id: r.id,
    name: r.name,
    normLabel: r.normLabel,
    filePath: r.filePath,
    label: r.label,
    score: r.relevance,
    startLine: r.startLine,
    endLine: r.endLine,
  }));
}

/**
 * @deprecated Use {@link searchGraph} instead — this is a misleading name
 * (search here is lexical-only, not a hybrid of multiple retrieval
 * *modalities*). `hybridQuery` remains as an alias for backward compatibility
 * and will be removed in the next major version.
 */
export const hybridQuery = bm25Query;
