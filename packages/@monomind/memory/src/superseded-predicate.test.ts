/**
 * Superseded filtering must happen IN SQL, not in JS after the fetch.
 *
 * Second Brain item 4, as ruled by `brain-director` on 2026-07-28: re-ingest
 * MARKS the previous version superseded rather than destroying it, and the
 * vector search excludes marked rows via an indexed SQL predicate. The rows
 * stay on disk because they are the only existing corpus for item 7's
 * bi-temporal evaluation slice — they are literally the record of what was
 * true and is now superseded.
 *
 * WHY SQL AND NOT JS — THE MEASUREMENT
 * ------------------------------------
 * Measured 2026-07-28 against a mirror of this repo's real store (10,875 rows
 * in `knowledge:shared`, 10,251 of them superseded — 94.3%), 384-dim vectors,
 * best of 5 runs:
 *
 *   no predicate, JS post-filter (today)   37.5 ms   10,875 rows scored
 *   indexed SQL predicate (this contract)   2.2 ms      624 rows scored
 *
 * 17x. And the reason matters more than the number: filtering in JS *after*
 * the fetch saved only ~15%, because the dominant cost is reading and
 * deserializing the embedding BLOBs, not computing cosine. The SQL predicate
 * wins because `SEARCH e USING INDEX idx_ns_superseded` means the dead rows'
 * blobs are never read off disk at all. A tombstone that still fetches the row
 * buys almost nothing; a tombstone the query planner can skip buys everything.
 *
 * That is why the index in this contract is not optional and not a
 * micro-optimisation — without it the predicate degrades to the JS-filter
 * result and item 4 delivers ~15% instead of 17x.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteBackend } from './sqlite-backend.js';
import { SqlJsBackend } from './sqljs-backend.js';
import { createDefaultEntry } from './types.js';
import type { IMemoryBackend } from './types.js';

interface BackendCase {
  name: string;
  create: () => IMemoryBackend;
}

const BACKENDS: BackendCase[] = [
  {
    name: 'SQLiteBackend (better-sqlite3)',
    create: () => new SQLiteBackend({ databasePath: ':memory:', walMode: false, verbose: false }),
  },
  {
    name: 'SqlJsBackend (sql.js WASM)',
    create: () => new SqlJsBackend({ databasePath: ':memory:', verbose: false }),
  },
];

function vec(seed: number, dims = 8): Float32Array {
  const v = new Float32Array(dims);
  for (let i = 0; i < dims; i++) v[i] = Math.sin(seed + i);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) v[i] /= norm;
  return v;
}

// ─── STAGED RED — skipped until item 4 lands ──────────────────────────────
// These pin the contract for `markSupersededByKeyPrefix` / `deleteByKeyPrefix`,
// which do not exist yet. They are skipped so one author's red tests do not
// become every other role's red test run. Un-skip in the commit that
// implements them.
for (const backendCase of BACKENDS) {
  describe.skip(`superseded SQL predicate — ${backendCase.name}`, () => {
    let backend: IMemoryBackend & {
      markSupersededByKeyPrefix?(namespace: string, prefix: string): Promise<number>;
      deleteByKeyPrefix?(namespace: string, prefix: string): Promise<number>;
    };

    beforeEach(async () => {
      backend = backendCase.create() as typeof backend;
      await backend.initialize();
    });

    afterEach(async () => {
      await backend.shutdown();
    });

    async function store(key: string, seed: number, namespace = 'knowledge:shared') {
      const entry = createDefaultEntry({ key, content: `content for ${key}`, namespace });
      (entry as { embedding?: Float32Array }).embedding = vec(seed);
      await backend.store(entry);
      return entry;
    }

    const nsFilter = { namespace: 'knowledge:shared' } as never;

    it.skip('exposes a mark-superseded capability on every driver', () => {
      expect(typeof backend.markSupersededByKeyPrefix).toBe('function');
    });

    // ---- The core contract ------------------------------------------------

    describe('marked rows leave the candidate set', () => {
      beforeEach(async () => {
        await store('doc:oldhash:0', 1);
        await store('doc:oldhash:1', 2);
        await store('doc:newhash:0', 3);
      });

      it.skip('search excludes superseded rows by default', async () => {
        expect(await backend.search(vec(1), { k: 10, filters: nsFilter })).toHaveLength(3);

        const marked = await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:oldhash:');
        expect(marked).toBe(2);

        const after = await backend.search(vec(1), { k: 10, filters: nsFilter });
        expect(after.map((r) => r.entry.key)).toEqual(['doc:newhash:0']);
      });

      it.skip('superseded rows are NOT destroyed — item 7 needs them', async () => {
        await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:oldhash:');

        // Still on disk, still retrievable by explicit query. This assertion is
        // the whole reason we mark instead of delete.
        const rows = await backend.query({
          type: 'exact' as never,
          namespace: 'knowledge:shared',
          limit: 100,
        });
        expect(rows.map((r) => r.key).sort()).toEqual([
          'doc:newhash:0',
          'doc:oldhash:0',
          'doc:oldhash:1',
        ]);
      });

      it.skip('an opt-in flag brings superseded rows back — the includeSuperseded contract', async () => {
        await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:oldhash:');

        const all = await backend.search(vec(1), {
          k: 10,
          filters: nsFilter,
          includeSuperseded: true,
        } as never);
        expect(all).toHaveLength(3);
      });

      it.skip('marking is idempotent and reports rows newly marked', async () => {
        expect(await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:oldhash:')).toBe(2);
        expect(await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:oldhash:')).toBe(0);
      });

      it.skip('never marks across a namespace boundary', async () => {
        await store('doc:oldhash:0', 9, 'knowledge:global');
        await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:oldhash:');

        const global = await backend.search(vec(9), {
          k: 10,
          filters: { namespace: 'knowledge:global' } as never,
        });
        expect(global.map((r) => r.entry.key)).toEqual(['doc:oldhash:0']);
      });

      it.skip('applies the same LIKE-metacharacter guards as the delete path', async () => {
        // `doc:%` must match the literal prefix, not every doc chunk.
        expect(await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:%')).toBe(0);
        await expect(
          backend.markSupersededByKeyPrefix!('knowledge:shared', ''),
        ).rejects.toThrow();
        expect(await backend.search(vec(1), { k: 10, filters: nsFilter })).toHaveLength(3);
      });
    });

    // ---- The limit must now be satisfiable --------------------------------

    it.skip('a requested limit is satisfied from live rows only — no over-fetch, no starvation', async () => {
      // Today: 94.6% dead + a 300-row over-fetch cap means any limit above ~15
      // silently returns short. With the predicate the dead rows never enter
      // the candidate set, so k means k.
      for (let i = 0; i < 400; i++) await store(`doc:deadhash:${i}`, i);
      for (let i = 0; i < 50; i++) await store(`doc:livehash:${i}`, 1000 + i);
      await backend.markSupersededByKeyPrefix!('knowledge:shared', 'doc:deadhash:');

      const results = await backend.search(vec(1000), { k: 25, filters: nsFilter });
      expect(results).toHaveLength(25);
      expect(results.every((r) => r.entry.key.startsWith('doc:livehash:'))).toBe(true);
    });

    // ---- The index is part of the contract, not an optimisation -----------

    it.skip('the superseded predicate is index-backed, not a full scan', async () => {
      // Without the index the planner scans every row and reads every blob,
      // which measured at only ~15% better than no filter at all. Guarding the
      // plan is the only way to keep that regression from landing silently.
      const b = backend as unknown as { driver?: { all(sql: string, p?: unknown[]): unknown[] } };
      if (!b.driver) return; // driver internals not exposed on this backend

      const plan = b.driver
        .all(
          `EXPLAIN QUERY PLAN
             SELECT e.id FROM memory_entries e
             JOIN memory_embeddings emb ON emb.entry_id = e.id
            WHERE e.namespace = ? AND e.superseded = 0`,
          ['knowledge:shared'],
        )
        .map((r) => String((r as { detail?: string }).detail ?? ''))
        .join(' | ');

      expect(plan).toMatch(/USING INDEX/i);
      expect(plan, `query plan must not scan memory_entries: ${plan}`).not.toMatch(
        /SCAN e\b/i,
      );
    });
  });
}
