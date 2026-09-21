import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { openDb, closeDb } from '../../src/storage/db.js';

describe('openDb', () => {
  const dbPath = join(tmpdir(), `monograph-test-${Date.now()}.db`);

  afterEach(() => { if (existsSync(dbPath)) unlinkSync(dbPath); });

  it('creates a new database file', () => {
    const db = openDb(dbPath);
    closeDb(db);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('creates the nodes table', () => {
    const db = openDb(dbPath);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'").get();
    closeDb(db);
    expect(row).toBeDefined();
  });

  it('creates the edges table', () => {
    const db = openDb(dbPath);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='edges'").get();
    closeDb(db);
    expect(row).toBeDefined();
  });

  it('creates the nodes_fts virtual table', () => {
    const db = openDb(dbPath);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'").get();
    closeDb(db);
    expect(row).toBeDefined();
  });
});
