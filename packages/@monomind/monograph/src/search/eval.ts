/**
 * Retrieval evaluation: run gold queries through {@link searchGraph} and report
 * how often, and how high, the expected node shows up.
 *
 * A case passes at rank r when any hit's name or file path contains one of its
 * `expect` strings (case-insensitive). Substring matching keeps gold files
 * stable across line-number and id-scheme changes.
 */

import type Database from 'better-sqlite3';
import { type GraphSearchOptions, searchGraph } from './hybrid-query.js';

export interface EvalCase {
  query: string;
  /** Any hit whose name or filePath contains one of these counts as found. */
  expect: string[];
  /** Free-form bucket for the report: exact, ambiguous, natural, doc, dependency. */
  kind?: string;
  scope?: GraphSearchOptions['scope'];
}

export interface EvalCaseResult {
  query: string;
  kind: string;
  /** 1-based rank of the first expected hit, or null when absent from the top k. */
  rank: number | null;
}

export interface EvalReport {
  k: number;
  cases: number;
  recallAtK: number;
  /** Mean reciprocal rank: 1/rank per case, 0 when absent. */
  mrr: number;
  byKind: Record<string, { cases: number; recallAtK: number; mrr: number }>;
  results: EvalCaseResult[];
}

export function evaluateRetrieval(
  db: Database.Database,
  cases: EvalCase[],
  options: { k?: number; search?: Partial<GraphSearchOptions> } = {},
): EvalReport {
  const k = options.k ?? 10;
  const results: EvalCaseResult[] = cases.map((c) => {
    const hits = searchGraph(db, c.query, {
      ...options.search,
      scope: c.scope ?? options.search?.scope,
      limit: k,
    });
    const wanted = c.expect.map((e) => e.toLowerCase());
    const idx = hits.findIndex((h) =>
      wanted.some(
        (w) => h.name.toLowerCase().includes(w) || (h.filePath ?? '').toLowerCase().includes(w),
      ),
    );
    return { query: c.query, kind: c.kind ?? 'general', rank: idx === -1 ? null : idx + 1 };
  });

  const summarize = (rs: EvalCaseResult[]) => ({
    cases: rs.length,
    recallAtK: rs.length ? rs.filter((r) => r.rank !== null).length / rs.length : 0,
    mrr: rs.length ? rs.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / rs.length : 0,
  });
  const byKind: EvalReport['byKind'] = {};
  for (const kind of new Set(results.map((r) => r.kind))) {
    byKind[kind] = summarize(results.filter((r) => r.kind === kind));
  }
  return { k, ...summarize(results), byKind, results };
}
