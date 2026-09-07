// packages/@monomind/cli/src/__tests__/memory-bridge-fts-sync.test.ts
//
// Two related bugs in the FTS5 keyword-search path, both found while
// building the K9 retrieval evaluation baseline (memory-KG next-steps
// handoff 2026-09-07) and reported upstream as GitHub issue #224:
//
//  1. `SqlBackend.store()`'s plain upsert writes via `INSERT OR REPLACE`.
//     Its internal conflict-resolution delete does not reliably fire the
//     `memory_entries_fts_ad` (`AFTER DELETE`) trigger — confirmed empirically
//     (not fixed by `PRAGMA recursive_triggers = ON`, which does not change
//     this for the conflict-resolution delete specifically) — so updating an
//     entry left its STALE fts row behind alongside the new one: a search
//     then returned the same entry id twice, once scored against old
//     content and once against current.
//  2. `bridgeSearchEntries`' FTS5 normalisation floored the divisor to `1`
//     unconditionally (`Math.max(...ranks, 1)`). BM25 IDF goes to zero or
//     negative when a query term appears in most/all matched rows — exactly
//     what bug 1 produces, and also reachable from a real, differently-
//     shaped corpus — so the correct, sole match could display a misleading
//     ~0.00 instead of its best-available 1.0.
//
// Both run against a REAL backend (SqlBackend, isolated temp store under
// cwd — same traversal-guard-compliant pattern as
// memory-retrieval-quality.test.ts), not a mocked bridge: these are bugs in
// the backend's own SQL/trigger behaviour, which a mock cannot reproduce.

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bridgeSearchEntries, bridgeStoreEntry, shutdownBridge } from '../memory/memory-bridge.js';

const STORE = mkdtempSync(join(process.cwd(), '.tmp-fts-sync-'));

afterAll(async () => {
  await shutdownBridge();
  rmSync(STORE, { recursive: true, force: true });
});

describe('FTS5 index stays in sync with an upsert (no duplicate/stale hit)', () => {
  it('a single sole match scores 1.0, not ~0.00 (issue #224)', async () => {
    await bridgeStoreEntry({
      key: 'marker',
      value: 'The secret marker is xyzzy-plugh-quorlax-1788780407',
      namespace: 'fts-sync',
      dbPath: STORE,
      upsert: true,
    });

    const res = await bridgeSearchEntries({
      query: 'secret marker xyzzy-plugh-quorlax-1788780407',
      namespace: 'fts-sync',
      dbPath: STORE,
    });

    expect(res?.results).toHaveLength(1);
    expect(res?.results?.[0].score).toBeGreaterThan(0.9);
  });

  it('updating an entry leaves exactly one search hit, with the current content', async () => {
    await bridgeStoreEntry({
      key: 'upsert-target',
      value: 'legacy: routes to MySQL',
      namespace: 'fts-sync',
      dbPath: STORE,
      upsert: true,
    });
    await bridgeStoreEntry({
      key: 'upsert-target',
      value: 'current: routes to PostgreSQL',
      namespace: 'fts-sync',
      dbPath: STORE,
      upsert: true,
    });

    const res = await bridgeSearchEntries({ query: 'routes', namespace: 'fts-sync', dbPath: STORE });

    expect(res?.results).toHaveLength(1);
    expect(res?.results?.[0].content).toBe('current: routes to PostgreSQL');
    expect(res?.results?.[0].score).toBeGreaterThan(0.9);
  });

  it('a database that already has a stale duplicate (from before this fix) is repaired on reopen', async () => {
    await bridgeStoreEntry({
      key: 'legacy-store',
      value: 'hello world',
      namespace: 'fts-sync-legacy',
      dbPath: STORE,
      upsert: true,
    });
    // A fresh connection re-runs initializeSchema()/dedupeFTS5Rows() — this
    // is what a real process restart looks like, and what the repair path
    // (as opposed to the trigger fix, which only prevents NEW duplicates)
    // is meant to catch.
    await shutdownBridge();

    const Database = (await import('better-sqlite3')).default;
    const dbFile = join(STORE, 'memory.db');
    const db = new Database(dbFile);
    const row = db
      .prepare('SELECT id FROM memory_entries WHERE key = ?')
      .get('legacy-store') as { id: string };
    // Simulate what the pre-fix trigger left behind: an extra fts row for
    // the same entry_id, with stale content, never cleaned up.
    db.prepare('INSERT INTO memory_entries_fts(entry_id, key, content) VALUES (?, ?, ?)').run(
      row.id,
      'legacy-store',
      'STALE PRE-FIX CONTENT',
    );
    const before = db
      .prepare('SELECT COUNT(*) as n FROM memory_entries_fts WHERE entry_id = ?')
      .get(row.id) as { n: number };
    expect(before.n).toBe(2);
    db.close();

    const res = await bridgeSearchEntries({
      query: 'hello',
      namespace: 'fts-sync-legacy',
      dbPath: STORE,
    });

    expect(res?.results).toHaveLength(1);
    expect(res?.results?.[0].content).toBe('hello world');
  });
});
