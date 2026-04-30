import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { detectMonographChanges } from '../../src/mcp-tools/detect-changes.js';
import type { MonographNode } from '../../src/types.js';

// vi.mock must be at the top level for Vitest to hoist it correctly
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// After the mock, import the mocked module to control it
import { execSync } from 'child_process';

const dbPath = join(tmpdir(), `monograph-detect-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const nodeAuth: MonographNode = {
  id: 'det_auth',
  label: 'Function',
  name: 'authenticate',
  normLabel: 'authenticate',
  filePath: 'src/auth.ts',
  startLine: 10,
  isExported: true,
};

const nodeOther: MonographNode = {
  id: 'det_other',
  label: 'Function',
  name: 'otherFunc',
  normLabel: 'otherfunc',
  filePath: 'src/other.ts',
  startLine: 1,
  isExported: false,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, nodeAuth);
  insertNode(db, nodeOther);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('detectMonographChanges', () => {
  it('returns affected symbols for a changed file', () => {
    vi.mocked(execSync).mockReturnValue('src/auth.ts\n' as any);

    const result = detectMonographChanges(db, { baseBranch: 'main' }, '/fake/repo');

    expect(result.changedFiles).toContain('src/auth.ts');
    expect(result.affectedSymbols.some(s => s.name === 'authenticate')).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('filters out test files when includeTests=false', () => {
    vi.mocked(execSync).mockReturnValue('src/auth.ts\nsrc/auth.test.ts\n' as any);

    const result = detectMonographChanges(db, { baseBranch: 'main', includeTests: false }, '/fake/repo');

    expect(result.changedFiles).toContain('src/auth.ts');
    expect(result.changedFiles).not.toContain('src/auth.test.ts');
  });

  it('returns empty result when no files changed', () => {
    vi.mocked(execSync).mockReturnValue('' as any);

    const result = detectMonographChanges(db, { baseBranch: 'main' }, '/fake/repo');

    expect(result.changedFiles).toHaveLength(0);
    expect(result.affectedSymbols).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });

  it('handles git errors gracefully', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git: not a repository');
    });

    const result = detectMonographChanges(db, { baseBranch: 'main' }, '/fake/repo');

    expect(result.changedFiles).toHaveLength(0);
    expect(result.affectedSymbols).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('git');
  });

  it('uses main as default base branch', () => {
    vi.mocked(execSync).mockReturnValue('' as any);

    detectMonographChanges(db, {}, '/fake/repo');

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('main'),
      expect.any(Object),
    );
  });
});
