/**
 * Quote a single FTS5 search term as a string literal when it contains characters
 * that would otherwise be parsed as FTS5 syntax (quotes, parens, boolean keywords
 * like AND/OR/NOT, colons, hyphens, etc). Wrapping in double-quotes forces FTS5 to
 * treat the term as a literal string; any literal `"` inside the term is escaped by
 * doubling it, per FTS5's own string-literal quoting rules.
 */
function quoteFtsTerm(term) {
    // Bare alphanumeric/underscore terms need no quoting and are the common case.
    if (/^[A-Za-z0-9_]+$/.test(term))
        return term;
    const escaped = term.replace(/"/g, '""');
    return `"${escaped}"`;
}
export function ftsSearch(db, query, limit, label) {
    // Sanitize: strip only characters that break FTS5 MATCH syntax (* still stripped,
    // trigram handles substring natively; " is now preserved since trigram doesn't need it removed)
    const safeQuery = query.replace(/[*]/g, ' ').trim();
    if (!safeQuery)
        return [];
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
    const matchParams = [ftsQuery];
    if (label) {
        matchSql += ' AND n.label = ?';
        matchParams.push(label);
    }
    matchSql += ' ORDER BY nodes_fts.rank LIMIT ?';
    matchParams.push(limit);
    let matchRows = [];
    try {
        matchRows = db.prepare(matchSql).all(...matchParams);
    }
    catch {
        // FTS MATCH can throw on malformed queries; fall through to LIKE path
    }
    // Run the LIKE fallback whenever MATCH threw (malformed/boolean-keyword query) or
    // returned zero rows — not just for short (≤2 char) queries. Short queries need it
    // because trigram requires ≥3 characters to fire; longer queries need it whenever
    // MATCH couldn't handle the syntax, so a query-syntax failure doesn't silently read
    // as "no results".
    if (safeQuery.length <= 2 || matchRows.length === 0) {
        const escapedQuery = safeQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const likePattern = `%${escapedQuery}%`;
        let likeSql = `
      SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
             n.start_line, n.end_line, 0 AS rank
      FROM nodes n
      WHERE (n.name LIKE ? ESCAPE '\\' OR n.norm_label LIKE ? ESCAPE '\\' OR n.file_path LIKE ? ESCAPE '\\')
    `;
        const likeParams = [likePattern, likePattern, likePattern];
        if (label) {
            likeSql += ' AND n.label = ?';
            likeParams.push(label);
        }
        likeSql += ' LIMIT ?';
        likeParams.push(limit);
        const likeRows = db.prepare(likeSql).all(...likeParams);
        // Merge: MATCH results first, append LIKE results not already present
        const seenIds = new Set(matchRows.map((r) => r.id));
        for (const r of likeRows) {
            if (!seenIds.has(r.id)) {
                matchRows.push(r);
                seenIds.add(r.id);
            }
        }
    }
    return matchRows.slice(0, limit).map((r) => ({
        id: r.id,
        name: r.name,
        normLabel: r.norm_label,
        filePath: r.file_path ?? null,
        label: r.label,
        rank: r.rank,
        startLine: r.start_line ?? null,
        endLine: r.end_line ?? null,
    }));
}
/**
 * Computes an in-memory fuzzy sequence score for `query` against `name`.
 * Walks through query chars left-to-right, finding each in `name` sequentially.
 * Returns a score in [0, 1]: higher means a tighter match.
 */
function computeFuzzyScore(name, query) {
    if (!query.length)
        return 0;
    const lname = name.toLowerCase();
    const lquery = query.toLowerCase();
    let nameIdx = 0;
    let matched = 0;
    let gapPenalty = 0;
    let lastMatchPos = -1;
    for (let qi = 0; qi < lquery.length; qi++) {
        const ch = lquery[qi];
        const pos = lname.indexOf(ch, nameIdx);
        if (pos === -1)
            break;
        matched++;
        if (lastMatchPos !== -1) {
            gapPenalty += pos - lastMatchPos - 1;
        }
        lastMatchPos = pos;
        nameIdx = pos + 1;
    }
    if (matched === 0)
        return 0;
    const matchRatio = matched / lquery.length;
    const normalizedGap = gapPenalty / (lname.length || 1);
    return matchRatio * (1 / (1 + normalizedGap));
}
/** Returns a small bonus based on node label to favour structural node types. */
function computeNodeTypeBonus(label) {
    if (label === 'File' || label === 'Module')
        return 0.02;
    if (label === 'Class')
        return 0.01;
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
export function hybridSearch(db, query, limit, label) {
    const safeQuery = query.replace(/[*]/g, ' ').trim();
    if (!safeQuery)
        return [];
    // id → best result so far
    const best = new Map();
    const upsert = (result) => {
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
        const likeParams = [likePattern, likePattern];
        if (label) {
            likeSql += ' AND n.label = ?';
            likeParams.push(label);
        }
        likeSql += ' LIMIT ?';
        likeParams.push(limit * 2);
        const likeRows = db
            .prepare(likeSql)
            .all(...likeParams);
        for (const r of likeRows) {
            const name = r.name;
            const lbl = r.label;
            const fuzz = computeFuzzyScore(name, safeQuery);
            const combined = 0.3 + fuzz + computeNodeTypeBonus(lbl);
            upsert({
                id: r.id,
                name,
                normLabel: r.norm_label,
                filePath: r.file_path ?? null,
                label: lbl,
                rank: 0,
                startLine: r.start_line ?? null,
                endLine: r.end_line ?? null,
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
//# sourceMappingURL=fts-store.js.map