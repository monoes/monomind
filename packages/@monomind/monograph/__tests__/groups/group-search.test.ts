/**
 * Tests for cross-repo group search (group-search.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { groupQuery } from '../../src/groups/group-search.js';
import type { GroupConfig } from '../../src/groups/group-config.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a minimal monograph SQLite DB at the given path with some nodes.
 */
function createTestDb(
  dbPath: string,
  nodes: { id: string; name: string; label: string; filePath?: string }[],
): void {
  mkdirSync(require('path').dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      name TEXT NOT NULL,
      norm_label TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      community_id INTEGER,
      is_exported INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      properties TEXT
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      id UNINDEXED,
      name,
      norm_label,
      file_path,
      label UNINDEXED,
      content='nodes',
      content_rowid='rowid'
    )
  `);

  // FTS sync insert trigger
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
      INSERT INTO nodes_fts(rowid, id, name, norm_label, file_path, label)
        VALUES (new.rowid, new.id, new.name, new.norm_label, new.file_path, new.label);
    END
  `);

  const insert = db.prepare(
    `INSERT INTO nodes (id, label, name, norm_label, file_path) VALUES (?, ?, ?, ?, ?)`,
  );

  for (const n of nodes) {
    insert.run(n.id, n.label, n.name, n.label.toLowerCase(), n.filePath ?? null);
  }

  db.close();
}

// ── fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'monograph-group-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeRepo(repoName: string, nodes: { id: string; name: string; label: string; filePath?: string }[]) {
  const repoPath = join(tmpDir, repoName);
  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  mkdirSync(join(repoPath, '.monomind'), { recursive: true });
  createTestDb(dbPath, nodes);
  return repoPath;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('groupQuery', () => {
  it('merges results from two repos', async () => {
    const repoAPath = makeRepo('repoA', [
      { id: 'a1', name: 'UserService', label: 'Class', filePath: 'src/user.ts' },
      { id: 'a2', name: 'AuthService', label: 'Class', filePath: 'src/auth.ts' },
    ]);
    const repoBPath = makeRepo('repoB', [
      { id: 'b1', name: 'UserController', label: 'Class', filePath: 'src/user-ctrl.ts' },
    ]);

    const config: GroupConfig = {
      name: 'test-group',
      repos: [
        { name: 'repoA', path: repoAPath },
        { name: 'repoB', path: repoBPath },
      ],
    };

    const results = await groupQuery(config, 'User');
    expect(results.length).toBeGreaterThanOrEqual(2);

    const names = results.map((r) => r.name);
    expect(names.some((n) => n.includes('User'))).toBe(true);
  });

  it('tags results with the correct repo name', async () => {
    const repoAPath = makeRepo('repoA', [
      { id: 'a1', name: 'UserService', label: 'Class' },
    ]);
    const repoBPath = makeRepo('repoB', [
      { id: 'b1', name: 'UserRepository', label: 'Class' },
    ]);

    const config: GroupConfig = {
      name: 'test-group',
      repos: [
        { name: 'repoA', path: repoAPath },
        { name: 'repoB', path: repoBPath },
      ],
    };

    const results = await groupQuery(config, 'User');
    const repos = results.map((r) => r.repo);
    expect(repos).toContain('repoA');
    expect(repos).toContain('repoB');
  });

  it('skips repos whose DB file does not exist', async () => {
    const repoAPath = makeRepo('repoA', [
      { id: 'a1', name: 'HealthService', label: 'Class' },
    ]);

    const config: GroupConfig = {
      name: 'test-group',
      repos: [
        { name: 'repoA', path: repoAPath },
        { name: 'missing-repo', path: join(tmpDir, 'does-not-exist') },
      ],
    };

    // Should not throw; missing repo is warned and skipped
    const results = await groupQuery(config, 'Health');
    expect(results.length).toBeGreaterThan(0);
    const repos = results.map((r) => r.repo);
    expect(repos).not.toContain('missing-repo');
    expect(repos).toContain('repoA');
  });

  it('returns empty array when no repos match', async () => {
    const repoAPath = makeRepo('repoA', [
      { id: 'a1', name: 'SomeClass', label: 'Class' },
    ]);

    const config: GroupConfig = {
      name: 'test-group',
      repos: [{ name: 'repoA', path: repoAPath }],
    };

    const results = await groupQuery(config, 'xyzzy_not_found_anywhere');
    expect(results).toEqual([]);
  });

  it('respects the limit option', async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      name: `UserModule${i}`,
      label: 'Class',
    }));
    const repoAPath = makeRepo('repoA', nodes);

    const config: GroupConfig = {
      name: 'test-group',
      repos: [{ name: 'repoA', path: repoAPath }],
    };

    const results = await groupQuery(config, 'User', { limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('result objects have the required shape', async () => {
    const repoAPath = makeRepo('repoA', [
      { id: 'a1', name: 'PaymentService', label: 'Class', filePath: 'src/payment.ts' },
    ]);

    const config: GroupConfig = {
      name: 'test-group',
      repos: [{ name: 'repoA', path: repoAPath }],
    };

    const results = await groupQuery(config, 'Payment');
    expect(results.length).toBeGreaterThan(0);

    const r = results[0];
    expect(typeof r.id).toBe('string');
    expect(typeof r.name).toBe('string');
    expect(typeof r.label).toBe('string');
    expect(typeof r.repo).toBe('string');
    expect(typeof r.score).toBe('number');
    // filePath may be string or null
    expect(r.filePath === null || typeof r.filePath === 'string').toBe(true);
  });

  it('handles empty repos array gracefully', async () => {
    const config: GroupConfig = { name: 'empty', repos: [] };
    const results = await groupQuery(config, 'anything');
    expect(results).toEqual([]);
  });
});
