import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { queryGraph as queryGraphMcp } from '../../mcp-tools/graph-query.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER, norm_label TEXT, is_exported INTEGER, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    INSERT INTO nodes VALUES ('n1', 'AuthService', 'Class', '/app/auth.ts', 1, 50, 1, 'authservice', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n2', 'login', 'Function', '/app/auth.ts', 5, 20, 1, 'login', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n3', 'Database', 'Class', '/app/db.ts', 1, 100, 2, 'database', 1, 'typescript', null);
    INSERT INTO edges VALUES ('e1', 'n1', 'n2', 'HAS_METHOD', 'EXTRACTED', 1.0);
    INSERT INTO edges VALUES ('e2', 'n2', 'n3', 'CALLS', 'EXTRACTED', 1.0);
  `);
  return db;
}

describe('queryGraphMcp', () => {
  it('returns nodes matching query string', () => {
    const db = makeDb();
    const result = queryGraphMcp(db, { query: 'auth', mode: 'bfs' });
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.some(n => n.name === 'AuthService')).toBe(true);
  });

  it('respects tokenBudget — stops when estimate exceeded', () => {
    const db = makeDb();
    const result = queryGraphMcp(db, { query: 'auth', mode: 'bfs', tokenBudget: 10 });
    // Very small budget — should return minimal results
    expect(result.truncated).toBe(true);
  });

  it('works with dfs mode', () => {
    const db = makeDb();
    const result = queryGraphMcp(db, { query: 'auth', mode: 'dfs' });
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('result has mode in metadata', () => {
    const db = makeDb();
    const result = queryGraphMcp(db, { query: 'login', mode: 'bfs' });
    expect(result.mode).toBe('bfs');
  });
});
