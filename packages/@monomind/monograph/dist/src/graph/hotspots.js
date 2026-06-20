import { execSync } from 'child_process';
// ── Process-scoped TTL cache for expensive git log calls ─────────────────────
// Key: `${projectDir}:${windowDays}` → { output, ts }
const GIT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const gitLogCache = new Map();
/**
 * Compute hotspot scores for all file nodes in the graph.
 * Combines recency-weighted git churn (half-life 90 days) with
 * graph centrality (in+out degree) to identify high-risk files.
 *
 * @param db - monograph database
 * @param projectDir - repo root (for git log)
 * @param options.windowDays - git log window (default 365)
 * @param options.limit - max results (default 20)
 * @param options.minCommits - filter files with fewer commits (default 2)
 */
export function computeHotspots(db, projectDir, options = {}) {
    const windowDays = options.windowDays ?? 365;
    const limit = options.limit ?? 20;
    const minCommits = options.minCommits ?? 2;
    const now = Date.now();
    const HALF_LIFE_DAYS = 90;
    // ── Step 1: Get git log with dates (TTL-cached per projectDir+window) ────
    // Format: ISO-date\tfile-path (one per changed file per commit)
    let gitOutput = '';
    const cacheKey = `${projectDir}:${windowDays}`;
    const cached = gitLogCache.get(cacheKey);
    if (cached && now - cached.ts < GIT_CACHE_TTL_MS) {
        gitOutput = cached.output;
    }
    else {
        try {
            gitOutput = execSync(`git log --since="${windowDays} days ago" --name-only --pretty=format:"%ci" -- .`, { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 }).toString();
            gitLogCache.set(cacheKey, { output: gitOutput, ts: now });
        }
        catch {
            return []; // not a git repo or git not available
        }
    }
    const churnMap = new Map();
    const halfWindowMs = (windowDays / 2) * 24 * 60 * 60 * 1000;
    let currentDate = '';
    for (const line of gitOutput.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        // Detect date line (ISO format from %ci: "YYYY-MM-DD HH:MM:SS +ZZZZ")
        // Full-format match prevents dated filenames like "2026-01-01-notes.md" from
        // being misidentified as commit timestamps and poisoning subsequent churn scores.
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(trimmed)) {
            currentDate = trimmed.slice(0, 10); // YYYY-MM-DD
            continue;
        }
        // File path line
        if (currentDate && trimmed && !trimmed.startsWith('diff')) {
            const filePath = trimmed;
            const commitDate = new Date(currentDate).getTime();
            const ageMs = now - commitDate;
            const ageDays = ageMs / (24 * 60 * 60 * 1000);
            // Exponential decay: weight = 2^(-ageDays/halfLife)
            const weight = Math.pow(2, -ageDays / HALF_LIFE_DAYS);
            if (!churnMap.has(filePath)) {
                churnMap.set(filePath, { weightedScore: 0, rawCount: 0, recentCount: 0, oldCount: 0, lastDate: null });
            }
            const entry = churnMap.get(filePath);
            entry.weightedScore += weight;
            entry.rawCount += 1;
            if (!entry.lastDate || currentDate > entry.lastDate)
                entry.lastDate = currentDate;
            // Recent vs old split for trend
            if (ageMs <= halfWindowMs) {
                entry.recentCount += 1;
            }
            else {
                entry.oldCount += 1;
            }
        }
    }
    // ── Step 3: Get file nodes + centrality from DB ───────────────────────────
    const fileNodes = db.prepare(`
    SELECT n.id, n.name, n.file_path, n.label, n.community_id,
           COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as degree
    FROM nodes n
    LEFT JOIN edges e1 ON e1.source_id = n.id
    LEFT JOIN edges e2 ON e2.target_id = n.id
    WHERE n.label = 'File' AND n.file_path IS NOT NULL
    GROUP BY n.id
  `).all();
    // ── Step 4: Join churn + centrality ──────────────────────────────────────
    const results = [];
    for (const node of fileNodes) {
        // Try to match by relative file path
        const relPath = node.file_path
            .replace(projectDir + '/', '')
            .replace(projectDir + '\\', '');
        const churn = churnMap.get(relPath) ?? churnMap.get(node.file_path);
        if (!churn || churn.rawCount < minCommits)
            continue;
        const centralityScore = Math.log1p(node.degree); // log scale to normalize
        // Trend: accelerating if recent half > 1.5x old half (normalized by window)
        let trend = 'stable';
        if (churn.oldCount === 0 && churn.recentCount > 0) {
            trend = 'accelerating';
        }
        else if (churn.recentCount > 0 && churn.oldCount > 0) {
            const ratio = churn.recentCount / churn.oldCount;
            if (ratio > 1.5)
                trend = 'accelerating';
            else if (ratio < 0.5)
                trend = 'cooling';
        }
        else if (churn.recentCount === 0 && churn.oldCount > 0) {
            trend = 'cooling';
        }
        results.push({
            nodeId: node.id,
            nodeName: node.name,
            filePath: node.file_path,
            label: node.label,
            communityId: node.community_id,
            churnScore: churn.weightedScore,
            rawCommitCount: churn.rawCount,
            centralityScore,
            hotspotScore: churn.weightedScore * centralityScore,
            trend,
            lastCommitDate: churn.lastDate,
        });
    }
    // Sort by hotspotScore descending, return top N
    return results
        .sort((a, b) => b.hotspotScore - a.hotspotScore)
        .slice(0, limit);
}
/**
 * Format hotspot results as structured text with file:line hints for LLM navigation.
 *
 * @param hotspots - Results from computeHotspots()
 * @returns structured text suitable for LLM consumption
 */
export function formatHotspots(hotspots) {
    if (hotspots.length === 0) {
        return 'hotspots: none found (insufficient git history or no matching file nodes)\n';
    }
    const trendMark = (t) => {
        if (t === 'accelerating')
            return '+';
        if (t === 'cooling')
            return '-';
        return '~';
    };
    const lines = [
        `hotspots: ${hotspots.length} high-risk files (churn x centrality)`,
        '',
    ];
    hotspots.forEach((h, i) => {
        lines.push(`[${i + 1}] ${h.nodeName}  trend:${trendMark(h.trend)}`);
        lines.push(`  file: ${h.filePath}:1`);
        lines.push(`  score: ${h.hotspotScore.toFixed(2)}  churn: ${h.churnScore.toFixed(2)}  centrality: ${h.centralityScore.toFixed(2)}`);
        lines.push(`  commits: ${h.rawCommitCount}  last: ${h.lastCommitDate ?? 'unknown'}`);
        lines.push('');
    });
    const accelerating = hotspots.filter(h => h.trend === 'accelerating').length;
    const cooling = hotspots.filter(h => h.trend === 'cooling').length;
    lines.push(`summary: ${accelerating} accelerating, ${cooling} cooling, ${hotspots.length - accelerating - cooling} stable`);
    return lines.join('\n');
}
//# sourceMappingURL=hotspots.js.map