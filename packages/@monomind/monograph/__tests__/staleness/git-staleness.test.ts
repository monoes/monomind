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
  // Clear stored commit hash between tests
  db.prepare("DELETE FROM index_meta WHERE key = 'last_commit_hash'").run();
});

describe('checkStaleness', () => {
  it('returns isStale: false when indexed commit matches current HEAD', () => {
    // Store a full commit hash
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run('abc1234def5678');
    // git rev-parse --short HEAD returns short version matching slice(0,7)
    vi.mocked(execSync).mockReturnValue('abc1234' as any);

    const report = checkStaleness(db, '/fake/repo');

    expect(report.isStale).toBe(false);
    expect(report.indexedCommit).toBe('abc1234');
    expect(report.currentCommit).toBe('abc1234');
    expect(report.changedSince).toHaveLength(0);
    expect(report.staleSince).toBeNull();
  });

  it('returns isStale: true with changedSince when commits differ', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run('aaa0000111222333');
    // First call: git rev-parse --short HEAD
    // Second call: git diff --name-only ...
    // Third call: git log ...
    vi.mocked(execSync)
      .mockReturnValueOnce('bbb9999' as any)
      .mockReturnValueOnce('src/foo.ts\nsrc/bar.ts\n' as any)
      .mockReturnValueOnce('2024-01-15 10:00:00 +0000' as any);

    const report = checkStaleness(db, '/fake/repo');

    expect(report.isStale).toBe(true);
    expect(report.indexedCommit).toBe('aaa0000');
    expect(report.currentCommit).toBe('bbb9999');
    expect(report.changedSince).toContain('src/foo.ts');
    expect(report.changedSince).toContain('src/bar.ts');
    expect(report.staleSince).toBe('2024-01-15 10:00:00 +0000');
  });

  it('returns isStale: false with null commits when not a git repo', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run('abc1234def');
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const report = checkStaleness(db, '/not/a/git/repo');

    expect(report.isStale).toBe(false);
    expect(report.currentCommit).toBeNull();
    expect(report.changedSince).toHaveLength(0);
  });

  it('returns isStale: false when no commit hash has been stored', () => {
    // No stored commit hash
    vi.mocked(execSync).mockReturnValue('abc1234' as any);

    const report = checkStaleness(db, '/fake/repo');

    expect(report.isStale).toBe(false);
    expect(report.indexedCommit).toBeNull();
    expect(report.currentCommit).toBe('abc1234');
  });

  it('returns empty changedSince when git diff fails', () => {
    db.prepare("INSERT OR REPLACE INTO index_meta VALUES ('last_commit_hash', ?)").run('aaa0000111222');
    vi.mocked(execSync)
      .mockReturnValueOnce('bbb9999' as any)
      .mockImplementationOnce(() => { throw new Error('git diff failed'); })
      .mockReturnValueOnce('' as any);

    const report = checkStaleness(db, '/fake/repo');

    expect(report.isStale).toBe(true);
    expect(report.changedSince).toHaveLength(0);
  });
});
