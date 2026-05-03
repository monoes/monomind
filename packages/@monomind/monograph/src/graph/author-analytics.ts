import { execSync } from 'child_process';
import type { MonographDb } from '../storage/db.js';

export type ChurnTrend = 'accelerating' | 'stable' | 'declining';

export interface AuthorStats {
  author: string;
  commitCount: number;
  filesOwned: number;       // files where this author has majority of commits
  recentCommits: number;    // commits in last 30 days
  churnTrend: ChurnTrend;
  isBot: boolean;
}

export interface AuthorAnalyticsReport {
  authors: AuthorStats[];
  topOwners: AuthorStats[];   // top 5 by filesOwned
  botAuthors: string[];
  unownedFiles: number;       // files with no majority owner
}

const BOT_PATTERNS = ['[bot]', 'noreply', 'github-actions', 'dependabot', 'renovate'];

function isBot(email: string): boolean {
  const lower = email.toLowerCase();
  return BOT_PATTERNS.some(p => lower.includes(p));
}

const EMPTY_REPORT: AuthorAnalyticsReport = {
  authors: [],
  topOwners: [],
  botAuthors: [],
  unownedFiles: 0,
};

export function computeAuthorAnalytics(repoPath: string, db: MonographDb): AuthorAnalyticsReport {
  // ── Parse git log ──────────────────────────────────────────────────────────
  let logOutput: string;
  try {
    logOutput = execSync('git log --format="%ae|%ad" --date=unix', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return EMPTY_REPORT;
  }

  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 86400 * 30;
  const sixtyDaysAgo = now - 86400 * 60;

  // commitCount, recentCommits, priorCommits per author
  const commitCount = new Map<string, number>();
  const recentCommits = new Map<string, number>();
  const priorCommits = new Map<string, number>();

  for (const line of logOutput.split('\n')) {
    const trimmed = line.trim().replace(/^"|"$/g, '');
    if (!trimmed) continue;
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx === -1) continue;
    const email = trimmed.slice(0, pipeIdx).trim();
    const tsStr = trimmed.slice(pipeIdx + 1).trim();
    const ts = parseInt(tsStr, 10);
    if (!email || isNaN(ts)) continue;

    commitCount.set(email, (commitCount.get(email) ?? 0) + 1);
    if (ts > thirtyDaysAgo) {
      recentCommits.set(email, (recentCommits.get(email) ?? 0) + 1);
    } else if (ts > sixtyDaysAgo) {
      priorCommits.set(email, (priorCommits.get(email) ?? 0) + 1);
    }
  }

  if (commitCount.size === 0) return EMPTY_REPORT;

  // ── File ownership ─────────────────────────────────────────────────────────
  // Get File nodes with degree > 2
  const fileRows = db.prepare(`
    SELECT n.id, n.name
    FROM nodes n
    WHERE n.label = 'File'
      AND (
        SELECT COUNT(*) FROM edges e
        WHERE e.source_id = n.id OR e.target_id = n.id
      ) > 2
    LIMIT 200
  `).all() as { id: string; name: string }[];

  // Map: file path → winning author email (majority owner) or null
  const fileOwner = new Map<string, string | null>();
  const filesOwnedByAuthor = new Map<string, number>();

  for (const file of fileRows) {
    const filePath = file.name;
    if (!filePath) { fileOwner.set(file.id, null); continue; }

    let fileLog: string;
    try {
      fileLog = execSync(`git log --follow --format="%ae" -- "${filePath}"`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      fileOwner.set(file.id, null);
      continue;
    }

    const authorCounts = new Map<string, number>();
    for (const ae of fileLog.split('\n')) {
      const e = ae.trim().replace(/^"|"$/g, '');
      if (!e) continue;
      authorCounts.set(e, (authorCounts.get(e) ?? 0) + 1);
    }

    let totalCommitsOnFile = 0;
    for (const c of authorCounts.values()) totalCommitsOnFile += c;

    let winner: string | null = null;
    for (const [ae, c] of authorCounts) {
      if (totalCommitsOnFile > 0 && c / totalCommitsOnFile > 0.5) {
        winner = ae;
        break;
      }
    }
    fileOwner.set(file.id, winner);
    if (winner) {
      filesOwnedByAuthor.set(winner, (filesOwnedByAuthor.get(winner) ?? 0) + 1);
    }
  }

  // ── Count unowned files ────────────────────────────────────────────────────
  let unownedFiles = 0;
  for (const owner of fileOwner.values()) {
    if (owner === null) unownedFiles++;
  }

  // ── Build author stats ─────────────────────────────────────────────────────
  const authors: AuthorStats[] = [];
  const botAuthors: string[] = [];

  for (const [email, count] of commitCount) {
    const recent = recentCommits.get(email) ?? 0;
    const prior = priorCommits.get(email) ?? 0;

    let churnTrend: ChurnTrend;
    if (recent > prior * 1.2) churnTrend = 'accelerating';
    else if (recent < prior * 0.8) churnTrend = 'declining';
    else churnTrend = 'stable';

    const bot = isBot(email);
    if (bot) botAuthors.push(email);

    authors.push({
      author: email,
      commitCount: count,
      filesOwned: filesOwnedByAuthor.get(email) ?? 0,
      recentCommits: recent,
      churnTrend,
      isBot: bot,
    });
  }

  // Sort by filesOwned desc, then commitCount desc
  authors.sort((a, b) => b.filesOwned - a.filesOwned || b.commitCount - a.commitCount);

  const topOwners = authors.filter(a => !a.isBot).slice(0, 5);

  return { authors, topOwners, botAuthors, unownedFiles };
}
