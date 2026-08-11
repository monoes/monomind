import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '../../src/storage/utils.js';

// MONO-3 regression: nine sites across node-store / edge-store / 7 mcp-tools
// used to call `JSON.parse(row.properties)` with no guard. A single corrupted
// blob (DB poisoning, partial write, encoding drift) would throw and collapse
// the entire query response to a 500. safeJsonParse isolates the failure to the
// individual row.

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hi"', null)).toBe('hi');
    expect(safeJsonParse('42', 0)).toBe(42);
    expect(safeJsonParse('true', false)).toBe(true);
  });

  it('returns the fallback for null/undefined/empty input', () => {
    expect(safeJsonParse(null, { x: 1 })).toEqual({ x: 1 });
    expect(safeJsonParse(undefined, [])).toEqual([]);
    expect(safeJsonParse('', 'fb')).toBe('fb');
  });

  it('returns the fallback for malformed JSON without throwing', () => {
    expect(safeJsonParse('{not json', { fb: true })).toEqual({ fb: true });
    expect(safeJsonParse('undefined', null)).toBeNull();
    expect(safeJsonParse('[1,2,', [])).toEqual([]);
    // A poisoned `properties` blob with an embedded NUL should not crash callers.
    expect(safeJsonParse('{"a":\x00broken}', { safe: true })).toEqual({ safe: true });
  });

  it('preserves the fallback type (no implicit any leakage)', () => {
    const obj = safeJsonParse<{ count: number }>('{"count":5}', { count: 0 });
    expect(obj.count).toBe(5);
    const arr = safeJsonParse<number[]>('garbage', []);
    expect(arr).toBeInstanceOf(Array);
    expect(arr.length).toBe(0);
  });

  it('does not mutate or stringify the fallback when input is valid', () => {
    const fallback = { keep: 'me' };
    const result = safeJsonParse('{"x":1}', fallback);
    expect(result).not.toBe(fallback);
    expect(result).toEqual({ x: 1 });
    expect(fallback).toEqual({ keep: 'me' });
  });
});

describe('MONO-3: storage sites use safeJsonParse', () => {
  it('node-store.rowToNode survives corrupted properties', async () => {
    // Insert a node with a poisoned properties blob directly into SQLite,
    // then read it back through the canonical rowToNode and verify no throw.
    const { openDb, closeDb } = await import('../../src/storage/db.js');
    const { rowToNode } = await import('../../src/storage/node-store.js');
    const db = openDb(':memory:');
    try {
      db.prepare(
        `INSERT INTO nodes (id, label, name, norm_label, is_exported, properties)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('poisoned', 'Function', 'fn', 'fn', 0, '{not valid json');
      const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get('poisoned') as Record<string, unknown>;
      const node = rowToNode(row);
      expect(node.id).toBe('poisoned');
      expect(node.name).toBe('fn');
      // Corrupted properties → safe fallback (undefined), no throw.
      expect(node.properties).toBeUndefined();
    } finally {
      closeDb(db);
    }
  });

  it('edge-store.rowToEdge survives corrupted evidence', async () => {
    const { openDb, closeDb } = await import('../../src/storage/db.js');
    const { rowToEdge } = await import('../../src/storage/edge-store.js');
    const db = openDb(':memory:');
    try {
      // edges table requires FK-respecting node rows.
      db.prepare(
        `INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, ?, ?, ?, ?)`,
      ).run('n1', 'Function', 'a', 'a', 0);
      db.prepare(
        `INSERT INTO nodes (id, label, name, norm_label, is_exported) VALUES (?, ?, ?, ?, ?)`,
      ).run('n2', 'Function', 'b', 'b', 0);
      db.prepare(
        `INSERT INTO edges (id, source_id, target_id, relation, confidence, confidence_score, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('e1', 'n1', 'n2', 'CALLS', 'EXTRACTED', 1.0, '[broken evidence');
      const row = db.prepare('SELECT * FROM edges WHERE id = ?').get('e1') as Record<string, unknown>;
      const edge = rowToEdge(row);
      expect(edge.id).toBe('e1');
      expect(edge.relation).toBe('CALLS');
      // Corrupted evidence → safe fallback (undefined), no throw.
      expect(edge.evidence).toBeUndefined();
    } finally {
      closeDb(db);
    }
  });

  it('node-store.rowToPropDef survives corrupted closed_values', async () => {
    // rowToPropDef is private, so exercise it indirectly through listProperties.
    // Note: CREATE_NODE_PROPERTIES is not applied by applyMigrations on a fresh
    // memory DB (it's created lazily by pipeline phases), so we set it up here.
    const { openDb, closeDb } = await import('../../src/storage/db.js');
    const { listProperties } = await import('../../src/storage/node-store.js');
    const { CREATE_NODE_PROPERTIES } = await import('../../src/storage/schema.js');
    const db = openDb(':memory:');
    try {
      db.exec(CREATE_NODE_PROPERTIES);
      db.prepare(
        `INSERT INTO node_properties (ident, type, cardinality, view_context, closed_values, queryable)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('broken_closed', 'closed', 'one', 'all', '{bad json', 1);
      const props = listProperties(db);
      const found = props.find(p => p.ident === 'broken_closed');
      expect(found).toBeDefined();
      expect(found?.closedValues).toBeNull();
    } finally {
      closeDb(db);
    }
  });
});
