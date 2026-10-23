// ── Natural-language search over symbol summaries ────────────────────────────

import type Database from 'better-sqlite3';
import { NOT_ANONYMOUS_CLOSURE_SQL } from './anonymous-closure.js';
import { type FtsResult, type LabelFilter, labelClause } from './fts-store-search.js';
import { STOPWORDS } from './fts-store-terms.js';

/** Words so generic in a question about code that they only add noise. */
const GENERIC_WORDS = new Set(['handle', 'handles', 'work', 'works', 'thing', 'things', 'code']);

/** Content words of a query: lowercased, stopwords and 1–2 letter tokens dropped. */
export function contentWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !GENERIC_WORDS.has(w));
  return [...new Set(words)];
}

/**
 * Stemmed BM25 over `node_summaries_fts`. Terms are OR-ed — a natural-language
 * question rarely repeats every word a symbol is described with — and BM25
 * rewards the symbols that match the most of them. Returns `[]` for queries
 * with fewer than `minWords` (default two) content words (a bare identifier is the lexical path's
 * job) or when the table is missing/empty (index built before summaries).
 */
export function summarySearch(
  db: Database.Database,
  query: string,
  limit: number,
  label?: LabelFilter,
  minWords = 2,
): FtsResult[] {
  const words = contentWords(query);
  if (words.length < minWords) return [];
  const match = words.map((w) => `"${w}"`).join(' OR ');
  let sql = `
    SELECT n.id, n.name, n.norm_label, n.file_path, n.label, n.start_line, n.end_line,
           node_summaries_fts.rank AS rank
    FROM node_summaries_fts
    JOIN nodes n ON n.id = node_summaries_fts.node_id
    WHERE node_summaries_fts MATCH ? AND ${NOT_ANONYMOUS_CLOSURE_SQL}`;
  const params: unknown[] = [match];
  if (label) {
    const lc = labelClause(label);
    sql += lc.sql;
    params.push(...lc.params);
  }
  sql += ' ORDER BY node_summaries_fts.rank LIMIT ?';
  params.push(limit);
  try {
    const rows = db.prepare(sql).all(...(params as [string, ...unknown[]])) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      normLabel: r.norm_label as string,
      filePath: (r.file_path as string | null) ?? null,
      label: r.label as string,
      rank: r.rank as number,
      startLine: (r.start_line as number | null) ?? null,
      endLine: (r.end_line as number | null) ?? null,
    }));
  } catch {
    return [];
  }
}
