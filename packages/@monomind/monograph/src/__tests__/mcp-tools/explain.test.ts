import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { explainNode } from '../../mcp-tools/explain.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER, norm_label TEXT, is_exported INTEGER, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    INSERT INTO nodes VALUES ('n1', 'UserService', 'Class', '/app/user.ts', 1, 50, 1, 'userservice', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n2', 'getUser', 'Function', '/app/user.ts', 5, 15, 1, 'getuser', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n3', 'Database', 'Class', '/app/db.ts', 1, 100, 2, 'database', 1, 'typescript', null);
    INSERT INTO edges VALUES ('e1', 'n1', 'n2', 'HAS_METHOD', 'EXTRACTED', 1.0);
    INSERT INTO edges VALUES ('e2', 'n2', 'n3', 'CALLS', 'EXTRACTED', 1.0);
  `);
  return db;
}

describe('explainNode', () => {
  it('returns an explanation string for a known node', () => {
    const db = makeDb();
    const result = explainNode(db, 'UserService');
    expect(result.explanation).toBeDefined();
    expect(result.explanation).toContain('UserService');
    expect(result.explanation).toContain('Class');
  });

  it('explanation mentions outbound connections', () => {
    const db = makeDb();
    const result = explainNode(db, 'UserService');
    expect(result.explanation).toContain('getUser');
  });

  it('returns null explanation for unknown node', () => {
    const db = makeDb();
    const result = explainNode(db, 'NonExistent');
    expect(result.node).toBeNull();
    expect(result.explanation).toBeNull();
  });

  it('includes connection count in summary', () => {
    const db = makeDb();
    const result = explainNode(db, 'getUser');
    expect(result.connectionCount).toBeGreaterThanOrEqual(0);
  });
});
