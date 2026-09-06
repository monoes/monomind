import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { openDb, closeDb } from '../../src/storage/db.js';
import { checkStaleness } from '../../src/staleness/git-staleness.js';

// vi.mock must be at top level for Vitest hoisting
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';

const dbPath = join(tmpdir(), `monograph-staleness-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

beforeAll(() => {
  db = openDb(dbPath);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

afterEach(() => {
  vi.clearAllMocks();
  // Clear stored metadata between tests
  db.prepare('DELETE FROM index_meta').run();
});

/**
 * Route mocked execSync by command instead of by call order, so adding a git
 * probe (e.g. `git status --porcelain`) doesn't silently reshuffle every test.
 */
function mockGit(responses: {
  head?: string | (() => never);
  diff?: string | (() => never);
  log?: string;
  status?: string | (() => never);
}) {
  vi.mocked(execSync).mockImplementation(((cmd: string) => {
    if (cmd.includes('rev-parse')) {
      if (typeof responses.head === 'function') return responses.head();
      if (responses.head === undefined) throw new Error('not a git repository');
      return responses.head;
    }
    if (cmd.includes('status')) {
      if (typeof responses.status === 'function') return responses.status();
      return responses.status ?? '';
    }
    if (cmd.includes('diff')) {
      if (typeof responses.diff === 'function') return responses.diff();
      return responses.diff ?? '';
    }
    if (cmd.includes('log')) return responses.log ?? '';
    return '';
  }) as never);
}

describe('checkStaleness', () => {
  it('returns isStale: false when indexed commit matches current HEAD', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'abc1234def5678',
    );
    mockGit({ head: 'abc1234def5678', status: '' });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.isStale).toBe(false);
    expect(report.state).toBe('fresh');
    expect(report.indexedCommit).toBe('abc1234');
    expect(report.currentCommit).toBe('abc1234');
    expect(report.changedSince).toHaveLength(0);
    expect(report.staleSince).toBeNull();
    expect(report.mayBeIncomplete).toBe(false);
  });

  it('returns isStale: true with changedSince when commits differ', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'aaa0000111222333',
    );
    mockGit({
      head: 'bbb9999888777666',
      diff: 'src/foo.ts\nsrc/bar.ts\n',
      log: '2024-01-15 10:00:00 +0000',
      status: '',
    });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.isStale).toBe(true);
    expect(report.state).toBe('stale');
    expect(report.indexedCommit).toBe('aaa0000');
    expect(report.currentCommit).toBe('bbb9999');
    expect(report.changedSince).toContain('src/foo.ts');
    expect(report.changedSince).toContain('src/bar.ts');
    expect(report.staleSince).toBe('2024-01-15 10:00:00 +0000');
  });

  it('returns isStale: true when no commit hash has been stored', () => {
    mockGit({ head: 'abc1234def5678', status: '' });

    const report = checkStaleness(db, '/fake/repo');

    // No recorded revision → we cannot prove anything about freshness.
    expect(report.state).toBe('unknown');
    expect(report.isStale).toBe(true);
    expect(report.indexedCommit).toBeNull();
    expect(report.currentCommit).toBe('abc1234');
  });

  it('returns empty changedSince when git diff fails', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'aaa0000111222',
    );
    mockGit({
      head: 'bbb9999888777',
      diff: () => {
        throw new Error('git diff failed');
      },
      status: '',
    });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.isStale).toBe(true);
    expect(report.changedSince).toHaveLength(0);
  });

  // ── Finding 9: freshness must never be asserted without evidence ───────────

  it('reports state "unknown" — never "fresh" — when git is unavailable', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'abc1234def5678',
    );
    vi.mocked(execSync).mockImplementation((() => {
      throw new Error('not a git repository');
    }) as never);

    const report = checkStaleness(db, '/not/a/git/repo');

    expect(report.state).toBe('unknown');
    expect(report.state).not.toBe('fresh');
    expect(report.currentCommit).toBeNull();
    expect(report.dirtyWorktree).toBeNull();
    expect(report.mayBeIncomplete).toBe(true);
    expect(report.reason).toMatch(/git/i);
    // isStale keeps its existing commit-divergence meaning (orchestrator guard
    // additionally requires currentCommit !== null before skipping a rebuild).
    expect(report.isStale).toBe(false);
    expect(report.changedSince).toHaveLength(0);
  });

  it('does not report "fresh" when the working tree has uncommitted edits', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'abc1234def5678',
    );
    mockGit({
      head: 'abc1234def5678',
      status: ' M src/foo.ts\n?? src/new-file.ts\n',
    });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.state).toBe('stale');
    expect(report.state).not.toBe('fresh');
    expect(report.dirtyWorktree).toBe(true);
    expect(report.dirtyFileCount).toBe(2);
    expect(report.dirtyPaths).toContain('src/foo.ts');
    expect(report.dirtyPaths).toContain('src/new-file.ts');
    expect(report.mayBeIncomplete).toBe(true);
    // isStale stays commit-only so the orchestrator's skip guard is unchanged.
    expect(report.isStale).toBe(false);
  });

  it('surfaces indexed revision, indexed timestamp and source scope', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'abc1234def5678',
    );
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('indexed_at', ?)").run(
      '2026-09-05T10:00:00.000Z',
    );
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('source_scope', ?)").run('code-only');
    mockGit({ head: 'abc1234def5678', status: '' });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.indexedRevision).toBe('abc1234def5678');
    expect(report.indexedAt).toBe('2026-09-05T10:00:00.000Z');
    expect(report.sourceScope).toBe('code-only');
  });

  it('reports state "partial" when the last build recorded parser warnings', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'abc1234def5678',
    );
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('parser_warnings', ?)").run(
      JSON.stringify(['src/huge.ts: skipped (too large)']),
    );
    mockGit({ head: 'abc1234def5678', status: '' });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.state).toBe('partial');
    expect(report.parserWarnings).toEqual(['src/huge.ts: skipped (too large)']);
    expect(report.mayBeIncomplete).toBe(true);
  });

  it('reports state "partial" and surfaces the last refresh error', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'abc1234def5678',
    );
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_refresh_error', ?)").run(
      'incremental update failed: ENOENT',
    );
    mockGit({ head: 'abc1234def5678', status: '' });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.state).toBe('partial');
    expect(report.lastRefreshError).toBe('incremental update failed: ENOENT');
  });

  it('treats a dirty worktree probe failure as undetermined, not clean', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run(
      'abc1234def5678',
    );
    mockGit({
      head: 'abc1234def5678',
      status: () => {
        throw new Error('git status failed');
      },
    });

    const report = checkStaleness(db, '/fake/repo');

    expect(report.dirtyWorktree).toBeNull();
    expect(report.state).toBe('unknown');
  });
});
