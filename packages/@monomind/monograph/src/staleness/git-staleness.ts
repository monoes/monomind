import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { MonographDb } from '../storage/db.js';

/**
 * Explicit index freshness. A boolean cannot distinguish "proven up to date"
 * from "we could not check", and reporting the latter as the former is how a
 * confident-but-baseless "fresh" answer reaches a caller.
 *
 * - `fresh`    — index matches HEAD, worktree is clean, no recorded warnings.
 * - `stale`    — index is behind HEAD, or the worktree has uncommitted edits.
 * - `building` — a build lock is held by a live process right now.
 * - `partial`  — index matches HEAD but is known incomplete (parser warnings
 *                or a recorded refresh error).
 * - `unknown`  — freshness could not be determined (git unavailable, no
 *                recorded revision, or the dirty-worktree probe failed).
 */
export type IndexFreshnessState = 'fresh' | 'stale' | 'building' | 'partial' | 'unknown';

/** Cap on the dirty-path sample carried in the report; `dirtyFileCount` keeps the true total. */
const DIRTY_PATH_CAP = 50;

export interface StalenessReport {
  /**
   * Commit-divergence only: true when the indexed commit is known to differ
   * from HEAD (or no commit was recorded). Deliberately unchanged — the
   * pipeline's skip-when-fresh guard reads it together with `currentCommit`.
   * It is NOT a freshness verdict: a clean-commit / dirty-worktree index has
   * `isStale: false` and `state: 'stale'`. New callers should read `state`.
   */
  isStale: boolean;
  /** Timestamp of the last build, from `index_meta.indexed_at`. */
  indexedAt: string | null;
  /** Short (7-char) SHA of the indexed revision. */
  indexedCommit: string | null;
  /** Short (7-char) SHA of current HEAD. */
  currentCommit: string | null;
  changedSince: string[];
  staleSince: string | null;

  /** Explicit freshness state — prefer this over `isStale`. */
  state: IndexFreshnessState;
  /** One sentence explaining why `state` has this value; safe to show a user. */
  reason: string;
  /** Full SHA of the revision the index was built from, null when unrecorded. */
  indexedRevision: string | null;
  /** Source scope the index was built with (e.g. 'code-only'), null when unrecorded. */
  sourceScope: string | null;
  /** true/false when git could be consulted, null when the probe failed. */
  dirtyWorktree: boolean | null;
  /** Sample of uncommitted paths, capped at {@link DIRTY_PATH_CAP}. */
  dirtyPaths: string[];
  /** True number of uncommitted paths, null when undetermined. */
  dirtyFileCount: number | null;
  /** Parser warnings recorded by the last build, null when none recorded. */
  parserWarnings: string[] | null;
  /** Error recorded by the last refresh attempt, null when none recorded. */
  lastRefreshError: string | null;
  /** A build lock is currently held by a live process. */
  buildInProgress: boolean;
  /** True whenever `state !== 'fresh'`: graph answers may be incomplete. */
  mayBeIncomplete: boolean;
}

function readMeta(db: MonographDb): Map<string, string> {
  try {
    const rows = db.prepare('SELECT key, value FROM index_meta').all() as {
      key: string;
      value: string;
    }[];
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch {
    return new Map();
  }
}

/** Accepts either a JSON array or a newline-separated list; null when empty. */
function parseWarnings(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const items = parsed.map(String).filter(Boolean);
      return items.length > 0 ? items : null;
    }
  } catch {
    /* not JSON — fall through to line parsing */
  }
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : null;
}

/**
 * The pipeline serializes builds with a `<dbPath>.build-lock` file holding the
 * builder's pid. A live holder means a rebuild is under way right now, which is
 * a different answer than "stale" for a caller deciding whether to wait.
 */
function isBuildInProgress(db: MonographDb): boolean {
  const dbPath = typeof db.name === 'string' ? db.name : '';
  if (!dbPath || dbPath === ':memory:') return false;
  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(`${dbPath}.build-lock`, 'utf8'), 10);
  } catch {
    return false; // no lock file
  }
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

interface DirtyWorktree {
  dirty: boolean | null;
  paths: string[];
  count: number | null;
}

/**
 * Commit comparison alone cannot see uncommitted work, which is exactly the
 * code an agent is most likely to ask about. Cheap `git status --porcelain`;
 * a failure reports "undetermined" rather than "clean".
 */
function checkDirtyWorktree(repoPath: string): DirtyWorktree {
  try {
    const out = execSync('git status --porcelain --no-renames', {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    // Porcelain v1 lines are `XY <path>`; ignored files are excluded by default.
    const paths = out
      .split('\n')
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    return { dirty: paths.length > 0, paths: paths.slice(0, DIRTY_PATH_CAP), count: paths.length };
  } catch {
    return { dirty: null, paths: [], count: null };
  }
}

interface ReportParts {
  isStale: boolean;
  indexedCommit: string | null;
  currentCommit: string | null;
  changedSince: string[];
  staleSince: string | null;
  state: IndexFreshnessState;
  reason: string;
  indexedRevision: string | null;
  dirty: DirtyWorktree;
}

function buildReport(meta: Map<string, string>, parts: ReportParts): StalenessReport {
  return {
    isStale: parts.isStale,
    indexedAt: meta.get('indexed_at') ?? null,
    indexedCommit: parts.indexedCommit,
    currentCommit: parts.currentCommit,
    changedSince: parts.changedSince,
    staleSince: parts.staleSince,
    state: parts.state,
    reason: parts.reason,
    indexedRevision: parts.indexedRevision,
    sourceScope: meta.get('source_scope') ?? meta.get('scope') ?? null,
    dirtyWorktree: parts.dirty.dirty,
    dirtyPaths: parts.dirty.paths,
    dirtyFileCount: parts.dirty.count,
    parserWarnings: parseWarnings(meta.get('parser_warnings') ?? meta.get('parse_errors')),
    lastRefreshError: meta.get('last_refresh_error') ?? null,
    buildInProgress: parts.state === 'building',
    mayBeIncomplete: parts.state !== 'fresh',
  };
}

/**
 * State for an index whose recorded commit equals HEAD. Matching commits are
 * necessary but not sufficient for "fresh": the worktree may be dirty, the
 * probe may have failed, or the last build may have recorded problems.
 */
function stateForMatchingCommit(
  meta: Map<string, string>,
  dirty: DirtyWorktree,
): { state: IndexFreshnessState; reason: string } {
  if (dirty.dirty === null) {
    return {
      state: 'unknown',
      reason:
        'Index matches HEAD, but the working tree could not be checked for uncommitted edits.',
    };
  }
  if (dirty.dirty) {
    return {
      state: 'stale',
      reason: `Index matches HEAD but ${dirty.count} path(s) have uncommitted changes that are not in the graph.`,
    };
  }
  const warnings = parseWarnings(meta.get('parser_warnings') ?? meta.get('parse_errors'));
  const refreshError = meta.get('last_refresh_error') ?? null;
  if (warnings) {
    return {
      state: 'partial',
      reason: `Index matches HEAD but the last build recorded ${warnings.length} parser warning(s); some symbols may be missing.`,
    };
  }
  if (refreshError) {
    return {
      state: 'partial',
      reason: `Index matches HEAD but the last refresh reported an error: ${refreshError}`,
    };
  }
  return { state: 'fresh', reason: 'Index matches HEAD and the working tree is clean.' };
}

export function checkStaleness(db: MonographDb, repoPath: string): StalenessReport {
  const meta = readMeta(db);
  const indexedCommitFull = meta.get('last_commit_hash') ?? null;
  const indexedCommitShort = indexedCommitFull ? indexedCommitFull.slice(0, 7) : null;
  const building = isBuildInProgress(db);

  // 1. Current HEAD (full SHA — `--short` output length varies by repo size)
  let currentCommit: string | null = null;
  try {
    currentCommit = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
  } catch {
    // Not a git repo, no git binary, or a broken checkout. Nothing is known
    // about freshness here — `unknown`, never `fresh`.
    return buildReport(meta, {
      isStale: false,
      indexedCommit: null,
      currentCommit: null,
      changedSince: [],
      staleSince: null,
      state: building ? 'building' : 'unknown',
      reason: building
        ? 'A build is currently running; git is unavailable so freshness cannot be checked.'
        : 'Git is unavailable in this directory, so index freshness cannot be determined. Treat graph results as possibly incomplete.',
      indexedRevision: indexedCommitFull,
      dirty: { dirty: null, paths: [], count: null },
    });
  }

  const currentCommitShort = currentCommit.slice(0, 7);
  const dirty = checkDirtyWorktree(repoPath);

  // 2. Commits match → freshness still depends on worktree state and warnings.
  if (indexedCommitShort === currentCommitShort) {
    const { state, reason } = stateForMatchingCommit(meta, dirty);
    return buildReport(meta, {
      isStale: false,
      indexedCommit: indexedCommitShort,
      currentCommit: currentCommitShort,
      changedSince: [],
      staleSince: null,
      state: building ? 'building' : state,
      reason: building ? 'A build is currently running.' : reason,
      indexedRevision: indexedCommitFull,
      dirty,
    });
  }

  // 3. No recorded revision → staleness is unknown, not merely "stale".
  //    `isStale` stays true so the rebuild guard keeps its conservative behavior.
  if (!indexedCommitFull) {
    return buildReport(meta, {
      isStale: true,
      indexedCommit: null,
      currentCommit: currentCommitShort,
      changedSince: [],
      staleSince: null,
      state: building ? 'building' : 'unknown',
      reason: building
        ? 'A build is currently running; no indexed revision has been recorded yet.'
        : 'No indexed revision was recorded, so the index cannot be compared against HEAD.',
      indexedRevision: null,
      dirty,
    });
  }

  // Guard: indexedCommitFull is read from SQLite — validate before shell interpolation
  if (!/^[0-9a-f]{7,40}$/i.test(indexedCommitFull)) {
    return buildReport(meta, {
      isStale: true,
      indexedCommit: indexedCommitShort,
      currentCommit: currentCommitShort,
      changedSince: [],
      staleSince: null,
      state: building ? 'building' : 'unknown',
      reason:
        'The recorded index revision is not a valid commit SHA, so freshness cannot be determined. Re-run the build.',
      indexedRevision: indexedCommitFull,
      dirty,
    });
  }

  // 4. Get changed files between indexed commit and HEAD
  let changedSince: string[] = [];
  try {
    const diff = execSync(`git diff --name-only ${indexedCommitFull}..HEAD`, {
      cwd: repoPath,
      encoding: 'utf8',
    });
    changedSince = diff.trim().split('\n').filter(Boolean);
  } catch {
    changedSince = [];
  }

  // 5. Get staleSince timestamp (first diverging commit after indexed commit)
  let staleSince: string | null = null;
  try {
    const firstCommit = execSync(
      `git log --format="%ai" ${indexedCommitFull}..HEAD --reverse --max-count=1`,
      { cwd: repoPath, encoding: 'utf8' },
    ).trim();
    staleSince = firstCommit || null;
  } catch {
    staleSince = null;
  }

  const dirtyNote = dirty.dirty ? ` ${dirty.count} path(s) also have uncommitted changes.` : '';
  return buildReport(meta, {
    isStale: true,
    indexedCommit: indexedCommitShort,
    currentCommit: currentCommitShort,
    changedSince,
    staleSince,
    state: building ? 'building' : 'stale',
    reason: building
      ? 'A build is currently running.'
      : `Index was built at ${indexedCommitShort} but HEAD is ${currentCommitShort}; ${changedSince.length} file(s) changed since.${dirtyNote}`,
    indexedRevision: indexedCommitFull,
    dirty,
  });
}
