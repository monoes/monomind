/**
 * Regression tests for the memory data-loss cluster (GitHub #87, #88).
 *
 * #87: applyTemporalDecay used `confidence * (1.0 - decay_rate * days)` —
 *      linear, so confidence went negative after ~20 days at the default
 *      0.05 rate, and downstream validation ([0,1]) silently dropped those
 *      patterns. The query now clamps with MAX(0.0, ...).
 *
 * #88: storeEntry upsert used INSERT OR REPLACE with a column list that
 *      omitted access_count, confidence, importance_score, last_accessed_at,
 *      owner_id, agent_id, session_id and hardcoded metadata '{}' — every
 *      update wiped the entry's learned stats. Upsert now UPDATEs the
 *      matched row in place.
 *
 * Follows memory-crud.test.ts: mock @monoes/memory so all operations take
 * the real sql.js fallback path against a tempdir .swarm/memory.db.
 */

import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@monoes/memory', () => {
  throw new Error('mocked: LanceDB backend unavailable in test environment');
});

import { storeEntry } from '../memory/memory-crud.js';
import { applyTemporalDecay, initializeMemoryDatabase } from '../memory/memory-initializer.js';

/** Open the on-disk sql.js DB, run fn, persist atomically. */
async function withDb<T>(dbPath: string, fn: (db: any) => T): Promise<T> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const result = fn(db);
    const data = db.export();
    const tmp = `${dbPath}.tmp`;
    writeFileSync(tmp, Buffer.from(data));
    renameSync(tmp, dbPath);
    return result;
  } finally {
    db.close();
  }
}

async function readRow(
  dbPath: string,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown> | null> {
  return withDb(dbPath, (db) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let row: Record<string, unknown> | null = null;
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      row = Object.fromEntries(columns.map((c: string, i: number) => [c, values[i]]));
    }
    stmt.free();
    return row;
  });
}

describe('memory data-loss fixes (#87, #88)', () => {
  let dir: string;
  let dbPath: string;
  let originalCwd: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'memory-dataloss-test-'));
    originalCwd = process.cwd();
    process.chdir(dir);
    dbPath = join(dir, '.swarm', 'memory.db');
    const initResult = await initializeMemoryDatabase({});
    expect(initResult.success).toBe(true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('#88 upsert preserves learned stats (access_count, confidence, metadata, ...) and updates content in place', async () => {
    const first = await storeEntry({
      key: 'k',
      namespace: 'ns',
      value: 'v1',
      upsert: true,
      generateEmbeddingFlag: false,
    });
    expect(first.success).toBe(true);

    // Simulate learned stats accumulated on the row.
    await withDb(dbPath, (db) => {
      db.run(
        `UPDATE memory_entries SET
           access_count = 7,
           confidence = 0.9,
           importance_score = 0.8,
           last_accessed_at = 123456,
           owner_id = 'owner-1',
           agent_id = 'agent-1',
           session_id = 'session-1',
           metadata = '{"learned":true}'
         WHERE key = 'k' AND namespace = 'ns'`,
      );
    });

    const second = await storeEntry({
      key: 'k',
      namespace: 'ns',
      value: 'v2',
      upsert: true,
      generateEmbeddingFlag: false,
    });
    expect(second.success).toBe(true);
    expect(second.id).toBe(first.id); // same row, updated in place

    const row = await readRow(
      dbPath,
      "SELECT * FROM memory_entries WHERE key = 'k' AND namespace = 'ns'",
    );
    expect(row).not.toBeNull();
    expect(row?.content).toBe('v2');
    expect(row?.access_count).toBe(7);
    expect(row?.confidence).toBe(0.9);
    expect(row?.importance_score).toBe(0.8);
    expect(row?.last_accessed_at).toBe(123456);
    expect(row?.owner_id).toBe('owner-1');
    expect(row?.agent_id).toBe('agent-1');
    expect(row?.session_id).toBe('session-1');
    expect(row?.metadata).toBe('{"learned":true}');

    // Still exactly one row — upsert must not duplicate.
    const count = await readRow(
      dbPath,
      "SELECT COUNT(*) AS n FROM memory_entries WHERE key = 'k' AND namespace = 'ns' AND status = 'active'",
    );
    expect(count?.n).toBe(1);
  });

  it('#88 upsert with no existing row inserts a fresh entry', async () => {
    const result = await storeEntry({
      key: 'fresh',
      namespace: 'ns',
      value: 'hello',
      upsert: true,
      generateEmbeddingFlag: false,
    });
    expect(result.success).toBe(true);
    const row = await readRow(
      dbPath,
      "SELECT * FROM memory_entries WHERE key = 'fresh' AND namespace = 'ns'",
    );
    expect(row?.content).toBe('hello');
    expect(row?.status).toBe('active');
  });

  it('#87 temporal decay clamps confidence at 0 instead of going negative', async () => {
    // A pattern last matched 30 days ago with the default decay rate 0.05:
    // 0.5 * (1 - 0.05 * 30) = -0.25 without the clamp.
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    await withDb(dbPath, (db) => {
      db.run(
        `INSERT INTO patterns (id, name, pattern_type, condition, action, confidence, decay_rate, last_matched_at, status, created_at, updated_at)
         VALUES ('p1', 'stale-pattern', 'task-routing', 'cond', 'act', 0.5, 0.05, ?, 'active', ?, ?)`,
        [thirtyDaysAgo, thirtyDaysAgo, thirtyDaysAgo],
      );
    });

    const result = await applyTemporalDecay(dbPath);
    expect(result.success).toBe(true);
    expect(result.patternsDecayed).toBe(1);

    const row = await readRow(dbPath, "SELECT confidence FROM patterns WHERE id = 'p1'");
    expect(row?.confidence).toBe(0); // clamped, not -0.25
  });
});
