import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative } from 'path';

export type ChurnTrend = 'accelerating' | 'stable' | 'cooling';

export interface SinceDuration {
  raw: string;
  days: number;
}

export interface AuthorContribution {
  authorIdx: number;
  weightedCommits: number;
}

export interface FileChurn {
  path: string;
  totalCommits: number;
  weightedCommits: number;
  authors: AuthorContribution[];
  trend: ChurnTrend;
}

export interface ChurnResult {
  files: FileChurn[];
  authorPool: string[];
  since: SinceDuration;
}

export function parseSince(s: string): SinceDuration {
  const dMatch = s.match(/^(\d+)d$/);
  if (dMatch) return { raw: s, days: parseInt(dMatch[1], 10) };

  const wMatch = s.match(/^(\d+)w$/);
  if (wMatch) return { raw: s, days: parseInt(wMatch[1], 10) * 14 };

  const mMatch = s.match(/^(\d+)m$/);
  if (mMatch) return { raw: s, days: parseInt(mMatch[1], 10) * 30 };

  const yMatch = s.match(/^(\d+)y$/);
  if (yMatch) return { raw: s, days: parseInt(yMatch[1], 10) * 365 };

  // ISO date string
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    const days = Math.ceil((Date.now() - parsed) / 86400000);
    return { raw: s, days };
  }

  // Fallback: try to parse as plain number of days
  const num = parseInt(s, 10);
  if (!isNaN(num)) return { raw: s, days: num };

  return { raw: s, days: 30 };
}

export function computeRecencyWeight(ageDays: number): number {
  return Math.exp(-Math.LN2 * ageDays / 90);
}

export function classifyChurnTrend(recentWeighted: number, olderWeighted: number): ChurnTrend {
  if (olderWeighted === 0) {
    return recentWeighted > 0 ? 'accelerating' : 'stable';
  }
  const ratio = recentWeighted / olderWeighted;
  if (ratio > 1.5) return 'accelerating';
  if (ratio < 0.67) return 'cooling';
  return 'stable';
}

export async function analyzeChurn(
  root: string,
  since: SinceDuration | string,
): Promise<ChurnResult> {
  const sinceDuration: SinceDuration =
    typeof since === 'string' ? parseSince(since) : since;

  // Cache lookup
  const cacheDir = join(root, '.monograph', 'cache');
  let treeHash = '';
  try {
    treeHash = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
    const cacheFile = join(cacheDir, `churn-${treeHash}.json`);
    if (existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
        return cached as ChurnResult;
      } catch {
        // cache corrupt, recompute
      }
    }
  } catch {
    // git not available or no commits
  }

  // Build since date string for git log
  const sinceDate = new Date(Date.now() - sinceDuration.days * 86400000);
  const sinceDateStr = sinceDate.toISOString().slice(0, 10);

  // Get all commits with file paths
  let logOutput = '';
  try {
    logOutput = execSync(
      `git log --after="${sinceDateStr}" --name-only --format="%ae|%ai"`,
      { cwd: root, maxBuffer: 50 * 1024 * 1024 },
    ).toString();
  } catch {
    return { files: [], authorPool: [], since: sinceDuration };
  }

  const now = Date.now();

  // Parse log output into per-file commit lists: { email, dateStr }[]
  const fileCommits = new Map<string, Array<{ email: string; dateStr: string }>>();
  const authorIndexMap = new Map<string, number>();
  const authorPool: string[] = [];

  const lines = logOutput.split('\n');
  let currentEmail = '';
  let currentDateStr = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes('|')) {
      // Header line: email|date
      const pipeIdx = trimmed.indexOf('|');
      currentEmail = trimmed.slice(0, pipeIdx).trim();
      currentDateStr = trimmed.slice(pipeIdx + 1).trim();
    } else {
      // File path line
      const filePath = trimmed;
      if (!fileCommits.has(filePath)) {
        fileCommits.set(filePath, []);
      }
      fileCommits.get(filePath)!.push({ email: currentEmail, dateStr: currentDateStr });
    }
  }

  // Build FileChurn entries
  const files: FileChurn[] = [];

  for (const [path, commits] of fileCommits) {
    if (commits.length === 0) continue;

    // Sort commits by date descending (newest first)
    const sortedCommits = commits.slice().sort((a, b) => {
      return Date.parse(b.dateStr) - Date.parse(a.dateStr);
    });

    // Compute weighted commits per author and trend
    const authorWeights = new Map<number, number>();
    let totalWeighted = 0;

    // Split into two halves for trend analysis
    const midpoint = Math.floor(sortedCommits.length / 2);
    let recentWeighted = 0;
    let olderWeighted = 0;

    for (let i = 0; i < sortedCommits.length; i++) {
      const commit = sortedCommits[i];
      const commitDate = Date.parse(commit.dateStr);
      const ageDays = (now - commitDate) / 86400000;
      const weight = computeRecencyWeight(ageDays);

      // Author index
      if (!authorIndexMap.has(commit.email)) {
        authorIndexMap.set(commit.email, authorPool.length);
        authorPool.push(commit.email);
      }
      const authorIdx = authorIndexMap.get(commit.email)!;

      const existing = authorWeights.get(authorIdx) ?? 0;
      authorWeights.set(authorIdx, existing + weight);
      totalWeighted += weight;

      // recent = first half (newest), older = second half
      if (i < midpoint) {
        recentWeighted += weight;
      } else {
        olderWeighted += weight;
      }
    }

    const trend = classifyChurnTrend(recentWeighted, olderWeighted);

    const authors: AuthorContribution[] = Array.from(authorWeights.entries()).map(
      ([authorIdx, weightedCommits]) => ({ authorIdx, weightedCommits }),
    );

    files.push({
      path,
      totalCommits: commits.length,
      weightedCommits: totalWeighted,
      authors,
      trend,
    });
  }

  const result: ChurnResult = { files, authorPool, since: sinceDuration };

  // Write cache
  if (treeHash) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      const cacheFile = join(cacheDir, `churn-${treeHash}.json`);
      writeFileSync(cacheFile, JSON.stringify(result), 'utf8');
    } catch {
      // cache write failure is non-fatal
    }
  }

  return result;
}
