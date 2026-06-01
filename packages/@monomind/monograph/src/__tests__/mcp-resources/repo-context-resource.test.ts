import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { repoContextResource } from '../../mcp-resources/repo-context-resource.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO nodes VALUES ('n1', 'UserService', 'Class', '/app/user.ts', 1, 50, 1);
    INSERT INTO index_meta VALUES ('indexed_at', '2026-05-01T00:00:00.000Z');
  `);
  return db;
}

describe('repoContextResource', () => {
  it('has uri and handler', () => {
    expect(repoContextResource.uri).toBeDefined();
    expect(typeof repoContextResource.handler).toBe('function');
  });

  it('handler returns node count, edge count, indexedAt', () => {
    const db = makeDb();
    const result = repoContextResource.handler(db) as any;
    expect(result.nodeCount).toBe(1);
    expect(result.edgeCount).toBe(0);
    expect(result.indexedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('result includes available tools list', () => {
    const db = makeDb();
    const result = repoContextResource.handler(db) as any;
    expect(Array.isArray(result.availableTools)).toBe(true);
    expect(result.availableTools.length).toBeGreaterThan(0);
  });
});
