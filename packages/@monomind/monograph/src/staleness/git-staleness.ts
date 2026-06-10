import { execSync } from 'child_process';
import type { MonographDb } from '../storage/db.js';

export interface StalenessReport {
  isStale: boolean;
  indexedAt: string | null;
  indexedCommit: string | null;
  currentCommit: string | null;
  changedSince: string[];
  staleSince: string | null;
}

export function checkStaleness(db: MonographDb, repoPath: string): StalenessReport {
  // 1. Get stored commit hash
  const row = db.prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get() as { value: string } | undefined;
  const indexedCommitFull = row?.value ?? null;

  // 2. Get current HEAD (full SHA — --short output length varies by repo size)
  let currentCommit: string | null = null;
  try {
    currentCommit = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
  } catch {
    // Not a git repo or git not available
    return { isStale: false, indexedAt: null, indexedCommit: null, currentCommit: null, changedSince: [], staleSince: null };
  }

  // Display short SHA (7 chars) for the interface field; compare short SHAs for staleness
  const indexedCommitShort = indexedCommitFull ? indexedCommitFull.slice(0, 7) : null;
  const currentCommitShort = currentCommit ? currentCommit.slice(0, 7) : null;

  // 3. If no stored commit or short SHAs match, not stale
  if (!indexedCommitFull || indexedCommitShort === currentCommitShort) {
    return { isStale: false, indexedAt: null, indexedCommit: indexedCommitShort, currentCommit: currentCommitShort, changedSince: [], staleSince: null };
  }

  // Guard: indexedCommitFull is read from SQLite — validate before shell interpolation
  if (!/^[0-9a-f]{7,40}$/i.test(indexedCommitFull)) {
    return { isStale: true, indexedAt: null, indexedCommit: indexedCommitShort, currentCommit: currentCommitShort, changedSince: [], staleSince: null };
  }

  // 4. Get changed files between indexed commit and HEAD
  let changedSince: string[] = [];
  try {
    const diff = execSync(`git diff --name-only ${indexedCommitFull}..HEAD`, { cwd: repoPath, encoding: 'utf8' });
    changedSince = diff.trim().split('\n').filter(Boolean);
  } catch {
    changedSince = [];
  }

  // 5. Get staleSince timestamp (first diverging commit after indexed commit)
  let staleSince: string | null = null;
  try {
    const firstCommit = execSync(
      `git log --format="%ai" ${indexedCommitFull}..HEAD --reverse --max-count=1`,
      { cwd: repoPath, encoding: 'utf8' }
    ).trim();
    staleSince = firstCommit || null;
  } catch {
    staleSince = null;
  }

  return { isStale: true, indexedAt: null, indexedCommit: indexedCommitShort, currentCommit: currentCommitShort, changedSince, staleSince };
}
