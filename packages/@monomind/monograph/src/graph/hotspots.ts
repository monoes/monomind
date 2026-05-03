import { execSync } from 'child_process';
import type Database from 'better-sqlite3';

export interface HotspotResult {
  nodeId: string;
  nodeName: string;
  filePath: string;
  label: string;
  communityId: number | null;
  /** Recency-weighted commit count (exponential decay, half-life 90 days) */
  churnScore: number;
  /** Raw commit count in the analysis window */
  rawCommitCount: number;
  /** Graph centrality: in+out degree */
  centralityScore: number;
  /** Combined hotspot score: churnScore * centralityScore */
  hotspotScore: number;
  /** Trend based on recent vs older half of window */
  trend: 'accelerating' | 'stable' | 'cooling';
  /** Last commit date for this file */
  lastCommitDate: string | null;
}

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
export function computeHotspots(
  db: Database.Database,
  projectDir: string,
  options: {
    windowDays?: number;
    limit?: number;
    minCommits?: number;
  } = {},
): HotspotResult[] {
  const windowDays = options.windowDays ?? 365;
  const limit = options.limit ?? 20;
  const minCommits = options.minCommits ?? 2;
  const now = Date.now();
  const HALF_LIFE_DAYS = 90;

  // ── Step 1: Get git log with dates ────────────────────────────────────────
  // Format: ISO-date\tfile-path (one per changed file per commit)
  let gitOutput = '';
  try {
    gitOutput = execSync(
      `git log --since="${windowDays} days ago" --name-only --pretty=format:"%ci" -- .`,
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    ).toString();
  } catch {
    return []; // not a git repo or git not available
  }

  // ── Step 2: Parse git log and compute churn scores ────────────────────────
  // Map: filePath → { weightedScore, rawCount, recentCount, oldCount, lastDate }
  type FileChurn = {
    weightedScore: number;
    rawCount: number;
    recentCount: number;   // commits in first half of window
    oldCount: number;      // commits in second half of window
    lastDate: string | null;
  };
  const churnMap = new Map<string, FileChurn>();

  const halfWindowMs = (windowDays / 2) * 24 * 60 * 60 * 1000;
  let currentDate = '';

  for (const line of gitOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Detect date line (ISO format from %ci)
    if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
      currentDate = trimmed.split(' ')[0]; // YYYY-MM-DD
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
      const entry = churnMap.get(filePath)!;
      entry.weightedScore += weight;
      entry.rawCount += 1;
      if (!entry.lastDate || currentDate > entry.lastDate) entry.lastDate = currentDate;
      // Recent vs old split for trend
      if (ageMs <= halfWindowMs) {
        entry.recentCount += 1;
      } else {
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
  `).all() as { id: string; name: string; file_path: string; label: string; community_id: number | null; degree: number }[];

  // ── Step 4: Join churn + centrality ──────────────────────────────────────
  const results: HotspotResult[] = [];

  for (const node of fileNodes) {
    // Try to match by relative file path
    const relPath = node.file_path
      .replace(projectDir + '/', '')
      .replace(projectDir + '\\', '');
    const churn = churnMap.get(relPath) ?? churnMap.get(node.file_path);
    if (!churn || churn.rawCount < minCommits) continue;

    const centralityScore = Math.log1p(node.degree); // log scale to normalize

    // Trend: accelerating if recent half > 1.5x old half (normalized by window)
    let trend: 'accelerating' | 'stable' | 'cooling' = 'stable';
    if (churn.oldCount === 0 && churn.recentCount > 0) {
      trend = 'accelerating';
    } else if (churn.recentCount > 0 && churn.oldCount > 0) {
      const ratio = churn.recentCount / churn.oldCount;
      if (ratio > 1.5) trend = 'accelerating';
      else if (ratio < 0.5) trend = 'cooling';
    } else if (churn.recentCount === 0 && churn.oldCount > 0) {
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
