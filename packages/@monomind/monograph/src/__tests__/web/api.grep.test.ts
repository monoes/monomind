import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { queryGrep } from '../../web/api.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER);
    CREATE VIRTUAL TABLE nodes_fts USING fts5(id, name, label, content='nodes', content_rowid='rowid');
    INSERT INTO nodes VALUES ('n1', 'fetchUser', 'Function', '/app/user.ts', 10, 20, null);
    INSERT INTO nodes VALUES ('n2', 'UserService', 'Class', '/app/service.ts', 1, 100, 1);
    INSERT INTO nodes VALUES ('n3', 'formatDate', 'Function', '/app/utils.ts', 5, 15, null);
  `);
  return db;
}

describe('queryGrep', () => {
  it('returns nodes whose name matches pattern case-insensitively', () => {
    const db = makeDb();
    const results = queryGrep(db, 'user', false);
    expect(results.length).toBe(2); // fetchUser and UserService
    expect(results.some(r => r.name === 'fetchUser')).toBe(true);
    expect(results.some(r => r.name === 'UserService')).toBe(true);
  });

  it('returns empty array for no match', () => {
    const db = makeDb();
    const results = queryGrep(db, 'nonexistent', false);
    expect(results).toEqual([]);
  });

  it('limits to 100 results', () => {
    const db = makeDb();
    const results = queryGrep(db, 'Date', false);
    expect(results.length).toBeLessThanOrEqual(100);
  });

  it('returns results with correct shape', () => {
    const db = makeDb();
    const results = queryGrep(db, 'format', false);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    expect(results[0]).toHaveProperty('label');
    expect(results[0]).toHaveProperty('filePath');
    expect(results[0]).toHaveProperty('startLine');
  });
});
