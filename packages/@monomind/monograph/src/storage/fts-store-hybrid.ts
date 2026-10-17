// ── Hybrid search ─────────────────────────────────────────────────────────────
// File-size sweep: split out of fts-store.ts.

import type Database from 'better-sqlite3';
import { NOT_ANONYMOUS_CLOSURE_SQL } from './anonymous-closure.js';
import {
  type FtsResult,
  ftsSearch,
  type LabelFilter,
  labelClause,
  relevanceFromFtsRank,
} from './fts-store-search.js';

export interface HybridSearchResult extends FtsResult {
  combinedScore: number;
  matchStrategy: 'fts' | 'like' | 'fuzzy';
}

/**
 * Computes an in-memory fuzzy sequence score for `query` against `name`.
 * Walks through query chars left-to-right, finding each in `name` sequentially.
 * Returns a score in [0, 1]: higher means a tighter match.
 */
function computeFuzzyScore(name: string, query: string): number {
  if (!query.length) return 0;
  const lname = name.toLowerCase();
  const lquery = query.toLowerCase();
  let nameIdx = 0;
  let matched = 0;
  let gapPenalty = 0;
  let lastMatchPos = -1;

  for (let qi = 0; qi < lquery.length; qi++) {
    const ch = lquery[qi];
    const pos = lname.indexOf(ch, nameIdx);
    if (pos === -1) break;
    matched++;
    if (lastMatchPos !== -1) {
      gapPenalty += pos - lastMatchPos - 1;
    }
    lastMatchPos = pos;
    nameIdx = pos + 1;
  }

  if (matched === 0) return 0;
  const matchRatio = matched / lquery.length;
  const normalizedGap = gapPenalty / (lname.length || 1);
  return matchRatio * (1 / (1 + normalizedGap));
}

/** Returns a small bonus based on node label to favour structural node types. */
function computeNodeTypeBonus(label: string): number {
  if (label === 'File' || label === 'Module') return 0.02;
  if (label === 'Class') return 0.01;
  return 0;
}

/**
 * Hybrid search combining three strategies:
 *  1. FTS5 (trigram) BM25 match via `ftsSearch`
 *  2. LIKE fallback for short queries (≤3 chars) or when FTS returns 0 results
 *  3. In-memory fuzzy character-sequence scoring applied to all candidates
 *
 * Results are deduped by id (highest combinedScore wins), re-ranked, and
 * trimmed to `limit`. The existing `ftsSearch` is left unchanged.
 */
export function hybridSearch(
  db: Database.Database,
  query: string,
  limit: number,
  label?: LabelFilter,
): HybridSearchResult[] {
  const safeQuery = query.replace(/[*]/g, ' ').trim();
  if (!safeQuery) return [];

  // id → best result so far
  const best = new Map<string, HybridSearchResult>();

  const upsert = (result: HybridSearchResult): void => {
    const existing = best.get(result.id);
    if (!existing || result.combinedScore > existing.combinedScore) {
      best.set(result.id, result);
    }
  };

  // ── Strategy 1: FTS5 BM25 ──────────────────────────────────────────────────
  const ftsRows = ftsSearch(db, safeQuery, limit * 2, label);
  for (const row of ftsRows) {
    const ftsScore = relevanceFromFtsRank(row.rank);
    const fuzz = computeFuzzyScore(row.name, safeQuery);
    const combined = ftsScore + fuzz + computeNodeTypeBonus(row.label);
    upsert({ ...row, combinedScore: combined, matchStrategy: 'fts' });
  }

  // ── Strategy 2: LIKE fallback ──────────────────────────────────────────────
  // Always run for short queries (≤3 chars) or when FTS returned nothing.
  if (safeQuery.length <= 3 || ftsRows.length === 0) {
    const escapedSafeQuery = safeQuery
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const likePattern = `%${escapedSafeQuery}%`;
    let likeSql = `
      SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
             n.start_line, n.end_line
      FROM nodes n
      WHERE (n.name LIKE ? ESCAPE '\\' OR n.norm_label LIKE ? ESCAPE '\\')
        AND ${NOT_ANONYMOUS_CLOSURE_SQL}
    `;
    const likeParams: unknown[] = [likePattern, likePattern];
    if (label) {
      const lc = labelClause(label);
      likeSql += lc.sql;
      likeParams.push(...lc.params);
    }
    likeSql += ' LIMIT ?';
    likeParams.push(limit * 2);

    const likeRows = db.prepare(likeSql).all(...(likeParams as [string, ...unknown[]])) as Record<
      string,
      unknown
    >[];

    for (const r of likeRows) {
      const name = r.name as string;
      const lbl = r.label as string;
      const fuzz = computeFuzzyScore(name, safeQuery);
      const combined = 0.3 + fuzz + computeNodeTypeBonus(lbl);
      upsert({
        id: r.id as string,
        name,
        normLabel: r.norm_label as string,
        filePath: (r.file_path as string | null) ?? null,
        label: lbl,
        rank: 0,
        startLine: (r.start_line as number | null) ?? null,
        endLine: (r.end_line as number | null) ?? null,
        combinedScore: combined,
        matchStrategy: 'like',
      });
    }
  }

  // ── Sort, dedupe (handled by Map), slice ───────────────────────────────────
  return Array.from(best.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);
}
