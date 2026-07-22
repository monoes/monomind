import type Database from 'better-sqlite3';

// ── Intent-to-identifier extraction ──────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must','can',
  'could','am','it','its','i','me','my','we','our','you','your','he','she',
  'they','them','their','this','that','these','those','of','in','to','for',
  'with','on','at','from','by','about','as','into','through','during','before',
  'after','above','below','between','out','off','over','under','again','then',
  'once','here','there','when','where','why','how','all','both','each','every',
  'few','more','most','other','some','such','no','nor','not','only','own',
  'same','so','than','too','very','just','because','but','and','or','if',
  'while','what','which','who','whom','up','down','get','set','add','use',
  'find','show','make','let','want','need','like','look','also','new','old',
]);

/**
 * Extract code-relevant search terms from a natural-language query.
 * Strips stopwords, splits camelCase/PascalCase/snake_case, and strips
 * file extensions (so "CLAUDE.md" also tries "CLAUDE").
 * Returns an empty array when the query is already a bare identifier.
 */
export function extractSearchTerms(query: string): string[] {
  const words = query.split(/[\s,;:!?()\[\]{}'"]+/).filter(Boolean);
  // If query is a single token or all tokens are code-like, it's already an identifier query
  if (words.length <= 1) return [];
  const hasStopword = words.some(w => STOPWORDS.has(w.toLowerCase()));
  if (!hasStopword && words.length <= 3) return [];

  const terms = new Set<string>();
  for (const word of words) {
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    if (word.length < 3) continue;

    // Strip file extensions: "CLAUDE.md" → also add "CLAUDE"
    const dotIdx = word.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < word.length - 1) {
      terms.add(word.slice(0, dotIdx));
      terms.add(word);
    }

    // Split camelCase/PascalCase: "ExtensionBridge" → "Extension", "Bridge"
    const camelParts = word.replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_-]+/)
      .filter(p => p.length >= 3 && !STOPWORDS.has(p.toLowerCase()));
    if (camelParts.length > 1) {
      for (const part of camelParts) terms.add(part);
    }

    // Keep the original word
    terms.add(word);
  }

  return Array.from(terms);
}

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

  // Trigram handles substring matching natively — no need to append * to each term.
  // Quote each term individually so characters like `"`, `(`, `)`, or bare boolean
  // keywords (AND/OR/NOT) don't get parsed as FTS5 query syntax.
  const ftsQuery = safeQuery
    .split(/\s+/)
    .map(quoteFtsTerm)
    .join(' ');

  let matchSql = `
    SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
           n.start_line, n.end_line, nodes_fts.rank
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
        WHERE nodes_fts MATCH ?
      `;
      const termParams: unknown[] = [termFtsQuery];
      if (label) {
        termSql += ' AND n.label = ?';
        termParams.push(label);
      }
      termSql += ' ORDER BY nodes_fts.rank LIMIT ?';
      termParams.push(limit * 2);
      try {
        matchRows = db.prepare(termSql).all(...(termParams as [string, ...unknown[]])) as Record<string, unknown>[];
      } catch { /* FTS MATCH can throw on malformed queries */ }

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
          `;
          const termLikeParams: unknown[] = [pat, pat];
          if (label) {
            termLikeSql += ' AND n.label = ?';
            termLikeParams.push(label);
          }
          termLikeSql += ' LIMIT ?';
          termLikeParams.push(limit);
          const likeRows = db.prepare(termLikeSql).all(...(termLikeParams as [string, ...unknown[]])) as Record<string, unknown>[];
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
    const strippedLikePattern = (dotIdx > 0 && dotIdx < safeQuery.length - 1)
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
    likeSql += ')';
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
    startLine: (r.start_line as number | null) ?? null,
    endLine: (r.end_line as number | null) ?? null,
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
    // FTS5 rank is negative; larger magnitude = better match. Map to (0,1) with higher = better.
    const absRank = Math.abs(row.rank);
    const ftsScore = absRank / (1 + absRank);
    const fuzz = computeFuzzyScore(row.name, safeQuery);
    const combined = ftsScore + fuzz + computeNodeTypeBonus(row.label);
    upsert({ ...row, combinedScore: combined, matchStrategy: 'fts' });
  }

  // ── Strategy 2: LIKE fallback ──────────────────────────────────────────────
  // Always run for short queries (≤3 chars) or when FTS returned nothing.
  if (safeQuery.length <= 3 || ftsRows.length === 0) {
    const escapedSafeQuery = safeQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const likePattern = `%${escapedSafeQuery}%`;
    let likeSql = `
      SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
             n.start_line, n.end_line
      FROM nodes n
      WHERE (n.name LIKE ? ESCAPE '\\' OR n.norm_label LIKE ? ESCAPE '\\')
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
