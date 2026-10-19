// File-size sweep: split out of fts-store.ts.

import type Database from 'better-sqlite3';
import { NOT_ANONYMOUS_CLOSURE_SQL } from './anonymous-closure.js';
import { extractSearchTerms } from './fts-store-terms.js';

export interface FtsResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  rank: number;
  /** First line of the symbol in its source file (1-based, null if unknown). */
  startLine: number | null;
  /** Last line of the symbol in its source file (1-based, null if unknown). */
  endLine: number | null;
}

/**
 * THE single conversion from FTS5's `rank` to monograph's score convention.
 *
 * SCORE CONVENTION: every score that leaves the search layer is
 * **higher-is-better and non-negative**. SQLite FTS5's `rank` is the opposite
 * (negative, and *more* negative means a *better* match), so a raw rank must
 * never escape this module — forwarding one into a ranker that takes maxima
 * lets an unrelated node sitting at 0 outrank a genuine match at -0.656.
 *
 * Maps |rank| through x/(1+x) into (0, 1): monotonically increasing, so
 * relative BM25 order is preserved, and bounded, so it composes with the
 * additive fuzzy/node-type bonuses without one term swamping the others.
 */
export function relevanceFromFtsRank(rank: number): number {
  const magnitude = Math.abs(rank);
  return magnitude / (1 + magnitude);
}

/** A single node label, or any of several (e.g. every code-symbol label). */
export type LabelFilter = string | readonly string[];

/** SQL fragment + params restricting `n.label`; expects the `n` alias. */
export function labelClause(label: LabelFilter): { sql: string; params: string[] } {
  const labels = typeof label === 'string' ? [label] : [...label];
  if (labels.length === 1) return { sql: ' AND n.label = ?', params: labels };
  return { sql: ` AND n.label IN (${labels.map(() => '?').join(',')})`, params: labels };
}

/**
 * Quote a single FTS5 search term as a string literal when it contains characters
 * that would otherwise be parsed as FTS5 syntax (quotes, parens, boolean keywords
 * like AND/OR/NOT, colons, hyphens, etc). Wrapping in double-quotes forces FTS5 to
 * treat the term as a literal string; any literal `"` inside the term is escaped by
 * doubling it, per FTS5's own string-literal quoting rules.
 */
function quoteFtsTerm(term: string): string {
  // Bare alphanumeric/underscore terms need no quoting and are the common case.
  if (/^[A-Za-z0-9_]+$/.test(term)) return term;
  const escaped = term.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Keyword search over node names and file paths (FTS5 trigram index), best
 * match first. A plain-language query that matches nothing is retried on the
 * identifier-like words extracted from it, and a short or malformed query falls
 * back to a substring (LIKE) match, so a search never fails on its syntax.
 */
export function ftsSearch(
  db: Database.Database,
  query: string,
  limit: number,
  label?: LabelFilter,
): FtsResult[] {
  // Sanitize: strip only characters that break FTS5 MATCH syntax (* still stripped,
  // trigram handles substring natively; " is now preserved since trigram doesn't need it removed)
  const safeQuery = query.replace(/[*]/g, ' ').trim();
  if (!safeQuery) return [];

  // Trigram handles substring matching natively — no need to append * to each term.
  // Quote each term individually so characters like `"`, `(`, `)`, or bare boolean
  // keywords (AND/OR/NOT) don't get parsed as FTS5 query syntax.
  const ftsQuery = safeQuery.split(/\s+/).map(quoteFtsTerm).join(' ');

  let matchSql = `
    SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
           n.start_line, n.end_line, nodes_fts.rank
    FROM nodes_fts
    JOIN nodes n ON n.rowid = nodes_fts.rowid
    WHERE nodes_fts MATCH ? AND ${NOT_ANONYMOUS_CLOSURE_SQL}
  `;
  const matchParams: unknown[] = [ftsQuery];
  if (label) {
    const lc = labelClause(label);
    matchSql += lc.sql;
    matchParams.push(...lc.params);
  }
  matchSql += ' ORDER BY nodes_fts.rank LIMIT ?';
  matchParams.push(limit);

  let matchRows: Record<string, unknown>[] = [];
  try {
    matchRows = db.prepare(matchSql).all(...(matchParams as [string, ...unknown[]])) as Record<
      string,
      unknown
    >[];
  } catch {
    // FTS MATCH can throw on malformed queries; fall through to LIKE path
  }

  // ── Intent-extraction fallback: when the raw query looks like natural language
  // and FTS returned nothing, extract code-relevant tokens and retry FTS. ──────
  if (matchRows.length === 0) {
    const extracted = extractSearchTerms(safeQuery);
    if (extracted.length > 0) {
      // Try each extracted term individually via FTS, then merge by best rank
      const termFtsQuery = extracted.map(quoteFtsTerm).join(' OR ');
      let termSql = `
        SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
               n.start_line, n.end_line, nodes_fts.rank
        FROM nodes_fts
        JOIN nodes n ON n.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH ? AND ${NOT_ANONYMOUS_CLOSURE_SQL}
      `;
      const termParams: unknown[] = [termFtsQuery];
      if (label) {
        const lc = labelClause(label);
        termSql += lc.sql;
        termParams.push(...lc.params);
      }
      termSql += ' ORDER BY nodes_fts.rank LIMIT ?';
      termParams.push(limit * 2);
      try {
        matchRows = db.prepare(termSql).all(...(termParams as [string, ...unknown[]])) as Record<
          string,
          unknown
        >[];
      } catch {
        /* FTS MATCH can throw on malformed queries */
      }

      // Also try individual LIKE for each extracted term to catch camelCase substrings
      if (matchRows.length < limit) {
        const seenIds = new Set(matchRows.map((r) => r.id as string));
        for (const term of extracted) {
          if (matchRows.length >= limit) break;
          const escapedTerm = term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
          const pat = `%${escapedTerm}%`;
          let termLikeSql = `
            SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
                   n.start_line, n.end_line, 0 AS rank
            FROM nodes n
            WHERE (n.name LIKE ? ESCAPE '\\' OR n.norm_label LIKE ? ESCAPE '\\')
              AND ${NOT_ANONYMOUS_CLOSURE_SQL}
          `;
          const termLikeParams: unknown[] = [pat, pat];
          if (label) {
            const lc = labelClause(label);
            termLikeSql += lc.sql;
            termLikeParams.push(...lc.params);
          }
          termLikeSql += ' LIMIT ?';
          termLikeParams.push(limit);
          const likeRows = db
            .prepare(termLikeSql)
            .all(...(termLikeParams as [string, ...unknown[]])) as Record<string, unknown>[];
          for (const r of likeRows) {
            if (!seenIds.has(r.id as string)) {
              matchRows.push(r);
              seenIds.add(r.id as string);
            }
          }
        }
      }
    }
  }

  // Run the LIKE fallback whenever MATCH threw (malformed/boolean-keyword query) or
  // returned zero rows — not just for short (≤2 char) queries. Short queries need it
  // because trigram requires ≥3 characters to fire; longer queries need it whenever
  // MATCH couldn't handle the syntax, so a query-syntax failure doesn't silently read
  // as "no results".
  if (safeQuery.length <= 2 || matchRows.length === 0) {
    const escapedQuery = safeQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const likePattern = `%${escapedQuery}%`;

    // Also try without file extension: "CLAUDE.md" → "CLAUDE"
    const dotIdx = safeQuery.lastIndexOf('.');
    const strippedLikePattern =
      dotIdx > 0 && dotIdx < safeQuery.length - 1
        ? `%${safeQuery.slice(0, dotIdx).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
        : null;

    let likeSql = `
      SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
             n.start_line, n.end_line, 0 AS rank
      FROM nodes n
      WHERE (n.name LIKE ? ESCAPE '\\' OR n.norm_label LIKE ? ESCAPE '\\' OR n.file_path LIKE ? ESCAPE '\\'`;
    const likeParams: unknown[] = [likePattern, likePattern, likePattern];
    if (strippedLikePattern) {
      likeSql += ` OR n.name LIKE ? ESCAPE '\\'`;
      likeParams.push(strippedLikePattern);
    }
    likeSql += `) AND ${NOT_ANONYMOUS_CLOSURE_SQL}`;
    if (label) {
      const lc = labelClause(label);
      likeSql += lc.sql;
      likeParams.push(...lc.params);
    }
    likeSql += ' LIMIT ?';
    likeParams.push(limit);

    const likeRows = db.prepare(likeSql).all(...(likeParams as [string, ...unknown[]])) as Record<
      string,
      unknown
    >[];

    // Merge: MATCH results first, append LIKE results not already present
    const seenIds = new Set(matchRows.map((r) => r.id as string));
    for (const r of likeRows) {
      if (!seenIds.has(r.id as string)) {
        matchRows.push(r);
        seenIds.add(r.id as string);
      }
    }
  }

  return matchRows.slice(0, limit).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    normLabel: r.norm_label as string,
    filePath: (r.file_path as string | null) ?? null,
    label: r.label as string,
    rank: r.rank as number,
    startLine: (r.start_line as number | null) ?? null,
    endLine: (r.end_line as number | null) ?? null,
  }));
}
