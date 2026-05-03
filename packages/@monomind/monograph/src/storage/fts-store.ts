import type Database from 'better-sqlite3';

export interface FtsResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  rank: number;
}

export function ftsSearch(
  db: Database.Database,
  query: string,
  limit: number,
  label?: string,
): FtsResult[] {
  // Sanitize: strip only characters that break FTS5 MATCH syntax (* still stripped,
  // trigram handles substring natively; " is now preserved since trigram doesn't need it removed)
  const safeQuery = query.replace(/[*]/g, ' ').trim();
  if (!safeQuery) return [];

  // Trigram handles substring matching natively — no need to append * to each term
  const ftsQuery = safeQuery.split(/\s+/).join(' ');

  let matchSql = `
    SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
           nodes_fts.rank
    FROM nodes_fts
    JOIN nodes n ON n.rowid = nodes_fts.rowid
    WHERE nodes_fts MATCH ?
  `;
  const matchParams: unknown[] = [ftsQuery];
  if (label) {
    matchSql += ' AND n.label = ?';
    matchParams.push(label);
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

  // For short queries (≤2 chars) trigram requires at least 3 characters to fire, so
  // supplement with a LIKE fallback to catch single/double-character matches.
  if (safeQuery.length <= 2) {
    const likePattern = `%${safeQuery}%`;
    let likeSql = `
      SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
             0 AS rank
      FROM nodes n
      WHERE (n.name LIKE ? OR n.norm_label LIKE ? OR n.file_path LIKE ?)
    `;
    const likeParams: unknown[] = [likePattern, likePattern, likePattern];
    if (label) {
      likeSql += ' AND n.label = ?';
      likeParams.push(label);
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
  }));
}

// ── Hybrid search ─────────────────────────────────────────────────────────────

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
  label?: string,
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
    // FTS5 rank is negative; normalise to (0, 1]
    const ftsScore = 1 / (1 + Math.abs(row.rank));
    const fuzz = computeFuzzyScore(row.name, safeQuery);
    const combined = ftsScore + fuzz + computeNodeTypeBonus(row.label);
    upsert({ ...row, combinedScore: combined, matchStrategy: 'fts' });
  }

  // ── Strategy 2: LIKE fallback ──────────────────────────────────────────────
  // Always run for short queries (≤3 chars) or when FTS returned nothing.
  if (safeQuery.length <= 3 || ftsRows.length === 0) {
    const likePattern = `%${safeQuery}%`;
    let likeSql = `
      SELECT n.id, n.name, n.norm_label, n.file_path, n.label
      FROM nodes n
      WHERE (n.name LIKE ? OR n.norm_label LIKE ?)
    `;
    const likeParams: unknown[] = [likePattern, likePattern];
    if (label) {
      likeSql += ' AND n.label = ?';
      likeParams.push(label);
    }
    likeSql += ' LIMIT ?';
    likeParams.push(limit * 2);

    const likeRows = db
      .prepare(likeSql)
      .all(...(likeParams as [string, ...unknown[]])) as Record<string, unknown>[];

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
