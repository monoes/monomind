import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { runDoctor } from '../../src/cli/doctor.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'monograph-doctor-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('runDoctor', () => {
  it('returns a DoctorResult with checks array and healthy boolean', async () => {
    const result = await runDoctor(tempDir);

    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('healthy');
    expect(Array.isArray(result.checks)).toBe(true);
    expect(typeof result.healthy).toBe('boolean');
  });

  it('each check has name, status, and message fields', async () => {
    const result = await runDoctor(tempDir);

    for (const check of result.checks) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('status');
      expect(check).toHaveProperty('message');
      expect(['ok', 'warn', 'error']).toContain(check.status);
    }
  });

  it('Node version check passes on the current Node.js runtime', async () => {
    const result = await runDoctor(tempDir);

    const nodeCheck = result.checks.find((c) => c.name === 'Node version');
    expect(nodeCheck).toBeDefined();
    // The test environment must run Node >= 18 (CI requirement)
    expect(nodeCheck!.status).toBe('ok');
    expect(nodeCheck!.message).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it('returns an error check for missing DB file', async () => {
    // No .monomind/monograph.db present in tempDir
    const result = await runDoctor(tempDir);

    const dbCheck = result.checks.find((c) => c.name === 'SQLite DB exists');
    expect(dbCheck).toBeDefined();
    expect(dbCheck!.status).toBe('error');
  });

  it('is not healthy when DB is missing', async () => {
    const result = await runDoctor(tempDir);
    expect(result.healthy).toBe(false);
  });

  it('marks dependent checks as error when DB is missing', async () => {
    const result = await runDoctor(tempDir);

    const readableCheck = result.checks.find((c) => c.name === 'SQLite DB readable');
    const countCheck = result.checks.find((c) => c.name === 'DB node count');

    expect(readableCheck).toBeDefined();
    expect(countCheck).toBeDefined();
    // Both should be errors (skipped due to missing DB)
    expect(readableCheck!.status).toBe('error');
    expect(countCheck!.status).toBe('error');
  });

  it('includes a disk space check', async () => {
    const result = await runDoctor(tempDir);

    const diskCheck = result.checks.find((c) => c.name === 'Disk space');
    expect(diskCheck).toBeDefined();
    // Disk check is either ok or warn (never errors out — platform-safe)
    expect(['ok', 'warn']).toContain(diskCheck!.status);
  });

  it('includes a tree-sitter check', async () => {
    const result = await runDoctor(tempDir);

    const tsCheck = result.checks.find((c) => c.name === 'Tree-sitter');
    expect(tsCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(tsCheck!.status);
  });

  it('is healthy when DB exists and is readable with nodes', async () => {
    // Create a minimal SQLite DB with a nodes table and one row
    const monomindDir = path.join(tempDir, '.monomind');
    await fs.mkdir(monomindDir, { recursive: true });
    const dbPath = path.join(monomindDir, 'monograph.db');

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        label TEXT,
        name TEXT,
        file_path TEXT,
        community_id INTEGER
      );
      CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
      CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(id, name, label, file_path, content=nodes, content_rowid=rowid);
      CREATE TABLE IF NOT EXISTS wiki_pages (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS embeddings (node_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS communities (id INTEGER PRIMARY KEY, label TEXT);
    `);
    db.prepare("INSERT INTO nodes (id, label, name) VALUES ('n1', 'Function', 'main')").run();
    db.close();

    const result = await runDoctor(tempDir);

    expect(result.healthy).toBe(true);
    const nodeCheck = result.checks.find((c) => c.name === 'DB node count');
    expect(nodeCheck!.status).toBe('ok');
    expect(nodeCheck!.message).toContain('1 nodes');
  });
});
