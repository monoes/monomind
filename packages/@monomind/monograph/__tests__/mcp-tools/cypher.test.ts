import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { openDb, closeDb } from '../../src/storage/db.js';
import { insertNode } from '../../src/storage/node-store.js';
import { insertEdge } from '../../src/storage/edge-store.js';
import { getMonographCypher } from '../../src/mcp-tools/cypher.js';
import {
  parseCypherQuery,
  cypherToSql,
  executeCypherQuery,
} from '../../src/query/cypher-parser.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

// ── Shared test DB setup ───────────────────────────────────────────────────────

const dbPath = join(tmpdir(), `monograph-cypher-${Date.now()}.db`);
let db: ReturnType<typeof openDb>;

const fnBuildAsync: MonographNode = {
  id: 'cy_build',
  label: 'Function',
  name: 'buildAsync',
  normLabel: 'buildasync',
  filePath: 'src/pipeline/runner.ts',
  startLine: 10,
  endLine: 50,
  isExported: true,
  language: 'typescript',
};

const fnAuthenticate: MonographNode = {
  id: 'cy_auth',
  label: 'Function',
  name: 'authenticate',
  normLabel: 'authenticate',
  filePath: 'src/auth/index.ts',
  startLine: 5,
  endLine: 30,
  isExported: true,
  language: 'typescript',
};

const clsUserService: MonographNode = {
  id: 'cy_us',
  label: 'Class',
  name: 'UserService',
  normLabel: 'userservice',
  filePath: 'src/user/service.ts',
  startLine: 1,
  endLine: 120,
  isExported: true,
  language: 'typescript',
};

// buildAsync --CALLS--> authenticate
const edgeCalls: MonographEdge = {
  id: 'cy_e_calls',
  sourceId: 'cy_build',
  targetId: 'cy_auth',
  relation: 'CALLS',
  confidence: 'EXTRACTED',
  confidenceScore: 1.0,
};

beforeAll(() => {
  db = openDb(dbPath);
  insertNode(db, fnBuildAsync);
  insertNode(db, fnAuthenticate);
  insertNode(db, clsUserService);
  insertEdge(db, edgeCalls);
});

afterAll(() => {
  closeDb(db);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(p)) unlinkSync(p);
  }
});

// ── parseCypherQuery unit tests ────────────────────────────────────────────────

describe('parseCypherQuery', () => {
  it('parses a simple node pattern with inline prop', () => {
    const { parsed, error } = parseCypherQuery(
      'MATCH (n:Function {name: "buildAsync"}) RETURN n.name',
    );
    expect(error).toBeUndefined();
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('node');
    expect(parsed!.nodeA.label).toBe('Function');
    expect(parsed!.nodeA.props).toEqual({ name: 'buildAsync' });
    expect(parsed!.returnFields).toEqual([{ alias: 'n', field: 'name' }]);
  });

  it('parses a relationship pattern', () => {
    const { parsed, error } = parseCypherQuery(
      'MATCH (a:Function)-[:CALLS]->(b:Function {name: "authenticate"}) RETURN a.name, a.filePath',
    );
    expect(error).toBeUndefined();
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('relationship');
    expect(parsed!.relation).toBe('CALLS');
    expect(parsed!.nodeA.alias).toBe('a');
    expect(parsed!.nodeB!.alias).toBe('b');
    expect(parsed!.nodeB!.props).toEqual({ name: 'authenticate' });
    expect(parsed!.returnFields).toEqual([
      { alias: 'a', field: 'name' },
      { alias: 'a', field: 'filePath' },
    ]);
  });

  it('parses a node pattern with WHERE clause', () => {
    const { parsed, error } = parseCypherQuery(
      'MATCH (n:Function) WHERE n.name = "buildAsync" RETURN n.name, n.filePath',
    );
    expect(error).toBeUndefined();
    expect(parsed).not.toBeNull();
    expect(parsed!.whereClause).toEqual({ alias: 'n', field: 'name', value: 'buildAsync' });
  });

  it('blocks CREATE — returns error', () => {
    const { parsed, error } = parseCypherQuery('CREATE (n:Node) RETURN n.name');
    expect(parsed).toBeNull();
    expect(error).toContain('Write operations not supported');
    expect(error).toContain('CREATE');
  });

  it('blocks MERGE — returns error', () => {
    const { parsed, error } = parseCypherQuery('MERGE (n:Node {name: "x"}) RETURN n.name');
    expect(parsed).toBeNull();
    expect(error).toContain('Write operations not supported');
  });

  it('blocks DELETE — returns error', () => {
    const { parsed, error } = parseCypherQuery('MATCH (n) DELETE n');
    expect(parsed).toBeNull();
    expect(error).toContain('Write operations not supported');
  });

  it('returns parse error for invalid query string', () => {
    const { parsed, error } = parseCypherQuery('invalid query string');
    expect(parsed).toBeNull();
    expect(error).toMatch(/parse error/i);
  });

  it('returns parse error for missing RETURN', () => {
    const { parsed, error } = parseCypherQuery('MATCH (n:Function)');
    expect(parsed).toBeNull();
    expect(error).toMatch(/RETURN/i);
  });

  it('rejects unknown RETURN field', () => {
    const { parsed, error } = parseCypherQuery('MATCH (n:Function) RETURN n.unknownField');
    expect(parsed).toBeNull();
    expect(error).toMatch(/unknown|invalid/i);
  });
});

// ── cypherToSql unit tests ─────────────────────────────────────────────────────

describe('cypherToSql', () => {
  it('generates correct SQL for a node-only query', () => {
    const { parsed } = parseCypherQuery(
      'MATCH (n:Class {name: "UserService"}) RETURN n.name, n.filePath',
    );
    const { sql, params } = cypherToSql(parsed!);
    expect(sql).toContain('FROM nodes n');
    expect(sql).toContain('n.label = ?');
    expect(sql).toContain('n.name = ?');
    expect(params).toContain('Class');
    expect(params).toContain('UserService');
    expect(sql).toContain('LIMIT 200');
    expect(sql).toContain('n.name AS "n_name"');
    expect(sql).toContain('n.file_path AS "n_filePath"');
  });

  it('generates correct SQL for a relationship query', () => {
    const { parsed } = parseCypherQuery(
      'MATCH (a:Function)-[:CALLS]->(b:Function {name: "authenticate"}) RETURN a.name, a.filePath',
    );
    const { sql, params } = cypherToSql(parsed!);
    expect(sql).toContain('FROM nodes a');
    expect(sql).toContain('e.relation = ?');
    expect(params).toContain('CALLS');
    expect(sql).toContain('JOIN nodes b ON b.id = e.target_id');
    expect(sql).toContain('b.name = ?');
    expect(params).toContain('authenticate');
    expect(sql).toContain('LIMIT 200');
  });
});

// ── executeCypherQuery integration tests ─────────────────────────────────────

describe('executeCypherQuery', () => {
  it('returns rows for a matching node query', () => {
    const result = executeCypherQuery(
      db,
      'MATCH (n:Function {name: "buildAsync"}) RETURN n.name',
    );
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]['n_name']).toBe('buildAsync');
    expect(result.queryTime).toBeGreaterThanOrEqual(0);
  });

  it('returns empty rows when no match', () => {
    const result = executeCypherQuery(
      db,
      'MATCH (n:Function {name: "nonexistent"}) RETURN n.name',
    );
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(0);
  });

  it('returns rows for a relationship query', () => {
    const result = executeCypherQuery(
      db,
      'MATCH (a:Function)-[:CALLS]->(b:Function {name: "authenticate"}) RETURN a.name, a.filePath',
    );
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]['a_name']).toBe('buildAsync');
    expect(result.rows[0]['a_filePath']).toBe('src/pipeline/runner.ts');
  });

  it('returns error (not throw) for write operation', () => {
    const result = executeCypherQuery(db, 'CREATE (n:Node) RETURN n.name');
    expect(result.error).toContain('Write operations not supported');
    expect(result.rows).toHaveLength(0);
  });

  it('returns error (not throw) for invalid query', () => {
    const result = executeCypherQuery(db, 'garbage query here');
    expect(result.error).toMatch(/parse error/i);
    expect(result.rows).toHaveLength(0);
  });
});

// ── getMonographCypher (MCP facade) ───────────────────────────────────────────

describe('getMonographCypher', () => {
  it('delegates to executeCypherQuery and returns results', () => {
    const result = getMonographCypher(
      db,
      'MATCH (n:Class {name: "UserService"}) RETURN n.name, n.filePath',
    );
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]['n_name']).toBe('UserService');
  });

  it('returns error gracefully for forbidden operation', () => {
    const result = getMonographCypher(db, 'DROP TABLE nodes');
    expect(result.error).toContain('Write operations not supported');
    expect(result.rows).toHaveLength(0);
  });
});
