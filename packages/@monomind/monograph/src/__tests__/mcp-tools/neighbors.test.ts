import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getMonographNeighbors } from '../../mcp-tools/neighbors.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, label TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, community_id INTEGER, norm_label TEXT, is_exported INTEGER, language TEXT, properties TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, relation TEXT, confidence TEXT, confidence_score REAL);
    INSERT INTO nodes VALUES ('n1', 'UserService', 'Class', '/app/user.ts', 1, 50, 1, 'userservice', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n2', 'getUser', 'Function', '/app/user.ts', 5, 15, 1, 'getuser', 1, 'typescript', null);
    INSERT INTO nodes VALUES ('n3', 'Database', 'Class', '/app/db.ts', 1, 100, 2, 'database', 1, 'typescript', null);
    INSERT INTO edges VALUES ('e1', 'n1', 'n2', 'HAS_METHOD', 'EXTRACTED', 1.0);
    INSERT INTO edges VALUES ('e2', 'n1', 'n3', 'CALLS', 'INFERRED', 0.7);
  `);
  return db;
}

describe('getMonographNeighbors', () => {
  it('returns outbound neighbors with edge details', () => {
    const db = makeDb();
    const result = getMonographNeighbors(db, { name: 'UserService' });
    expect(result.node).not.toBeNull();
    expect(result.neighbors.length).toBe(2);
    const rels = result.neighbors.map((n) => n.relation);
    expect(rels).toContain('HAS_METHOD');
    expect(rels).toContain('CALLS');
  });

  it('can filter by relation type', () => {
    const db = makeDb();
    const result = getMonographNeighbors(db, { name: 'UserService', relationFilter: 'CALLS' });
    expect(result.neighbors.every((n) => n.relation === 'CALLS')).toBe(true);
  });

  it('returns null node for unknown symbol', () => {
    const db = makeDb();
    const result = getMonographNeighbors(db, { name: 'NonExistent' });
    expect(result.node).toBeNull();
    expect(result.neighbors).toEqual([]);
  });

  it('includes inbound neighbors', () => {
    const db = makeDb();
    const result = getMonographNeighbors(db, { name: 'getUser', includeInbound: true });
    expect(result.neighbors.some((n) => n.direction === 'inbound')).toBe(true);
  });

  // ── Finding 9: ambiguity and truncation must be explicit ──────────────────

  it('returns candidates instead of silently picking the first ambiguous match', () => {
    const db = makeDb();
    // Second `UserService`, in a different file, with its own edge.
    db.exec(`
      INSERT INTO nodes VALUES ('n4', 'UserService', 'Class', '/legacy/user.ts', 7, 40, 3, 'userservice', 1, 'typescript', null);
      INSERT INTO edges VALUES ('e3', 'n4', 'n3', 'CALLS', 'EXTRACTED', 1.0);
    `);

    const result = getMonographNeighbors(db, { name: 'UserService' });

    expect(result.ambiguous).toBe(true);
    expect(result.node).toBeNull();
    expect(result.neighbors).toEqual([]);
    expect(result.candidates.map((c) => c.id).sort()).toEqual(['n1', 'n4']);
    const legacy = result.candidates.find((c) => c.id === 'n4');
    expect(legacy?.filePath).toBe('/legacy/user.ts');
    expect(legacy?.startLine).toBe(7);
  });

  it('disambiguates an ambiguous name by filePath', () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO nodes VALUES ('n4', 'UserService', 'Class', '/legacy/user.ts', 7, 40, 3, 'userservice', 1, 'typescript', null);
      INSERT INTO edges VALUES ('e3', 'n4', 'n3', 'CALLS', 'EXTRACTED', 1.0);
    `);

    const result = getMonographNeighbors(db, { name: 'UserService', filePath: '/legacy/user.ts' });

    expect(result.ambiguous).toBe(false);
    expect(result.node?.id).toBe('n4');
    expect(result.neighbors.length).toBe(1);
  });

  it('resolves directly by nodeId, bypassing name ambiguity', () => {
    const db = makeDb();
    db.exec(`
      INSERT INTO nodes VALUES ('n4', 'UserService', 'Class', '/legacy/user.ts', 7, 40, 3, 'userservice', 1, 'typescript', null);
    `);

    const result = getMonographNeighbors(db, { nodeId: 'n1' });

    expect(result.ambiguous).toBe(false);
    expect(result.node?.id).toBe('n1');
    expect(result.neighbors.length).toBe(2);
  });

  it('reports the true total and a truncated flag when the cap is applied', () => {
    const db = makeDb();
    const insert = db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const edge = db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < 8; i++) {
      insert.run(
        `m${i}`,
        `dep${i}`,
        'Function',
        '/app/dep.ts',
        i,
        i + 1,
        4,
        `dep${i}`,
        1,
        'typescript',
        null,
      );
      edge.run(`me${i}`, 'n1', `m${i}`, 'CALLS', 'EXTRACTED', 1.0);
    }

    const result = getMonographNeighbors(db, { name: 'UserService', limit: 3 });

    expect(result.neighbors.length).toBe(3);
    expect(result.limit).toBe(3);
    expect(result.totalNeighbors).toBe(10); // 2 original + 8 new outbound edges
    expect(result.truncated).toBe(true);
  });

  it('reports truncated: false when the result is complete', () => {
    const db = makeDb();
    const result = getMonographNeighbors(db, { name: 'UserService' });
    expect(result.totalNeighbors).toBe(2);
    expect(result.truncated).toBe(false);
  });
});
